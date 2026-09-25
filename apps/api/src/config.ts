/**
 * Environment configuration, validated once at import.
 *
 * Everything the API needs is read here and nowhere else, so a missing
 * variable fails at boot with a named error rather than as an undefined deep
 * inside a request handler.
 */

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `Missing environment variable ${name}. Copy .env.example to .env and fill it in.`,
    );
  }
  return value;
}

/**
 * A secret, checked for being one.
 *
 * `required()` only asks whether a value is non-empty, which let
 * `SESSION_SECRET=<node -e "…">` — the instruction text from `.env.example`,
 * pasted rather than run — pass validation and go on to sign real cookies.
 * That is exactly the kind of thing that reaches production, so a secret gets
 * two more questions: is it long enough to be one, and does it look like a
 * placeholder somebody forgot to replace.
 */
export function secret(name: string, minLength = 32): string {
  const value = required(name);

  if (value.startsWith("<") || value.includes("$(") || value.includes("YOUR_")) {
    throw new Error(
      `${name} looks like the instruction from .env.example rather than a value. ` +
        `Generate one with: node -e "console.log(crypto.randomBytes(32).toString('hex'))"`,
    );
  }
  if (value.length < minLength) {
    throw new Error(
      `${name} is ${value.length} characters; it needs at least ${minLength}. ` +
        `Generate one with: node -e "console.log(crypto.randomBytes(32).toString('hex'))"`,
    );
  }
  return value;
}

function optional(name: string): string | null {
  return process.env[name]?.trim() || null;
}

const nodeEnv = process.env.NODE_ENV ?? "development";

export const config = {
  nodeEnv,
  isProduction: nodeEnv === "production",
  port: Number(process.env.PORT ?? 4000),

  /**
   * The API uses the **connection pooler** (port 6543). Render restarts often
   * and pooling avoids exhausting connections (docs/database-schema.md §9.3).
   * The worker is the opposite case and uses a direct connection.
   */
  databaseUrl: required("DATABASE_URL"),

  /** Signs session cookies. */
  sessionSecret: secret("SESSION_SECRET"),

  /** The frontend's origin, for CORS and cookies. Credentials require it to be explicit. */
  appOrigin: required("APP_ORIGIN"),

  /**
   * Shared with the local worker so it can report a finished job
   * (`POST /internal/events`). Optional: without it the endpoint refuses
   * everything and the periodic sweep is the only path, which is slower but
   * still correct.
   */
  workerSecret: optional("WORKER_SECRET"),

  /**
   * Transactional mail. Unset means the console transport — links are logged
   * rather than sent, which is enough to build and test all of §6.3.
   */
  brevoApiKey: optional("BREVO_API_KEY"),
  mailFrom: optional("MAIL_FROM"),
  mailFromName: optional("MAIL_FROM_NAME") ?? "First Commit",
} as const;

export type Config = typeof config;
