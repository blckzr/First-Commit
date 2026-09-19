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

export function supabaseConfig() {
  return {
    url: env("SUPABASE_URL"),
    serviceRoleKey: env("SUPABASE_SERVICE_ROLE_KEY"),
    pollMs: Number(env("WORKER_POLL_MS", "3000")),
  };
}
