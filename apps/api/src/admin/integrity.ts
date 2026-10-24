import { Router } from "express";
import { z } from "zod";
import type { Pool } from "pg";
import { HttpError } from "../middleware/errors.js";
import { requireAdmin, requireAuth, sessionUser } from "../middleware/session.js";
import { logAdminAction } from "./log.js";

/**
 * Flagged capstone projects (`design.md` §6.7, `project-proposal.md` §6).
 *
 * The second admin surface, and it follows `/admin/flags` exactly: `requireAdmin`
 * answers **404 rather than 403**, because a 403 confirms the route exists to
 * somebody who should not know it does; and any ruling that changes a learner's
 * outcome is written to `admin_activity_log` **in the same transaction** as the
 * ruling itself (§6.1 step 5).
 *
 * ### A ruling always carries a reason
 *
 * The schema insists — `check (status = 'open' or decision_reason is not null)` —
 * and so does §6 rule 10: an admin's correction is a logged override with a
 * required reason, never a silent change. The constraint and the validation say
 * the same thing in two places on purpose; the first is what holds if a future
 * endpoint forgets the second.
 *
 * ### What this cannot do
 *
 * It cannot revoke a certificate. Deciding a flag records what an admin
 * concluded; revoking is a separate action on `certificates` with its own
 * reason, and keeping them apart means "we looked at this and it was fine" and
 * "we withdrew this" can never be the same click.
 */

const RulingBody = z
  .object({
    status: z.enum(["cleared", "explanation_requested", "redo_requested", "rejected"]),
    reason: z.string().trim().min(1, "Say why — a ruling without a reason is not reviewable."),
  })
  .strict();

const UUID = /^[0-9a-f-]{36}$/i;

function id(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new HttpError(404, "Not found");
  return value;
}

export function adminIntegrityRoutes(pool: Pool): Router {
  const router = Router();

  /** Open flags first — they are the ones needing attention. */
  router.get("/admin/integrity", requireAuth, requireAdmin, async (req, res) => {
    const status = typeof req.query.status === "string" ? req.query.status : null;

    const { rows } = await pool.query(
      `select f.id, f.type, f.status, f.details, f.created_at, f.decided_at, f.decision_reason,
              p.id as project_id, p.repo_full_name, p.demo_url,
              bv.title as brief_title,
              u.id as learner_id, u.full_name as learner_name
         from integrity_flags f
         join capstone_projects p on p.id = f.project_id
         join capstone_brief_versions bv on bv.id = p.brief_version_id
         join users u on u.id = p.user_id
        where ($1::text is null or f.status = $1)
        order by (f.status = 'open') desc, f.created_at desc
        limit 100`,
      [status],
    );

    res.json({
      flags: rows.map((row) => ({
        id: row.id,
        type: row.type,
        status: row.status,
        details: row.details,
        createdAt: row.created_at,
        decidedAt: row.decided_at,
        decisionReason: row.decision_reason,
        project: {
          id: row.project_id,
          briefTitle: row.brief_title,
          repoFullName: row.repo_full_name,
          demoUrl: row.demo_url,
        },
        learner: { id: row.learner_id, name: row.learner_name },
      })),
    });
  });

  /**
   * One flag with what an admin needs to judge it: the commit history, and the
   * explanation answers the learner wrote.
   *
   * This is the **only** place those answers are read. §5.14 says they are
   * "saved for admin review if the project is flagged", and that is exactly the
   * condition — there is no endpoint that returns an explanation answer for a
   * project nobody has flagged.
   */
  router.get("/admin/integrity/:id", requireAuth, requireAdmin, async (req, res) => {
    const flagId = id(req.params.id);

    const flag = await pool.query<{
      id: string;
      type: string;
      status: string;
      details: unknown;
      project_id: string;
      repo_full_name: string | null;
      brief_title: string;
      learner_name: string;
    }>(
      `select f.id, f.type, f.status, f.details, p.id as project_id,
              p.repo_full_name, bv.title as brief_title, u.full_name as learner_name
         from integrity_flags f
         join capstone_projects p on p.id = f.project_id
         join capstone_brief_versions bv on bv.id = p.brief_version_id
         join users u on u.id = p.user_id
        where f.id = $1`,
      [flagId],
    );
    if (!flag.rows[0]) throw new HttpError(404, "Not found");

    const commits = await pool.query(
      `select sha, message, author_login, pushed_at
         from project_commits where project_id = $1
        order by pushed_at desc limit 50`,
      [flag.rows[0].project_id],
    );

    const explanations = await pool.query(
      `select m.title, m.explanation_question, a.explanation_answer
         from milestone_attempts a
         join milestones m on m.id = a.milestone_id
        where a.project_id = $1 and m.explanation_question is not null
        order by m.sort_order`,
      [flag.rows[0].project_id],
    );

    res.json({
      flag: {
        id: flag.rows[0].id,
        type: flag.rows[0].type,
        status: flag.rows[0].status,
        details: flag.rows[0].details,
      },
      project: {
        briefTitle: flag.rows[0].brief_title,
        repoFullName: flag.rows[0].repo_full_name,
        learnerName: flag.rows[0].learner_name,
      },
      commits: commits.rows.map((c) => ({
        sha: c.sha,
        message: c.message,
        authorLogin: c.author_login,
        pushedAt: c.pushed_at,
      })),
      explanations: explanations.rows.map((e) => ({
        title: e.title,
        question: e.explanation_question,
        answer: e.explanation_answer,
      })),
    });
  });

  /** Rule on a flag. The ruling and its log entry are one transaction (§6.1 step 5). */
  router.patch("/admin/integrity/:id", requireAuth, requireAdmin, async (req, res) => {
    const admin = sessionUser(req);
    const flagId = id(req.params.id);

    const parsed = RulingBody.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, parsed.error.issues[0]?.message ?? "Choose an outcome.");
    }

    const client = await pool.connect();
    try {
      await client.query("begin");

      const updated = await client.query<{ id: string; project_id: string; type: string }>(
        `update integrity_flags
            set status = $2, decision_reason = $3, decided_by = $4, decided_at = now()
          where id = $1
          returning id, project_id, type`,
        [flagId, parsed.data.status, parsed.data.reason, admin.id],
      );
      if (!updated.rows[0]) {
        await client.query("rollback");
        throw new HttpError(404, "Not found");
      }

      await logAdminAction(client, {
        adminId: admin.id,
        action: `integrity.${parsed.data.status}`,
        targetType: "integrity_flag",
        targetId: flagId,
        reason: parsed.data.reason,
        details: { projectId: updated.rows[0].project_id, type: updated.rows[0].type },
      });

      /**
       * **Rejecting the project withdraws its certificate** (§6.6: "Rejecting a
       * project revokes its Project Certificate and notifies the learner with
       * the reason").
       *
       * Only `rejected`. Clearing a flag, asking for an explanation and asking
       * for a redo all leave the certificate alone — the project still stands
       * while the question is open, and withdrawing on suspicion would punish
       * the many learners who simply work in an unusual order.
       *
       * An earlier version of this endpoint deliberately kept the two apart, on
       * the grounds that "we looked and it was fine" and "we withdrew this"
       * should not be one click. That reasoning holds for the other three
       * outcomes and fails for this one: a rejected project with a valid
       * certificate is a state the platform should never be able to reach.
       *
       * Same transaction as the ruling, so the certificate cannot be left
       * standing by a failure between the two — and the revocation gets its own
       * log entry, because it is a second thing that happened to the learner.
       */
      if (parsed.data.status === "rejected") {
        const revoked = await client.query<{ id: string; user_id: string }>(
          `update certificates
              set status = 'revoked', revoked_at = now(), revoked_reason = $2
            where project_id = $1 and type = 'project' and status = 'valid'
            returning id, user_id`,
          [updated.rows[0].project_id, parsed.data.reason],
        );

        for (const certificate of revoked.rows) {
          await logAdminAction(client, {
            adminId: admin.id,
            action: "certificate.revoked",
            targetType: "certificate",
            targetId: certificate.id,
            reason: parsed.data.reason,
            details: { learnerId: certificate.user_id, viaIntegrityFlag: flagId },
          });
        }
      }

      await client.query("commit");
    } catch (err) {
      await client.query("rollback").catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    res.json({ status: parsed.data.status });
  });

  return router;
}
