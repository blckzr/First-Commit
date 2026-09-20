import { Router } from "express";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { config } from "../config.js";
import { HttpError } from "../middleware/errors.js";
import { requireAuth, sessionUser } from "../middleware/session.js";
import type { EventHub } from "./hub.js";
import { parseCursor } from "./hub.js";

/**
 * The learner's stream. §6.1 applies here as much as anywhere: the stream is
 * scoped to `req.user.id` from the session, never to an id in the query string,
 * so one learner cannot subscribe to another's results.
 */
export function eventRoutes(hub: EventHub): Router {
  const router = Router();

  router.get("/events", requireAuth, async (req, res) => {
    const user = sessionUser(req);

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Render and other proxies buffer by default, which holds events until
      // the response ends — the opposite of the point.
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();

    // Tell the browser how long to wait before reconnecting.
    res.write("retry: 3000\n\n");

    const cursor = parseCursor(req.get("last-event-id"));
    const close = hub.add(user.id, res, cursor);

    // Anything that arrived while this learner was disconnected.
    await hub.flush(user.id).catch((err: unknown) => {
      console.error("[events] catch-up failed:", (err as Error).message);
    });

    req.on("close", close);
  });

  return router;
}

const NotifyBody = z.object({
  userId: z.string().uuid(),
  jobId: z.string().uuid().optional(),
  type: z.string().optional(),
});

/**
 * The worker's notification hook.
 *
 * **Mounted before the CSRF guard**, because the worker is not a browser and
 * sends no `Origin`. It authenticates with `WORKER_SECRET` instead.
 *
 * The body is only a hint about *who* has something waiting. The API reads the
 * rows itself, so a caller who somehow got the secret still cannot inject
 * content into a learner's stream.
 */
export function internalEventRoutes(hub: EventHub, workerSecret = config.workerSecret): Router {
  const router = Router();

  router.post("/internal/events", async (req, res) => {
    if (!workerSecret) {
      // Unconfigured means closed, not open: an unset secret must not leave
      // the route standing open to anyone who finds it.
      throw new HttpError(404, "Not found");
    }

    const presented = req.get("x-worker-secret") ?? "";
    if (!safeEqual(presented, workerSecret)) {
      throw new HttpError(401, "Unauthorized");
    }

    const parsed = NotifyBody.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0].message);

    await hub.flush(parsed.data.userId);

    // 202: the API has taken responsibility, and the sweep is the backstop if
    // this learner has no stream open right now.
    res.status(202).end();
  });

  return router;
}

/** Constant-time comparison, so the secret cannot be guessed a byte at a time. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
