import { z } from "zod";

/**
 * The API client.
 *
 * Everything the browser knows about the server goes through here, so there is
 * one place that sets credentials, one place that decides what an error means,
 * and one place that validates a response before the rest of the app trusts it.
 *
 * `credentials: "include"` on every request, because the session is an
 * `httpOnly` cookie the browser will not attach cross-origin otherwise. The API
 * allows exactly this origin (`APP_ORIGIN`) and refuses any other.
 */

const BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

/**
 * An error the API deliberately returned.
 *
 * `message` is safe to show: the API only sends its own copy, never an internal
 * failure (see the API's `errorHandler`). design.md §9 says errors explain and
 * direct, so these are written to be displayed as-is.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** No session, or it expired. Callers usually redirect rather than show this. */
  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  /** Rate limited. design.md §9: tell them what to do, not that they failed. */
  get isTooMany(): boolean {
    return this.status === 429;
  }
}

const ErrorBody = z.object({ error: z.string() });

interface RequestOptions<T> {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  /** Parsed before the caller sees it, so a shape change fails here, loudly. */
  schema: z.ZodType<T>;
  signal?: AbortSignal;
}

export async function apiRequest<T>(path: string, options: RequestOptions<T>): Promise<T> {
  const { method = "GET", body, schema, signal } = options;

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method,
      credentials: "include",
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    // design.md §9: say what happened and what to do.
    throw new ApiError(0, "We couldn't reach the server. Check your connection and try again.");
  }

  if (response.status === 204) {
    return schema.parse(undefined);
  }

  const text = await response.text();
  let payload: unknown = undefined;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      throw new ApiError(response.status, "The server sent something we couldn't read.");
    }
  }

  if (!response.ok) {
    const parsed = ErrorBody.safeParse(payload);
    throw new ApiError(
      response.status,
      parsed.success ? parsed.data.error : "Something went wrong. Try again in a moment.",
    );
  }

  const result = schema.safeParse(payload);
  if (!result.success) {
    // A shape mismatch is a bug, not something to render. Fail here rather
    // than letting a half-valid object reach a component.
    console.error("[api] unexpected response shape for", path, result.error.issues);
    throw new ApiError(response.status, "The server sent something unexpected.");
  }
  return result.data;
}
