import { Router } from "express";
import { z } from "zod";
import type { Pool } from "pg";
import { HttpError } from "../middleware/errors.js";
import { requireAdmin, requireAuth, sessionUser } from "../middleware/session.js";
import { logAdminAction } from "./log.js";

/**
 * Flagged AI feedback (design.md §6.8) — **the first admin route in the API.**
 *
 * So it is where two rules get their first implementation, and both are
 * enforced here rather than assumed:
 *
 * - **§6.1 step 5: check the role on admin routes**, and write to
 *   `admin_activity_log` when the action changes a learner's outcome.
 *   `requireAdmin` answers 404 rather than 403, because a 403 confirms the
 *   route exists to someone who should not know.
 * - **§6 rule 10: admins cannot mark modules passed or edit scores.** Ruling on
 *   a flag is a judgement about the *model*, not about the learner — it moves
 *   no evidence. Nothing here touches `module_completions`,
 *   `assessment_attempts` or `code_submissions`, and the tests assert that.
 *
 * A ruling is logged whichever way it goes. "Feedback was correct" is as much a
 * decision as "feedback was wrong": it closes a learner's complaint, and §6.12
 * commits to an unchangeable record of what an admin decided and why.
 */

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function id(value: unknown): string {
  if (typeof value !== "string" || !uuid.test(value)) throw new HttpError(404, "Not found");
  return value;
}

/** §6.8 filters by source. These are the `ai_job_type` values that produce output. */
const SOURCES = [
  "code_feedback",
  "milestone_review",
  "roadmap_generation",
  "technology_recommendation",
  "resume_generation",
] as const;

/**
 * §6.8: mark "Feedback was correct" or "Feedback was wrong" with notes.
 *
 * `status` may not be set back to `open` — reopening a ruling would leave the
 * log saying a decision was made that the row no longer reflects. Strict, so a
 * body reaching for `reason` (the learner's words, not the admin's) or a
 * `reviewedBy` other than the caller is refused.
 */
const RulingBody = z
  .object({
    status: z.enum(["confirmed_wrong", "confirmed_correct"]),
    notes: z.string().trim().max(2000, "Keep notes under 2000 characters.").optional(),
  })
  .strict();

interface FlagRow {
  id: string;
  reason: string;
  status: string;
  created_at: Date;
  admin_notes: string | null;
  reviewed_at: Date | null;
  source_type: string;
  source_id: string;
  content: unknown;
  learner_id: string;
  learner_name: string;
  reviewer_name: string | null;
}

const shape = (row: FlagRow) => ({
  id: row.id,
  /** The learner's own words. §6.8's detail view shows them beside the output. */
  reason: row.reason,
  status: row.status,
  createdAt: row.created_at,
  adminNotes: row.admin_notes,
  reviewedAt: row.reviewed_at,
  reviewedBy: row.reviewer_name,
  source: row.source_type,
  sourceId: row.source_id,
  /**
   * The AI output as written. This is an admin response, so the parts §6 rule 2
   * keeps from learners — a rubric, for instance — are fine here. That is the
   * whole point of the screen: judging the output means seeing all of it.
   */
  output: row.content,
  learner: { id: row.learner_id, fullName: row.learner_name },
});

export function adminFlagRoutes(pool: Pool): Router {
  const router = Router();

  /**
   * §6.8's list. Open flags first, because they are the ones needing a decision.
   *
   * No learner ids in the filter and no ownership check, because an admin is
   * *supposed* to see every learner's flags — which is exactly why
   * `requireAdmin` sits on the route and is mutation-tested.
   */
  router.get("/admin/flags", requireAuth, requireAdmin, async (req, res) => {
    const source = typeof req.query.source === "string" ? req.query.source : null;
    if (source !== null && !SOURCES.includes(source as (typeof SOURCES)[number])) {
      throw new HttpError(400, "That isn't a source of AI output.");
    }
    const status = typeof req.query.status === "string" ? req.query.status : null;
    if (status !== null && !["open", "confirmed_wrong", "confirmed_correct"].includes(status)) {
      throw new HttpError(400, "That isn't a flag status.");
    }

    const { rows } = await pool.query<FlagRow>(
      `select f.id, f.reason, f.status, f.created_at, f.admin_notes, f.reviewed_at,
              o.source_type, o.source_id, o.content,
              u.id as learner_id, u.full_name as learner_name,
              r.full_name as reviewer_name
         from ai_feedback_flags f
         join ai_outputs o on o.id = f.ai_output_id
         join users u      on u.id = f.user_id
         left join users r on r.id = f.reviewed_by
        where ($1::text is null or o.source_type::text = $1)
          and ($2::text is null or f.status::text = $2)
        order by (f.status = 'open') desc, f.created_at desc
        limit 200`,
      [source, status],
    );

    /**
     * §6.9's "share of flags confirmed as wrong" starts here. Counted over
     * every flag rather than the filtered page, so the figure does not change
     * when an admin narrows the list.
     */
    const totals = await pool.query<{ status: string; n: string }>(
      `select status::text as status, count(*) as n from ai_feedback_flags group by status`,
    );

    res.json({
      flags: rows.map(shape),
      counts: Object.fromEntries(totals.rows.map((t) => [t.status, Number(t.n)])),
    });
  });

  /** §6.8's detail view: the output, the learner's reason, and any ruling. */
  router.get("/admin/flags/:id", requireAuth, requireAdmin, async (req, res) => {
    const { rows } = await pool.query<FlagRow>(
      `select f.id, f.reason, f.status, f.created_at, f.admin_notes, f.reviewed_at,
              o.source_type, o.source_id, o.content,
              u.id as learner_id, u.full_name as learner_name,
              r.full_name as reviewer_name
         from ai_feedback_flags f
         join ai_outputs o on o.id = f.ai_output_id
         join users u      on u.id = f.user_id
         left join users r on r.id = f.reviewed_by
        where f.id = $1`,
      [id(req.params.id)],
    );
    if (!rows[0]) throw new HttpError(404, "Not found");
    res.json({ flag: shape(rows[0]) });
  });

  /**
   * Ruling on a flag.
   *
   * **The ruling and its log entry go in one transaction.** §6.12 promises an
   * unchangeable record of sensitive admin actions; a ruling that committed
   * while its log entry failed would be a decision nobody could account for,
   * which is worse than a ruling that did not happen.
   */
  router.patch("/admin/flags/:id", requireAuth, requireAdmin, async (req, res) => {
    const admin = sessionUser(req);
    const flagId = id(req.params.id);

    const parsed = RulingBody.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, parsed.error.issues[0]?.message ?? "Choose correct or wrong.");
    }
    const { status, notes } = parsed.data;

    const client = await pool.connect();
    try {
      await client.query("begin");

      const updated = await client.query<{ id: string; ai_output_id: string; user_id: string }>(
        `update ai_feedback_flags
            set status = $2, admin_notes = $3, reviewed_by = $4, reviewed_at = now()
          where id = $1
          returning id, ai_output_id, user_id`,
        [flagId, status, notes ?? null, admin.id],
      );
      if (!updated.rows[0]) {
        await client.query("rollback");
        throw new HttpError(404, "Not found");
      }

      await logAdminAction(client, {
        adminId: admin.id,
        action: status === "confirmed_wrong" ? "ai_flag.confirmed_wrong" : "ai_flag.confirmed_correct",
        targetType: "ai_feedback_flag",
        targetId: flagId,
        reason: notes ?? null,
        details: {
          aiOutputId: updated.rows[0].ai_output_id,
          learnerId: updated.rows[0].user_id,
        },
      });

      await client.query("commit");
    } catch (err) {
      await client.query("rollback").catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    const { rows } = await pool.query<FlagRow>(
      `select f.id, f.reason, f.status, f.created_at, f.admin_notes, f.reviewed_at,
              o.source_type, o.source_id, o.content,
              u.id as learner_id, u.full_name as learner_name,
              r.full_name as reviewer_name
         from ai_feedback_flags f
         join ai_outputs o on o.id = f.ai_output_id
         join users u      on u.id = f.user_id
         left join users r on r.id = f.reviewed_by
        where f.id = $1`,
      [flagId],
    );

    res.json({ flag: shape(rows[0]) });
  });

  return router;
}
