import type { CookieOptions, Request, Response } from "express";
import type { Pool, PoolClient } from "pg";
import { config } from "../config.js";
import { SESSION_TTL_MS, expiresIn, generateToken, hashToken } from "./tokens.js";
import { clientIp } from "./client-ip.js";

export const SESSION_COOKIE = "fc_session";

/**
 * The session cookie.
 *
 * `httpOnly` so script cannot read it, `secure` in production so it never
 * crosses plain HTTP, and `sameSite` per docs/database-schema.md §6.3.
 *
 * **`sameSite: "none"` is a known weak point** — it makes this a third-party
 * cookie, which Safari's ITP already blocks and Chrome keeps restricting. It is
 * only needed because the app and the API sit on different domains. Hosting the
 * API at `api.<domain>` alongside the app makes it same-site and lets this drop
 * to "lax". Tracked in AGENT.md §11.
 */
export function sessionCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: config.isProduction ? "none" : "lax",
    path: "/",
    maxAge: SESSION_TTL_MS,
  };
}

export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
  role: "learner" | "admin";
  status: "active" | "suspended";
  emailVerifiedAt: Date | null;
  /**
   * Where the learner stopped in onboarding, or null once finished.
   *
   * design.md §4.3 sends a learner with unfinished onboarding back to their
   * current step, so the browser has to know it on every request — not only in
   * the reply to a log in.
   */
  onboardingStep: string | null;
}

/**
 * Creates a session and sets the cookie.
 *
 * The raw token exists only in this function and in the cookie; the database
 * gets its SHA-256. The address is the caller rather than Render's proxy
 * because `trust proxy` is set in app.ts, and it is normalised by `clientIp`
 * so one client cannot occupy two rate-limit buckets.
 */
export async function createSession(
  pool: Pool,
  req: Request,
  res: Response,
  userId: string,
): Promise<void> {
  const token = generateToken();

  await pool.query(
    `insert into sessions (user_id, token_hash, user_agent, ip_address, expires_at)
     values ($1, $2, $3, $4, $5)`,
    [
      userId,
      hashToken(token),
      req.get("user-agent")?.slice(0, 500) ?? null,
      clientIp(req),
      expiresIn(SESSION_TTL_MS),
    ],
  );

  res.cookie(SESSION_COOKIE, token, sessionCookieOptions());
}

/**
 * Resolves the cookie to a user, or null.
 *
 * Expired sessions are rejected in the query rather than in JavaScript, so a
 * clock difference between the API and the database cannot extend one.
 * Selects explicit columns — §6.1 step 6 — so `password_hash` can never ride
 * along into a response by accident.
 */
export async function resolveSession(pool: Pool, token: string): Promise<SessionUser | null> {
  const { rows } = await pool.query<{
    id: string;
    email: string;
    full_name: string;
    role: "learner" | "admin";
    status: "active" | "suspended";
    email_verified_at: Date | null;
    onboarding_step: string | null;
  }>(
    `select u.id, u.email, u.full_name, u.role, u.status, u.email_verified_at,
            p.onboarding_step
       from sessions s
       join users u on u.id = s.user_id
       left join learner_profiles p on p.user_id = u.id
      where s.token_hash = $1
        and s.expires_at > now()`,
    [hashToken(token)],
  );

  const row = rows[0];
  if (!row) return null;

  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    role: row.role,
    status: row.status,
    emailVerifiedAt: row.email_verified_at,
    // 'done' and null both mean finished; an admin has no learner profile.
    onboardingStep:
      row.onboarding_step && row.onboarding_step !== "done" ? row.onboarding_step : null,
  };
}

/** Deletes one session and clears the cookie. */
export async function destroySession(pool: Pool, res: Response, token: string): Promise<void> {
  await pool.query(`delete from sessions where token_hash = $1`, [hashToken(token)]);
  res.clearCookie(SESSION_COOKIE, { ...sessionCookieOptions(), maxAge: undefined });
}

/**
 * Deletes every session for a user.
 *
 * §6.3 requires this on password change: a stolen session must not outlive the
 * password it was obtained with.
 */
export async function destroyAllSessions(
  db: Pool | PoolClient,
  userId: string,
): Promise<void> {
  await db.query(`delete from sessions where user_id = $1`, [userId]);
}
