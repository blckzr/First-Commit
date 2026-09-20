import type { Pool, PoolClient } from "pg";
import type { Request } from "express";
import { HttpError } from "../middleware/errors.js";
import { clientIp } from "./client-ip.js";

/**
 * Rate limiting on the open auth endpoints (docs/database-schema.md §6.3:
 * "limit failed logins and reset requests per email and per IP using
 * `auth_attempts`").
 *
 * Two dimensions, because they stop different attacks:
 *
 * - **Per email** stops credential stuffing against one account. Its cost is
 *   that someone can lock a specific address out of logging in for the length
 *   of the window, so the window is short.
 * - **Per IP** stops one machine spraying many addresses, which is what the
 *   per-email limit cannot see.
 *
 * `auth_attempts` rows are written **whether or not the address exists**. If
 * they were only written for real accounts, a rate-limited response would mean
 * "this account exists" and the limiter itself would become the enumeration
 * oracle that §6.3 is trying to close.
 */

export type AttemptKind = "login" | "reset_request";

export interface LimitRule {
  /** How far back to count. */
  windowMs: number;
  perEmail: number;
  perIp: number;
  /**
   * Count only failures, or every attempt?
   *
   * Log in has a meaningful failure. A reset request does not — every one of
   * them sends an email — so all of them count.
   */
  failuresOnly: boolean;
}

export const RULES: Record<AttemptKind, LimitRule> = {
  login: { windowMs: 15 * 60_000, perEmail: 5, perIp: 20, failuresOnly: true },
  reset_request: { windowMs: 60 * 60_000, perEmail: 3, perIp: 10, failuresOnly: false },
};

/** design.md §9: say what happened and what to do, without blaming the reader. */
const TOO_MANY = "Too many attempts. Wait a few minutes and try again.";

export async function recordAttempt(
  db: Pool | PoolClient,
  kind: AttemptKind,
  req: Request,
  email: string | null,
  succeeded: boolean,
): Promise<void> {
  await db.query(
    `insert into auth_attempts (email, ip_address, kind, succeeded) values ($1, $2, $3, $4)`,
    [email ? email.toLowerCase() : null, clientIp(req), kind, succeeded],
  );
}

/**
 * Throws 429 when either dimension is over its limit.
 *
 * Call this *before* doing the work — including before hashing a password, so
 * an attacker cannot use the endpoint's own cost against it.
 */
export async function enforceLimit(
  db: Pool | PoolClient,
  kind: AttemptKind,
  req: Request,
  email: string | null,
): Promise<void> {
  const rule = RULES[kind];
  const since = new Date(Date.now() - rule.windowMs);
  const ip = clientIp(req);

  const conditions = rule.failuresOnly ? "and succeeded = false" : "";

  if (email) {
    const { rows } = await db.query<{ count: string }>(
      `select count(*) as count from auth_attempts
        where kind = $1 and created_at > $2 and lower(email) = lower($3) ${conditions}`,
      [kind, since, email],
    );
    if (Number(rows[0].count) >= rule.perEmail) throw new HttpError(429, TOO_MANY);
  }

  if (ip) {
    const { rows } = await db.query<{ count: string }>(
      `select count(*) as count from auth_attempts
        where kind = $1 and created_at > $2 and ip_address = $3 ${conditions}`,
      [kind, since, ip],
    );
    if (Number(rows[0].count) >= rule.perIp) throw new HttpError(429, TOO_MANY);
  }
}
