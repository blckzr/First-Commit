import { Router } from "express";
import { z } from "zod";
import type { Pool } from "pg";
import { HttpError } from "../middleware/errors.js";
import { requireAdmin, requireAuth, sessionUser } from "../middleware/session.js";
import { logAdminAction } from "./log.js";

/**
 * Certificate administration (`design.md` §6.7, §5.15).
 *
 * Revoking was SQL by hand until now, which meant the one action that takes
 * something away from a learner was the only one with no audit trail.
 *
 * ### Revoking is the only thing here
 *
 * There is **no endpoint that issues one** — §6 rule 1, and `syncCertificates()`
 * decides from evidence. An admin cannot grant a certificate, only withdraw one
 * that the platform granted, and only with a reason.
 *
 * ### A reason is required twice over
 *
 * Zod asks for one, and the schema's
 * `check ((status = 'revoked') = (revoked_reason is not null))` insists. §6 rule
 * 10 is the principle: an admin's correction is a logged override with a
 * required reason, never a silent change.
 *
 * ### Revoked, never deleted
 *
 * §6 rule 5: nothing a learner depends on is hard-deleted. A revoked certificate
 * keeps its `public_code`, so the verification page can say "this was
 * withdrawn" — which is the honest answer to somebody holding the link, and
 * better than a 404 that could mean anything. §5.15 shows the date and
 * deliberately not the reason: the reason is for the audit log and the learner,
 * not for whoever was handed the link.
 */

const RevokeBody = z
  .object({
    reason: z
      .string()
      .trim()
      .min(1, "Say why this certificate is being withdrawn.")
      .max(500),
  })
  .strict();

const UUID = /^[0-9a-f-]{36}$/i;

export function adminCertificateRoutes(pool: Pool): Router {
  const router = Router();

  /** Every certificate, newest first, for §6.7's lookup. */
  router.get("/admin/certificates", requireAuth, requireAdmin, async (req, res) => {
    const search = typeof req.query.q === "string" ? req.query.q.trim() : "";

    const { rows } = await pool.query(
      `select c.id, c.public_code, c.type, c.title, c.recipient_name, c.status,
              c.issued_at, c.revoked_at, c.revoked_reason,
              u.id as learner_id, u.email as learner_email
         from certificates c
         join users u on u.id = c.user_id
        where $1 = '' or c.public_code ilike '%' || $1 || '%'
           or u.email ilike '%' || $1 || '%'
           or c.recipient_name ilike '%' || $1 || '%'
        order by c.issued_at desc
        limit 100`,
      [search],
    );

    res.json({
      certificates: rows.map((row) => ({
        id: row.id,
        publicCode: row.public_code,
        type: row.type,
        title: row.title,
        recipientName: row.recipient_name,
        status: row.status,
        issuedAt: row.issued_at,
        revokedAt: row.revoked_at,
        revokedReason: row.revoked_reason,
        learner: { id: row.learner_id, email: row.learner_email },
      })),
    });
  });

  /** Withdraw one. The revocation and its log entry are one transaction (§6.1 step 5). */
  router.patch("/admin/certificates/:id/revoke", requireAuth, requireAdmin, async (req, res) => {
    const admin = sessionUser(req);
    const certificateId = req.params.id;
    if (typeof certificateId !== "string" || !UUID.test(certificateId)) {
      throw new HttpError(404, "Not found");
    }

    const parsed = RevokeBody.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, parsed.error.issues[0]?.message ?? "Say why.");
    }

    const client = await pool.connect();
    try {
      await client.query("begin");

      /**
       * `where status = 'valid'` makes this idempotent *and* honest: revoking an
       * already-revoked certificate is a 404 rather than a second log entry
       * claiming it happened twice.
       */
      const updated = await client.query<{ id: string; user_id: string; public_code: string }>(
        `update certificates
            set status = 'revoked', revoked_at = now(), revoked_reason = $2
          where id = $1 and status = 'valid'
          returning id, user_id, public_code`,
        [certificateId, parsed.data.reason],
      );
      if (!updated.rows[0]) {
        await client.query("rollback");
        throw new HttpError(404, "Not found");
      }

      await logAdminAction(client, {
        adminId: admin.id,
        action: "certificate.revoked",
        targetType: "certificate",
        targetId: certificateId,
        reason: parsed.data.reason,
        details: {
          learnerId: updated.rows[0].user_id,
          publicCode: updated.rows[0].public_code,
        },
      });

      await client.query("commit");
    } catch (err) {
      await client.query("rollback").catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    res.json({ status: "revoked" });
  });

  return router;
}
