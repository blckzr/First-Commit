import { Router } from "express";
import { z } from "zod";
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
/**
 * §9: "Enter weekly hours as a number between 1 and 40." The same bounds the
 * onboarding step uses, and the same sentence, so a learner who meets the
 * limit twice reads it the same way both times.
 */
const RoadmapPatch = z
  .object({
    weeklyHours: z
      .number()
      .int("Enter weekly hours as a whole number between 1 and 40.")
      .min(1, "Enter weekly hours as a number between 1 and 40.")
      .max(40, "Enter weekly hours as a number between 1 and 40."),
  })
  .strict();

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

  /**
   * §5.5: "Adjust weekly hours".
   *
   * Hours are the learner's own statement about their life, not evidence, so
   * this is an ordinary update — unlike anything touching `module_completions`.
   * Scoped to the session user (§6.1 step 3), and the roadmap id in the URL is
   * confirmed to be theirs by the same `where` that does the update, so a
   * roadmap belonging to somebody else is a 404 rather than a silent no-op.
   */
  router.patch("/roadmaps/:id", requireAuth, async (req, res) => {
    const user = sessionUser(req);

    const id = req.params.id;
    if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) {
      throw new HttpError(404, "Not found");
    }

    const parsed = RoadmapPatch.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0].message);

    const updated = await pool.query<{ id: string }>(
      `update roadmaps set weekly_hours = $1, updated_at = now()
        where id = $2 and user_id = $3 and status = 'active'
        returning id`,
      [parsed.data.weeklyHours, id, user.id],
    );
    if (!updated.rows[0]) throw new HttpError(404, "Not found");

    /**
     * The learner's profile carries the same number — it is what the Roadmap
     * AI reads when planning the next one, so leaving the two to disagree
     * would mean the next roadmap silently used the old figure.
     */
    await pool.query(
      `update learner_profiles set weekly_hours = $1, updated_at = now() where user_id = $2`,
      [parsed.data.weeklyHours, user.id],
    );

    const roadmap = await buildRoadmap(pool, id, user.id);
    res.json({ roadmap });
  });

  return router;
}
