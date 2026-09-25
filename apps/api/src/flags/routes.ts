import { Router } from "express";
import { z } from "zod";
import type { Pool } from "pg";
import { HttpError } from "../middleware/errors.js";
import { requireAuth, sessionUser } from "../middleware/session.js";

/**
 * Flagging AI output as wrong (AGENT.md §7: "All AI output is labeled as AI in
 * the UI, carries a short reason, and is flaggable by learners").
 *
 * §5.5, §5.8, and §5.11 each put "Is this wrong?" under an AI panel, so this is
 * one endpoint rather than three: a flag points at the `ai_outputs` row the
 * text came from, whichever screen showed it.
 *
 * **The flag is the learner's opinion, not a verdict.** It records what they
 * said and leaves `status = 'open'` for an admin to judge on `/admin/flags`.
 * Nothing here touches the output, the roadmap, or any evidence — a learner
 * disagreeing with a model is not a reason to change what happened.
 */

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function id(value: unknown): string {
  if (typeof value !== "string" || !uuid.test(value)) throw new HttpError(404, "Not found");
  return value;
}

/**
 * Strict, and `reason` is the only field. A body carrying `status` would
 * otherwise let a learner mark their own flag `confirmed_wrong`, which is the
 * admin's call and a logged one (§6 rule 10).
 */
const FlagBody = z
  .object({
    reason: z
      .string()
      .trim()
      .min(1, "Say what is wrong with it.")
      .max(1000, "Keep it under 1000 characters."),
  })
  .strict();

export function flagRoutes(pool: Pool): Router {
  const router = Router();

  router.post("/ai-outputs/:id/flags", requireAuth, async (req, res) => {
    const user = sessionUser(req);
    const outputId = id(req.params.id);

    const parsed = FlagBody.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, parsed.error.issues[0]?.message ?? "Say what is wrong with it.");
    }

    /**
     * §6.1 step 4: the id came from the browser, so it is confirmed to belong
     * to this learner before anything is written. 404 rather than 403 — a
     * different status would confirm that somebody else's output exists.
     */
    const owned = await pool.query<{ id: string }>(
      `select id from ai_outputs where id = $1 and user_id = $2`,
      [outputId, user.id],
    );
    if (!owned.rows[0]) throw new HttpError(404, "Not found");

    /**
     * One flag per learner per output (the table's unique constraint), so
     * whether they have flagged this before decides both what is written and
     * what is answered.
     *
     * **Asked outright rather than inferred from `returning`.** pg-mem hands
     * back the existing row from `on conflict do nothing … returning` where
     * PostgreSQL hands back nothing, so branching on that would have behaved
     * one way in the tests and another in production.
     */
    const before = await pool.query<FlagRow>(
      `select id, status, created_at from ai_feedback_flags
        where ai_output_id = $1 and user_id = $2`,
      [outputId, user.id],
    );

    if (!before.rows[0]) {
      // `do nothing` is the guard for two tabs flagging at once; the select
      // below is then what answers.
      await pool.query(
        `insert into ai_feedback_flags (ai_output_id, user_id, reason)
         values ($1, $2, $3)
         on conflict (ai_output_id, user_id) do nothing`,
        [outputId, user.id, parsed.data.reason],
      );
    } else {
      /**
       * Rewriting the reason is fine — a learner who wants to say it better
       * should be able to — **unless an admin has already reviewed it**, in
       * which case the verdict and the notes stand and re-flagging does not
       * quietly reopen a decision somebody made.
       */
      await pool.query(
        `update ai_feedback_flags set reason = $3
          where ai_output_id = $1 and user_id = $2 and status = 'open'`,
        [outputId, user.id, parsed.data.reason],
      );
    }

    const flag = await pool.query<FlagRow>(
      `select id, status, created_at from ai_feedback_flags
        where ai_output_id = $1 and user_id = $2`,
      [outputId, user.id],
    );

    res.status(before.rows[0] ? 200 : 201).json({ flag: shape(flag.rows[0]) });
  });

  return router;
}

/**
 * What a learner may read back. `reviewed_by`, `reviewed_at`, and `admin_notes`
 * are left out — §6 rule 2 keeps admin review off a learner response, and the
 * screen only needs to know the flag landed.
 */
interface FlagRow {
  id: string;
  status: string;
  created_at: Date;
}

function shape(row: FlagRow) {
  return { id: row.id, status: row.status, createdAt: row.created_at };
}
