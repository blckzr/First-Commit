import { Pool } from "pg";
import { config } from "./config.js";

/**
 * The database pool.
 *
 * Points at the **connection pooler** (port 6543). Render restarts often and
 * the free plan sleeps, so a direct connection per instance would exhaust
 * Supabase's limit; see docs/database-schema.md §9.3 step 1.
 *
 * `pg` connects lazily, so importing this does not require a reachable
 * database — the API boots, `/health` answers, and `/health/db` reports the
 * problem. That is deliberate: a health check that fails because the database
 * blinked would have Render restart a perfectly good process.
 */
export const pool = new Pool({
  connectionString: config.databaseUrl,
  // Supabase presents a certificate this client will not chain to a local
  // root, which is the documented way to connect.
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

pool.on("error", (err) => {
  // An idle client failing is not fatal; pg will replace it.
  console.error("[db] idle client error:", err.message);
});

export interface DbHealth {
  ok: boolean;
  latencyMs: number;
  error?: string;
}

/**
 * Connection failures often arrive as an AggregateError — Node tries IPv6 and
 * IPv4 in parallel, and the wrapper's own `message` is empty. Reporting that
 * verbatim gives `"error": ""`, which tells an operator nothing.
 */
function describe(err: unknown): string {
  if (err instanceof AggregateError) {
    const inner = err.errors
      .map((e) => describe(e))
      .filter((m, i, all) => m && all.indexOf(m) === i);
    if (inner.length) return inner.join("; ");
  }
  if (err instanceof Error) {
    const code = (err as NodeJS.ErrnoException).code;
    if (err.message) return code ? `${code}: ${err.message}` : err.message;
    if (code) return code;
    return err.name;
  }
  return String(err);
}

export async function checkDb(): Promise<DbHealth> {
  const started = Date.now();
  try {
    await pool.query("select 1");
    return { ok: true, latencyMs: Date.now() - started };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - started, error: describe(err) };
  }
}
