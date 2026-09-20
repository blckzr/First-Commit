import { Algorithm, hash, verify } from "@node-rs/argon2";

/**
 * Password hashing.
 *
 * docs/database-schema.md §6.3: argon2id with a per-password salt, and the
 * password itself is never stored or logged. `@node-rs/argon2` generates the
 * salt and embeds it, the parameters, and the version in the returned string,
 * so a future parameter change can be detected and rehashed on next login.
 *
 * Parameters are the OWASP baseline for argon2id: 19 MiB, 2 iterations,
 * 1 degree of parallelism.
 */
const OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

/**
 * Never throws on a bad hash — a corrupt or legacy value in the column must
 * read as "wrong password", not as a 500 that tells an attacker the account
 * exists.
 */
export async function verifyPassword(storedHash: string, password: string): Promise<boolean> {
  try {
    return await verify(storedHash, password, OPTIONS);
  } catch {
    return false;
  }
}
