import { Router } from "express";
import type { Pool } from "pg";
import { config } from "../config.js";
import { HttpError } from "../middleware/errors.js";
import { requireAuth, sessionUser } from "../middleware/session.js";
import { readEvidence } from "../resume/evidence.js";
import { renderCertificatePdf, renderResumePdf } from "./render.js";

/**
 * "Download PDF" for §5.15 and §5.16.
 *
 * **Generated on request, not stored.** `database-schema.md` §8 puts certificate
 * PDFs in a private Supabase bucket, and its own hosting note already allows for
 * the alternative: "Generate PDFs on demand if space runs low". On demand is the
 * better default here for reasons beyond space:
 *
 * - A resume changes whenever a learner passes a module, edits their summary, or
 *   deselects a skill. A stored file would be **stale evidence with an official
 *   look** — the one failure mode a resume cannot afford.
 * - A stored file needs a signed URL, an expiry, and a rule for invalidating it.
 *   Streaming needs a session, which the API already checks.
 * - Rendering measures in milliseconds; this is a page of text.
 *
 * The bucket stays in the schema doc for lesson media, and if generation ever
 * becomes slow enough to matter, caching into it is a change behind these two
 * routes rather than a change to them.
 *
 * **Both are owned reads.** §6.1 step 3: the resume is the session user's, and a
 * certificate is fetched by code *and* user id — a code someone else holds is a
 * 404 here, even though the same code is public at `/verify/:code`. The public
 * page shows a name and a title; the PDF is the artefact itself.
 */

/** `Content-Disposition` must not be able to carry a header injection. */
function safeFilename(value: string, fallback: string): string {
  const cleaned = value
    .normalize("NFKD")
    .replace(/[^\w\s.-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60);
  return cleaned || fallback;
}

function sendPdf(
  res: import("express").Response,
  filename: string,
  body: Buffer,
): void {
  res.setHeader("content-type", "application/pdf");
  res.setHeader("content-disposition", `attachment; filename="${filename}.pdf"`);
  res.setHeader("content-length", String(body.length));
  // A resume regenerates whenever the evidence changes; never let a proxy hold one.
  res.setHeader("cache-control", "private, no-store");
  res.end(body);
}

export function pdfRoutes(pool: Pool): Router {
  const router = Router();

  router.get("/resume.pdf", requireAuth, async (req, res) => {
    const user = sessionUser(req);

    const resume = await pool.query<{
      content: { summary?: string; skills?: string[]; projects?: { projectId: string; description: string }[] } | null;
      selected_evidence: Record<string, string[]> | null;
    }>(
      `select content, selected_evidence from resumes
        where user_id = $1 order by updated_at desc limit 1`,
      [user.id],
    );
    if (!resume.rows[0]) throw new HttpError(404, "Not found");

    const [details, name, evidence] = await Promise.all([
      pool.query<{
        email: string | null;
        phone: string | null;
        city: string | null;
        links: { label: string; url: string }[] | null;
        education: { school: string; degree: string; start: string; end: string }[] | null;
      }>(
        `select email, phone, city, links, education from resume_details where user_id = $1`,
        [user.id],
      ),
      pool.query<{ full_name: string }>(`select full_name from users where id = $1`, [user.id]),
      readEvidence(pool, user.id),
    ]);

    const selected = resume.rows[0].selected_evidence ?? {};
    const content = resume.rows[0].content ?? {};

    /**
     * **Built from the evidence, not from the stored content.** The skills and
     * certificates on the PDF are read fresh, so a file cannot assert something
     * the learner no longer has. Only the *prose* — the summary and the project
     * descriptions — comes from what was generated and edited.
     */
    const chosenSkills = evidence.skills.filter(
      (s) => !selected.skillIds?.length || selected.skillIds.includes(s.skillId),
    );
    const ordered = content.skills?.length
      ? [...chosenSkills].sort(
          (a, b) => content.skills!.indexOf(a.name) - content.skills!.indexOf(b.name),
        )
      : chosenSkills;

    const chosenCertificates = evidence.certificates.filter(
      (c) => !selected.certificateCodes?.length || selected.certificateCodes.includes(c.publicCode),
    );

    const described = new Map((content.projects ?? []).map((p) => [p.projectId, p.description]));
    const projects = evidence.projects
      .filter((p) => !selected.projectIds?.length || selected.projectIds.includes(p.id))
      .map((p) => ({
        title: p.title,
        description: described.get(p.id) ?? "",
        repo: p.repoFullName,
        demo: p.demoUrl,
      }));

    const body = await renderResumePdf({
      fullName: name.rows[0]?.full_name ?? "",
      contact: [
        details.rows[0]?.email ?? "",
        details.rows[0]?.phone ?? "",
        details.rows[0]?.city ?? "",
      ],
      links: details.rows[0]?.links ?? [],
      summary: content.summary ?? "",
      skills: ordered.map((s) => s.name),
      certificates: chosenCertificates.map((c) => ({
        title: c.title,
        year: new Date(c.issuedAt).getFullYear(),
      })),
      education: details.rows[0]?.education ?? [],
      projects,
    });

    sendPdf(res, safeFilename(`${name.rows[0]?.full_name ?? "resume"}-resume`, "resume"), body);
  });

  router.get("/certificates/:code.pdf", requireAuth, async (req, res) => {
    const user = sessionUser(req);
    const code = String(req.params.code ?? "").toUpperCase();

    /**
     * By code **and** user id. The same certificate is public at
     * `/verify/:code`, which shows a name and a title — the PDF is the artefact,
     * and handing that to anyone with the code would make forging an attachment
     * a matter of guessing one.
     */
    const { rows } = await pool.query<{
      public_code: string;
      type: "completion" | "project";
      title: string;
      recipient_name: string;
      details: { skills?: string[] } | null;
      issued_at: Date;
      status: string;
    }>(
      `select public_code, type, title, recipient_name, details, issued_at, status
         from certificates
        where public_code = $1 and user_id = $2`,
      [code, user.id],
    );

    const certificate = rows[0];
    if (!certificate) throw new HttpError(404, "Not found");
    if (certificate.status === "revoked") {
      // A revoked certificate is not a document to hand anybody.
      throw new HttpError(404, "Not found");
    }

    const body = await renderCertificatePdf({
      recipientName: certificate.recipient_name,
      title: certificate.title,
      type: certificate.type,
      publicCode: certificate.public_code,
      issuedAt: certificate.issued_at,
      skills: certificate.details?.skills ?? [],
      verifyUrl: `${config.appOrigin.replace(/\/$/, "")}/verify/${certificate.public_code}`,
    });

    sendPdf(res, safeFilename(`${certificate.public_code}-certificate`, "certificate"), body);
  });

  return router;
}
