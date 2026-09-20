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
};

/**
 * Database and API settings.
 *
 * The worker uses a **direct** PostgreSQL connection (port 5432), not the
 * pooler the API uses. It holds one long-lived connection and claims jobs
 * inside a transaction with `for update skip locked`, which transaction
 * pooling does not suit.
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
