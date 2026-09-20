import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Opaque tokens for sessions, email verification, and password resets.
 *
 * docs/database-schema.md §6.3: the database stores only a hash, so a copy of
 * the database cannot be replayed as a login or used to claim a reset link.
 *
 * SHA-256 rather than argon2 here on purpose. These are 256 bits of CSPRNG
 * output with no guessable structure, so there is nothing for a slow hash to
 * defend against, and a session lookup happens on every single request.
 */
const TOKEN_BYTES = 32;

export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Constant-time comparison, for the rare case of comparing two hashes in JS. */
export function tokensMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const EMAIL_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour, as the templates promise

export function expiresIn(ms: number): Date {
  return new Date(Date.now() + ms);
}
