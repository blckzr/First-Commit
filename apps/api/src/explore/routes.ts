import { Router } from "express";
import { z } from "zod";
import type { Pool } from "pg";
import { HttpError } from "../middleware/errors.js";
import { requireAuth, sessionUser } from "../middleware/session.js";
import { buildExplore, buildFilterOptions, type ExploreFilters } from "./build.js";

/**
 * Explore modules (design.md §5.13).
 *
 * "Find and take any published module, including ones outside the roadmap."
 * Two reads and one write, and the write is the interesting one: **this is the
 * first endpoint in the repo that lets a learner change the shape of their own
 * roadmap.** Everything until now either generated a roadmap (the worker) or
 * reacted to a technology decision (`decisions/build.ts`).
 *
 * What it cannot do is the part worth stating. It writes `roadmap_items` and
 * nothing else: no `module_completions`, no score, no `passed` flag (§6 rule
 * 1). Adding a module to a plan is a statement of intent, not evidence, which
 * is exactly why a learner is allowed to do it at all.
 */

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A path parameter is untrusted. Refuse it before it reaches a uuid column. */
function pathId(value: unknown): string {
  if (typeof value !== "string" || !uuid.test(value)) throw new HttpError(404, "Not found");
  return value;
}

/**
 * A query parameter is untrusted too, and Express 5 types it
 * `string | string[] | ...` — a repeated `?skillId=` must not reach the query.
 * An unusable value is dropped rather than refused: a stale bookmark should
 * show the catalogue, not an error.
 */
function optionalId(value: unknown): string | undefined {
  return typeof value === "string" && uuid.test(value) ? value : undefined;
}

function optionalText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 100) : undefined;
}

const STATUSES = ["passed", "in_progress", "not_started"] as const;

function optionalStatus(value: unknown): (typeof STATUSES)[number] | undefined {
  return typeof value === "string" && (STATUSES as readonly string[]).includes(value)
    ? (value as (typeof STATUSES)[number])
    : undefined;
}

const AddItemBody = z
  .object({
    moduleId: z
      .string({ error: "Choose a module to add." })
      .regex(uuid, "Choose a module to add."),
  })
  .strict();

export function exploreRoutes(pool: Pool): Router {
  const router = Router();

  router.get("/explore", requireAuth, async (req, res) => {
    const user = sessionUser(req);

    const filters: ExploreFilters = {
      q: optionalText(req.query.q),
      skillId: optionalId(req.query.skillId),
      technologyId: optionalId(req.query.technologyId),
      careerPathId: optionalId(req.query.careerPathId),
      status: optionalStatus(req.query.status),
    };

    const raw = Number(req.query.page);
    const page = Number.isInteger(raw) && raw >= 1 ? raw : 1;

    res.json(await buildExplore(pool, user.id, filters, page));
  });

  /** The filter options the catalogue actually contains. */
  router.get("/explore/filters", requireAuth, async (_req, res) => {
    res.json(await buildFilterOptions(pool));
  });

  /**
   * §5.13's "add a module to a roadmap".
   *
   * **`source = 'learner_added'`**, which is what the enum value exists for and
   * what keeps this distinguishable from the Roadmap AI's own choices — §5.6
   * shows the difference, and a roadmap that could not tell them apart would
   * make "added after two quiz attempts" unexplainable.
   *
   * Ownership, then state, then content, in that order:
   *
   * - the roadmap must be the session user's (§6.1 step 4) and **active** —
   *   adding to an archived plan would quietly revive it, and to a completed
   *   one would reopen a finished certificate's basis;
   * - the module must be published, checked here rather than trusted from the
   *   list the browser was reading, which may be minutes stale.
   *
   * It does **not** check prerequisites. §5.13 offers any published module, and
   * §5.9's module page is where a lock is enforced — the response carries the
   * unmet ones so the screen can say "Pass JavaScript basics to unlock this
   * module" without pretending the add failed.
   */
  router.post("/roadmaps/:id/items", requireAuth, async (req, res) => {
    const user = sessionUser(req);
    const roadmapId = pathId(req.params.id);

    const parsed = AddItemBody.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0].message);
    const { moduleId } = parsed.data;

    const owned = await pool.query<{ status: string }>(
      `select status from roadmaps where id = $1 and user_id = $2`,
      [roadmapId, user.id],
    );
    if (!owned.rows[0]) throw new HttpError(404, "Not found");
    if (owned.rows[0].status !== "active") {
      throw new HttpError(
        409,
        owned.rows[0].status === "completed"
          ? "That roadmap is finished. Start a new one to keep learning."
          : "That roadmap is archived. Restore it from My roadmaps first.",
      );
    }

    const module = await pool.query<{ title: string }>(
      `select mv.title
         from modules m
         join module_versions mv on mv.module_id = m.id and mv.status = 'published'
        where m.id = $1 and m.status = 'published'`,
      [moduleId],
    );
    if (!module.rows[0]) throw new HttpError(404, "Not found");

    const client = await pool.connect();
    try {
      await client.query("begin");

      /**
       * `unique (roadmap_id, module_id)` is a table-level constraint, and
       * pg-mem will not match one with `on conflict` — a documented divergence.
       * Reading first is also what lets the three outcomes be told apart, which
       * `on conflict do update` cannot: already there, put back, or new.
       */
      const existing = await client.query<{ status: string }>(
        `select status from roadmap_items where roadmap_id = $1 and module_id = $2`,
        [roadmapId, moduleId],
      );

      if (existing.rows[0]?.status === "active") {
        await client.query("commit");
        res.json({ added: false, reason: "already-on-roadmap", title: module.rows[0].title });
        return;
      }

      if (existing.rows[0]) {
        /**
         * It was removed before — §5.8 takes the other technologies' modules
         * off this way. Put it back rather than inserting a second row, and
         * leave its `sort_order` alone so it returns where it was.
         */
        await client.query(
          `update roadmap_items
              set status = 'active', source = 'learner_added',
                  added_reason = 'You added this from Explore'
            where roadmap_id = $1 and module_id = $2`,
          [roadmapId, moduleId],
        );
      } else {
        // Appended, because the learner chose it after everything planned.
        const tail = await client.query<{ max: number | null }>(
          `select max(sort_order) as max from roadmap_items where roadmap_id = $1`,
          [roadmapId],
        );
        await client.query(
          `insert into roadmap_items (roadmap_id, module_id, sort_order, source, status, added_reason)
           values ($1, $2, $3, 'learner_added', 'active', 'You added this from Explore')`,
          [roadmapId, moduleId, Number(tail.rows[0]?.max ?? 0) + 1],
        );
      }

      await client.query(
        `update roadmaps set updated_at = now() where id = $1 and user_id = $2`,
        [roadmapId, user.id],
      );

      await client.query("commit");
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }

    res.json({ added: true, title: module.rows[0].title });
  });

  return router;
}
