import type { RequestHandler } from "express";
import { config } from "../config.js";
import { HttpError } from "./errors.js";

/**
 * CSRF defense (docs/database-schema.md §6.3).
 *
 * **Why CORS is not enough on its own.** In production the session cookie is
 * `sameSite=none`, so browsers attach it to cross-site requests. A `fetch` from
 * another origin is stopped, because sending credentials cross-origin triggers
 * a preflight and our CORS only allows `APP_ORIGIN`. But a plain HTML form post
 * is a *simple request*: no preflight, and the cookie rides along. Any endpoint
 * that does not need a parseable JSON body — log out is the obvious one — would
 * act on it.
 *
 * So every state-changing request must carry an `Origin` we recognise. Browsers
 * set `Origin` on all POST requests including form posts, and script cannot
 * forge it.
 *
 * Non-browser callers (the local worker posting to `/internal/events`) send no
 * `Origin` at all; those routes authenticate with a shared secret instead and
 * are mounted outside this guard.
 */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export const requireSameOrigin: RequestHandler = (req, _res, next) => {
  if (SAFE_METHODS.has(req.method)) return next();

  const origin = req.get("origin");

  if (!origin) {
    // Some browsers omit Origin on same-origin form posts, so fall back to
    // Referer before refusing.
    const referer = req.get("referer");
    if (referer && originOf(referer) === config.appOrigin) return next();

    throw new HttpError(403, "This request could not be verified. Reload the page and try again.");
  }

  if (origin !== config.appOrigin) {
    throw new HttpError(403, "This request could not be verified. Reload the page and try again.");
  }

  next();
};

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}
