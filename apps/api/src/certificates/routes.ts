import { Router } from "express";
import type { Pool } from "pg";
import { requireAuth, sessionUser } from "../middleware/session.js";
import { syncCertificates } from "./issue.js";

/**
 * Certificates (design.md §5.15).
 *
 * **There is no endpoint that issues one.** AGENT.md §6 rule 1: certificates are
 * issued after the backend checks the requirements itself. `GET /certificates`
 * *may* issue one as a side effect, because reading is when the check runs — but
 * nothing a browser sends influences whether it does. There is no body, no
 * roadmap id, and no way to ask.
 *
 * `GET /verify/:code` is the **only public endpoint in this file, and one of very
 * few in the API**. It has no session, so §6.1's steps do not apply — which makes
 * it the one place where "filter by the session user" cannot be the safety net,
 * and every field it returns has to be chosen deliberately instead.
 */

/** §5.15's format. Matched loosely enough to accept what a learner might type. */
const CODE = /^FC-[0-9A-Z]{4}-[0-9A-Z]{4}$/;

export function certificateRoutes(pool: Pool): Router {
  const router = Router();

  /**
   * §5.15's screen: what has been earned, and what the locked ones still need.
   */
  router.get("/certificates", requireAuth, async (req, res) => {
    const user = sessionUser(req);

    // Issues anything newly earned. Idempotent; see `syncCertificates`.
    const { progress } = await syncCertificates(pool, user.id);

    const { rows } = await pool.query<{
      public_code: string;
      type: string;
      title: string;
      recipient_name: string;
      details: { skills?: string[] } | null;
      status: string;
      issued_at: Date;
      revoked_at: Date | null;
      roadmap_id: string;
    }>(
      `select public_code, type, title, recipient_name, details, status,
              issued_at, revoked_at, roadmap_id
         from certificates
        where user_id = $1
        order by issued_at desc`,
      [user.id],
    );

    res.json({
      certificates: rows.map((c) => ({
        publicCode: c.public_code,
        type: c.type,
        title: c.title,
        recipientName: c.recipient_name,
        skills: c.details?.skills ?? [],
        status: c.status,
        issuedAt: c.issued_at,
        revokedAt: c.revoked_at,
        roadmapId: c.roadmap_id,
        /**
         * §5.15 offers "Copy verification link". Built here rather than in the
         * browser so one place decides what a verification URL looks like.
         */
        verifyPath: `/verify/${c.public_code}`,
      })),
      /**
       * §5.15's locked card and empty state. `blockedBy` is why a roadmap cannot
       * be finished as it stands, so the screen can say something true instead of
       * "0 of 0".
       */
      progress,
      /**
       * §5.15 shows the Project Certificate locked with a reason until it is
       * earned.
       *
       * The reason is now a real one. It used to be the literal string
       * "capstone-not-built", which was true while the capstone was unbuilt and
       * became a lie the moment it was — the kind of placeholder that survives
       * because nothing fails when it stops being accurate.
       */
      projectCertificate: await projectCertificateState(pool, user.id),
    });
  });

  /**
   * §5.15's public verification page. **No session, by design.**
   *
   * Three states, and all three are 200: valid, revoked, and not found. A 404
   * would be the obvious choice for an unknown code and it is the wrong one here
   * — §5.15 specifies a page that says "No certificate found with ID …", which is
   * an answer, not an error. Answering the same way for every code also means the
   * endpoint cannot be used to tell a real code from a fake one by status alone.
   *
   * **What it does not return** is the point of the whole endpoint. §5.15: "The
   * page shows only the learner's name and certificate details, never contact
   * information." So no email, no user id, no roadmap id, and — for a revoked
   * certificate — the date but **never the reason**, which is between the learner
   * and the platform.
   */
  router.get("/verify/:code", async (req, res) => {
    const raw = typeof req.params.code === "string" ? req.params.code.trim().toUpperCase() : "";

    if (!CODE.test(raw)) {
      res.json({ result: { status: "not-found", code: raw.slice(0, 32) } });
      return;
    }

    const { rows } = await pool.query<{
      public_code: string;
      type: string;
      title: string;
      recipient_name: string;
      details: { skills?: string[]; project_title?: string; repo_full_name?: string } | null;
      status: string;
      issued_at: Date;
      revoked_at: Date | null;
    }>(
      `select public_code, type, title, recipient_name, details, status, issued_at, revoked_at
         from certificates
        where public_code = $1`,
      [raw],
    );

    const cert = rows[0];
    if (!cert) {
      res.json({ result: { status: "not-found", code: raw } });
      return;
    }

    if (cert.status === "revoked") {
      res.json({
        result: {
          status: "revoked",
          code: cert.public_code,
          // The date, never `revoked_reason`.
          revokedAt: cert.revoked_at,
        },
      });
      return;
    }

    res.json({
      result: {
        status: "valid",
        code: cert.public_code,
        type: cert.type,
        recipientName: cert.recipient_name,
        title: cert.title,
        issuedAt: cert.issued_at,
        skills: cert.details?.skills ?? [],
        // Present only on a Project Certificate, which Phase 4 will issue.
        projectTitle: cert.details?.project_title ?? null,
        repository: cert.details?.repo_full_name ?? null,
      },
    });
  });

  /** A malformed or absent code is the same answer as an unknown one. */
  router.get("/verify", (_req, res) => {
    res.json({ result: { status: "not-found", code: "" } });
  });

  return router;
}

/**
 * Why §5.15's Project Certificate card is locked, or that it is not.
 *
 * Four answers, each a different thing to tell somebody: no project started, one
 * in progress with a milestone count, one finished, or — the state that only
 * exists because the capstone gates on it — no roadmap finished yet, so there is
 * nothing to build a project on.
 */
async function projectCertificateState(
  pool: Pool,
  userId: string,
): Promise<
  | { available: true }
  | { available: false; reason: "no-project" | "in-progress"; complete?: number; total?: number }
> {
  const project = await pool.query<{ id: string; completed_at: Date | null }>(
    `select p.id, p.completed_at
       from capstone_projects p
      where p.user_id = $1
      order by p.started_at desc
      limit 1`,
    [userId],
  );

  if (!project.rows[0]) return { available: false, reason: "no-project" };
  if (project.rows[0].completed_at) return { available: true };

  /**
   * A milestone count the screen can say out loud — "2 of 5 complete" — rather
   * than a bare "locked". Counted from attempts, which is where the truth is.
   */
  const counts = await pool.query<{ total: string; complete: string }>(
    `select
       (select count(*) from milestones m
          join capstone_projects p on p.brief_version_id = m.brief_version_id
         where p.id = $1) as total,
       (select count(*) from milestone_attempts a
         where a.project_id = $1 and a.status = 'complete') as complete`,
    [project.rows[0].id],
  );

  return {
    available: false,
    reason: "in-progress",
    complete: Number(counts.rows[0]?.complete ?? 0),
    total: Number(counts.rows[0]?.total ?? 0),
  };
}
