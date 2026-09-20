import type { Pool, PoolClient } from "pg";
import { EMAIL_TOKEN_TTL_MS, expiresIn, generateToken, hashToken } from "./tokens.js";

export type TokenTable = "email_verification_tokens" | "password_reset_tokens";

/**
 * Spends a one-time token, or returns null.
 *
 * docs/database-schema.md §6.3: verification and reset links are random, stored
 * hashed, expiring, and **single use**.
 *
 * The check and the spend are a single `update ... where used_at is null`, so
 * two requests racing with the same link cannot both win — the second matches
 * zero rows. Doing it as a select-then-update would leave exactly that race
 * open, which matters because a leaked reset link is worth replaying.
 *
 * Expiry is judged by the database clock, so a clock difference between the API
 * and the database cannot extend a link's life.
 */
export async function spendToken(
  db: Pool | PoolClient,
  table: TokenTable,
  token: string,
): Promise<string | null> {
  const { rows } = await db.query<{ user_id: string }>(
    `update ${table}
        set used_at = now()
      where token_hash = $1
        and used_at is null
        and expires_at > now()
      returning user_id`,
    [hashToken(token)],
  );
  return rows[0]?.user_id ?? null;
}

/**
 * Issues a fresh token and invalidates any unused ones for that user.
 *
 * Asking for a second link makes the first stop working. Without that, every
 * request leaves another live link in another inbox, and the oldest one is the
 * most likely to have been forwarded, logged by a mail scanner, or left on a
 * shared screen.
 *
 * Returns the raw token — the only copy that ever exists outside the email.
 */
export async function issueToken(
  db: Pool | PoolClient,
  table: TokenTable,
  userId: string,
): Promise<string> {
  await db.query(
    `update ${table} set used_at = now() where user_id = $1 and used_at is null`,
    [userId],
  );

  const token = generateToken();
  await db.query(
    `insert into ${table} (user_id, token_hash, expires_at) values ($1, $2, $3)`,
    [userId, hashToken(token), expiresIn(EMAIL_TOKEN_TTL_MS)],
  );
  return token;
}
