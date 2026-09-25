import "dotenv/config";

export type JsonMode = "think_off_schema" | "think_on_schema" | "prompt_only";

function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === "") {
    throw new Error(`Missing environment variable ${name}. Copy .env.example to .env and fill it in.`);
  }
  return value;
}

export const config = {
  ollamaUrl: env("OLLAMA_URL", "http://127.0.0.1:11434"),
  model: env("AI_MODEL", "qwen3.5:4b"),
  jsonMode: env("AI_JSON_MODE", "think_off_schema") as JsonMode,
  context: Number(env("AI_CONTEXT", "8192")),
  contextLarge: Number(env("AI_CONTEXT_LARGE", "16384")),
  timeoutMs: Number(env("AI_TIMEOUT_MS", "120000")),

  /**
   * Which sandbox runs a learner's code (§5.11). `none` until one is set up,
   * which makes a submission fail with a message rather than wait forever.
   * See `src/runner.ts`.
   */
  codeRunner: env("CODE_RUNNER", "none"),

  /**
   * Judge0, when `CODE_RUNNER=judge0`. Setup is `docker/judge0/README.md`.
   *
   * `127.0.0.1` rather than `localhost`: on Windows `localhost` can resolve to
   * `::1` first, and Judge0's published port binds IPv4 — the same trap the
   * Ollama URL avoids for the same reason.
   *
   * The limits are per submission and deliberately tight. This machine also
   * holds a model in VRAM and runs one job at a time (AGENT.md §7), so a
   * learner's runaway loop must not be able to take the slot for long or
   * pressure the host.
   */
  judge0Url: env("JUDGE0_URL", "http://127.0.0.1:2358"),
  judge0Token: process.env.JUDGE0_TOKEN?.trim() || null,
  judge0CpuSeconds: Number(env("JUDGE0_CPU_SECONDS", "5")),
  judge0MemoryKb: Number(env("JUDGE0_MEMORY_KB", "128000")),
};

/**
 * Database and API settings.
 *
 * The worker uses **session mode** (port 5432), not the transaction pooler the
 * API uses (6543). It is one long-lived process holding one connection, which
 * is what session mode is for; transaction mode suits many short-lived clients,
 * which is the API on Render. Both work — Supavisor keeps prepared statements
 * in transaction mode — but a process that never disconnects should not be
 * competing for the pool the API shares.
 *
 * On Supabase, session mode is still the **pooler host**, on 5432. The true
 * direct host, `db.<project-ref>.supabase.co`, is IPv6-only: an IPv4-only
 * machine gets ENOTFOUND and no amount of retrying helps.
 *
 * `apiUrl` and `workerSecret` are optional: without them the worker still
 * writes its results, and the API's periodic sweep picks them up. A missed
 * notice delays an update rather than losing it.
 */
export function dbConfig() {
  return {
    databaseUrl: env("DATABASE_URL"),
    pollMs: Number(env("WORKER_POLL_MS", "3000")),
    apiUrl: process.env.API_URL?.trim() || null,
    workerSecret: process.env.WORKER_SECRET?.trim() || null,
  };
}
