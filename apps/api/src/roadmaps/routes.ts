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
      .max(40, "Enter weekly hours as a number between 1 and 40.")
      .optional(),
    /**
     * §5.12 archives a roadmap and restores one. `completed` is deliberately
     * not accepted: finishing a roadmap is something the platform works out
     * from the modules passed, not something the browser announces.
     */
    status: z.enum(["active", "archived"]).optional(),
  })
  .strict()
  // An empty body is a request that means nothing; better a 400 than a
  // no-op that reports success.
  .refine((v) => v.weeklyHours !== undefined || v.status !== undefined, {
    message: "Nothing to change.",
  });

interface RoadmapRow {
  id: string;
  careerPathId: string;
  careerPathTitle: string;
  trackTitle: string | null;
  status: string;
  weeklyHours: number | null;
  createdAt: Date;
}

export function roadmapRoutes(pool: Pool): Router {
  const router = Router();

  /**
   * §5.12's list: enough to choose between roadmaps, not the whole chart.
   *
   * **Archived roadmaps are included**, because §5.12 shows them behind a
   * "Archived (1) [Show]" disclosure and offers to restore one. §6 rule 5
   * means an archived roadmap is still there — archiving is a status, not a
   * delete.
   */
  router.get("/roadmaps", requireAuth, async (req, res) => {
    const user = sessionUser(req);

    const { rows } = await pool.query<RoadmapRow>(
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
        where r.user_id = $1
        order by r.created_at desc`,
      [user.id],
    );

    /**
     * The per-roadmap counts, gathered in one pass rather than per row.
     *
     * Kept as flat queries joined in JS for the same reason the roadmap chart
     * does it: pg-mem runs neither correlated subqueries against an outer
     * alias nor `= any($1::uuid[])`, and the tests build their schema from the
     * real migration.
     */
    const items = await pool.query<{ roadmap_id: string; module_id: string }>(
      `select i.roadmap_id, i.module_id
         from roadmap_items i
         join roadmaps r on r.id = i.roadmap_id
        where r.user_id = $1 and i.status = 'active'`,
      [user.id],
    );

    const passed = await pool.query<{ module_id: string; completed_at: Date }>(
      `select module_id, completed_at from module_completions where user_id = $1`,
      [user.id],
    );
    const passedAt = new Map(passed.rows.map((r) => [r.module_id, r.completed_at]));

    const studied = await pool.query<{ module_id: string; at: Date }>(
      `select v.module_id, p.completed_at as at
         from lesson_progress p
         join lessons l         on l.id = p.lesson_id
         join module_versions v on v.id = l.module_version_id
        where p.user_id = $1`,
      [user.id],
    );

    /** How many of this learner's roadmaps each module sits on (§5.12's "3 shared"). */
    const onHowMany = new Map<string, number>();
    for (const { module_id } of items.rows) {
      onHowMany.set(module_id, (onHowMany.get(module_id) ?? 0) + 1);
    }

    const latest = new Map<string, Date>();
    for (const { module_id, at } of studied.rows) {
      const current = latest.get(module_id);
      if (!current || at > current) latest.set(module_id, at);
    }

    const roadmaps = rows.map((r) => {
      const modules = items.rows.filter((i) => i.roadmap_id === r.id).map((i) => i.module_id);
      const done = modules.filter((m) => passedAt.has(m));

      /**
       * §6 rule 7: "Passing Git once counts everywhere." A module passed and
       * also on another of this learner's roadmaps is counted here **and**
       * marked shared, which is what §5.12's "(3 shared)" tells them — that
       * the credit carried over rather than being earned twice.
       */
      const shared = done.filter((m) => (onHowMany.get(m) ?? 0) > 1).length;

      const times = [
        ...modules.map((m) => latest.get(m)),
        ...done.map((m) => passedAt.get(m)),
      ].filter((t): t is Date => t instanceof Date);

      return {
        ...r,
        passedCount: done.length,
        totalCount: modules.length,
        sharedCount: shared,
        lastStudiedAt:
          times.length === 0
            ? null
            : new Date(Math.max(...times.map((t) => t.getTime()))).toISOString(),
      };
    });

    res.json({ roadmaps });
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

    const { weeklyHours, status } = parsed.data;

    /**
     * Ownership first, and on its own, because the two changes below have
     * different reach: hours only make sense on an active roadmap, while
     * §5.12's restore has to find an archived one.
     */
    const owned = await pool.query<{ status: string }>(
      `select status from roadmaps where id = $1 and user_id = $2`,
      [id, user.id],
    );
    if (!owned.rows[0]) throw new HttpError(404, "Not found");

    /**
     * §6 rule 5: archiving is a status, never a delete. A roadmap the learner
     * put away keeps its items and the evidence behind them, so restoring it
     * restores the real thing rather than a fresh plan.
     *
     * `completed` is left alone — this only moves between active and
     * archived, so putting away a finished roadmap and bringing it back does
     * not quietly reopen it.
     */
    if (status !== undefined) {
      await pool.query(
        `update roadmaps set status = $1, updated_at = now()
          where id = $2 and user_id = $3 and status <> 'completed'`,
        [status, id, user.id],
      );
    }

    if (weeklyHours !== undefined) {
      const updated = await pool.query<{ id: string }>(
        `update roadmaps set weekly_hours = $1, updated_at = now()
          where id = $2 and user_id = $3 and status = 'active'
          returning id`,
        [weeklyHours, id, user.id],
      );
      if (!updated.rows[0]) throw new HttpError(404, "Not found");

      /**
       * The learner's profile carries the same number — it is what the Roadmap
       * AI reads when planning the next one, so leaving the two to disagree
       * would mean the next roadmap silently used the old figure.
       */
      await pool.query(
        `update learner_profiles set weekly_hours = $1, updated_at = now() where user_id = $2`,
        [weeklyHours, user.id],
      );
    }

    const roadmap = await buildRoadmap(pool, id, user.id);
    res.json({ roadmap });
  });

  return router;
}
