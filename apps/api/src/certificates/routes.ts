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
       * The Project Certificate is Phase 4. Reported as locked rather than
       * omitted, because §5.15 shows it locked with a reason — and "not built
       * yet" is a more honest reason than a milestone count we cannot produce.
       */
      projectCertificate: { available: false, reason: "capstone-not-built" as const },
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
