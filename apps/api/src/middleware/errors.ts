import type { ErrorRequestHandler, RequestHandler } from "express";
import { config } from "../config.js";

/**
 * An error with an HTTP status attached. Throw these from handlers; Express 5
 * forwards rejected promises to the error handler on its own, so no async
 * wrapper is needed.
 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const notFound: RequestHandler = (_req, res) => {
  res.status(404).json({ error: "Not found" });
};

/**
 * design.md §9: errors explain and direct, without apologising or being vague.
 *
 * Only an HttpError's message is sent to the client. Anything else is logged
 * and answered generically, so an internal failure cannot leak a query, a
 * path, or a column name.
 */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }

  console.error("[api] unhandled:", err);
  res.status(500).json({
    error: "Something went wrong on our end. Try again in a moment.",
    ...(config.isProduction ? {} : { detail: (err as Error).message }),
  });
};
