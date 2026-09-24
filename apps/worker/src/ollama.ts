import { z } from "zod";
import { config, type JsonMode } from "./config.js";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatJsonOptions<T extends z.ZodType> {
  schema: T;
  messages: ChatMessage[];
  model?: string;
  mode?: JsonMode;
  context?: number;
  temperature?: number;
  maxAttempts?: number;
  /** Extra checks the schema can't express. Return an error message, or null if valid. */
  validate?: (data: z.infer<T>) => string | null;
}

export interface ChatJsonResult<T> {
  data: T;
  model: string;
  mode: JsonMode;
  attempts: number;
  durationMs: number;
}

interface OllamaChatResponse {
  message?: { content?: string; thinking?: string };
  error?: string;
}

/** Sends one request to Ollama's native chat API. */
async function ollamaChat(body: Record<string, unknown>): Promise<OllamaChatResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const res = await fetch(`${config.ollamaUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const json = (await res.json()) as OllamaChatResponse;
    if (!res.ok) throw new Error(json.error ?? `Ollama returned HTTP ${res.status}`);
    return json;
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      throw new Error(`Ollama did not respond within ${config.timeoutMs} ms`);
    }
    /**
     * `fetch` reports a refused connection as the bare string "fetch failed",
     * which is what lands in `ai_jobs.error` and tells whoever reads it
     * nothing. The overwhelmingly common cause is that Ollama is not running,
     * so say that and where we looked.
     */
    if (err instanceof TypeError) {
      throw new Error(
        `Could not reach Ollama at ${config.ollamaUrl} — is it running? Start it with \`ollama serve\`.`,
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Pulls a JSON object out of text, tolerating ```json fences or stray words around it. */
export function extractJson(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end <= start) throw new Error("No JSON object found in model output");
    return JSON.parse(cleaned.slice(start, end + 1));
  }
}

/**
 * Asks the model for JSON matching `schema`, validates it, and retries with the
 * validation error if the output is invalid.
 */
export async function chatJson<T extends z.ZodType>(opts: ChatJsonOptions<T>): Promise<ChatJsonResult<z.infer<T>>> {
  const model = opts.model ?? config.model;
  const mode = opts.mode ?? config.jsonMode;
  const maxAttempts = opts.maxAttempts ?? 3;
  const jsonSchema = z.toJSONSchema(opts.schema);
  const messages: ChatMessage[] = [...opts.messages];

  if (mode === "prompt_only") {
    messages.unshift({
      role: "system",
      content:
        "Respond with only a JSON object, no other text, matching this JSON Schema:\n" +
        JSON.stringify(jsonSchema),
    });
  }

  const started = Date.now();
  let lastError = "";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const body: Record<string, unknown> = {
      model,
      messages,
      stream: false,
      think: mode === "think_on_schema",
      options: { temperature: opts.temperature ?? 0.2, num_ctx: opts.context ?? config.context },
    };
    if (mode !== "prompt_only") body.format = jsonSchema;

    const response = await ollamaChat(body);
    const content = response.message?.content ?? "";

    try {
      const parsed = opts.schema.safeParse(extractJson(content));
      if (!parsed.success) throw new Error(z.prettifyError(parsed.error));
      const extra = opts.validate?.(parsed.data);
      if (extra) throw new Error(extra);
      return { data: parsed.data, model, mode, attempts: attempt, durationMs: Date.now() - started };
    } catch (err) {
      lastError = (err as Error).message;
      // Give the model its previous answer and the problem, then ask again.
      messages.push(
        { role: "assistant", content: content || "(empty response)" },
        { role: "user", content: `That response was invalid: ${lastError}\nReturn corrected JSON only.` },
      );
    }
  }

  throw new Error(`Model output was invalid after ${maxAttempts} attempts: ${lastError}`);
}

/** Lists installed models, used by the setup check. */
export async function listModels(): Promise<string[]> {
  const res = await fetch(`${config.ollamaUrl}/api/tags`);
  if (!res.ok) throw new Error(`Ollama returned HTTP ${res.status}`);
  const json = (await res.json()) as { models?: { name: string }[] };
  return (json.models ?? []).map((m) => m.name);
}
