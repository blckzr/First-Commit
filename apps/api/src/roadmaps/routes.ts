import { Router } from "express";
import type { Pool } from "pg";
import { HttpError } from "../middleware/errors.js";
import { requireAuth, sessionUser } from "../middleware/session.js";
import { buildRoadmap } from "./build.js";

/**
 * The learner's roadmaps (design.md §5.7, §5.12).
 *
 * **Ownership is the whole job of this file.** A roadmap id comes from the URL,
 * so it is untrusted (docs/database-schema.md §6.1 step 4). `buildRoadmap`
 * filters on `user_id` in its first query and returns null when the roadmap is
 * not the caller's, and the route turns that into a 404 — not a 403, which
 * would confirm the roadmap exists.
 *
 * Nothing here writes. A roadmap is written by the worker from content it read
 * itself; the browser never sends progress (AGENT.md §6 rule 1).
 */
export function roadmapRoutes(pool: Pool): Router {
  const router = Router();

  /** Enough to list and switch between roadmaps, not the whole chart. */
  router.get("/roadmaps", requireAuth, async (req, res) => {
    const user = sessionUser(req);

    const { rows } = await pool.query(
      `select r.id,
              r.career_path_id      as "careerPathId",
              cp.title              as "careerPathTitle",
              t.title               as "trackTitle",
              r.status,
              r.weekly_hours        as "weeklyHours",
              r.created_at          as "createdAt"
         from roadmaps r
         join career_paths cp on cp.id = r.career_path_id
         left join tracks t   on t.id = r.track_id
        where r.user_id = $1 and r.status <> 'archived'
        order by r.created_at desc`,
      [user.id],
    );

    res.json({ roadmaps: rows });
  });

  router.get("/roadmaps/:id", requireAuth, async (req, res) => {
    const user = sessionUser(req);

    // Express 5 types a param as string | string[]; a repeated `?id=` must not
    // reach the query. And a malformed id is a 404 rather than a uuid cast
    // error surfacing as a 500.
    const id = req.params.id;
    if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) {
      throw new HttpError(404, "Not found");
    }

    const roadmap = await buildRoadmap(pool, id, user.id);
    if (!roadmap) throw new HttpError(404, "Not found");

    res.json({ roadmap });
  });

  return router;
}
