import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { Pool } from "pg";
import { SESSION_COOKIE, resolveSession, type SessionUser } from "../auth/sessions.js";
import { HttpError } from "./errors.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by `attachSession`. Present on every request; null when signed out. */
      user?: SessionUser | null;
      /** The raw cookie value, for log out. Never logged, never sent anywhere. */
      sessionToken?: string;
    }
  }
}

/**
 * The request pipeline from docs/database-schema.md §6.1.
 *
 * **Read AGENT.md §6 before changing anything here.** The database no longer
 * knows who is asking, so this is the only thing between an account and other
 * people's data — and unlike Row Level Security it *fails open*. A forgotten
 * check does not throw; it quietly serves the wrong learner's records.
 *
 * Steps 1 and 2 run on every request. Steps 3 to 6 cannot be middleware because
 * they depend on what a handler is reading, so they are the helpers below plus
 * a rule: filter by `req.user.id`, never by an id from the body or query, and
 * always name your columns.
 */

/** §6.1 step 1 — resolve the session. Never rejects; that is `requireAuth`'s job. */
export function attachSession(pool: Pool): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    req.user = null;
    const token: unknown = req.cookies?.[SESSION_COOKIE];
    if (typeof token !== "string" || !token) return next();

    req.sessionToken = token;
    req.user = await resolveSession(pool, token);
    next();
  };
}

/**
 * §6.1 steps 1 and 2 — require a session, and reject suspended accounts before
 * anything else.
 */
export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.user) throw new HttpError(401, "You need to be signed in to do that.");
  if (req.user.status === "suspended") {
    throw new HttpError(403, "This account is suspended. Contact an administrator.");
  }
  next();
};

/** §6.1 step 5 — admin routes check the role. Use after `requireAuth`. */
export const requireAdmin: RequestHandler = (req, _res, next) => {
  if (req.user?.role !== "admin") {
    // Same answer as a missing record: an admin route must not confirm it exists.
    throw new HttpError(404, "Not found");
  }
  next();
};

/**
 * The session user, or a thrown 401. Use this in handlers instead of
 * `req.user!` so a route that forgot `requireAuth` fails loudly rather than
 * dereferencing undefined.
 */
export function sessionUser(req: Request): SessionUser {
  if (!req.user) throw new HttpError(401, "You need to be signed in to do that.");
  return req.user;
}

/**
 * §6.1 step 4 — confirm an id in the URL belongs to the session user.
 *
 * Takes the count of rows matching both the id *and* the owner. A zero count
 * answers 404, not 403: telling someone their guess names a real record that
 * belongs to somebody else is itself a leak.
 *
 *   const { rowCount } = await pool.query(
 *     "select 1 from roadmaps where id = $1 and user_id = $2",
 *     [req.params.id, user.id],
 *   );
 *   assertOwned(rowCount);
 */
export function assertOwned(rowCount: number | null): void {
  if (!rowCount) throw new HttpError(404, "Not found");
}
