import type { Request } from "express";

/**
 * The caller's IP, in one canonical form.
 *
 * Express reports an IPv4 client as the IPv4-mapped IPv6 address
 * `::ffff:127.0.0.1`. Stored verbatim, the same client can appear under two
 * different values — and the per-IP rate limiting in
 * docs/database-schema.md §6.3 counts by value, so that is two buckets for one
 * attacker. Normalising here means every caller of `auth_attempts` and
 * `sessions` agrees on what an address is.
 *
 * `req.ip` already respects `trust proxy`, which app.ts sets for Render.
 */
const IPV4_MAPPED = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;

export function clientIp(req: Request): string | null {
  const raw = req.ip;
  if (!raw) return null;

  const mapped = IPV4_MAPPED.exec(raw);
  if (mapped) return mapped[1];

  // The loopback forms are the same host; pick one.
  if (raw === "::1") return "127.0.0.1";

  return raw;
}
