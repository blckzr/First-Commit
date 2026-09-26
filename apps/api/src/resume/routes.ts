import { Router } from "express";
import { z } from "zod";
import type { Pool } from "pg";
import { HttpError } from "../middleware/errors.js";
import { requireAuth, sessionUser } from "../middleware/session.js";
import { readEvidence } from "./evidence.js";

/**
 * The resume (design.md §5.16).
 *
 * **The evidence panel is the security boundary.** §5.16: learners "choose which
 * to include but cannot add unverified skills". So no endpoint here accepts a
 * skill, a certificate, or a project — only *which of the verified ones* to
 * show, by id, checked against what `readEvidence` says is true.
 *
 * What a learner may write freely is their own contact details and education,
 * which are facts about them rather than claims the platform is vouching for.
 * Those are `resume_details`, and they are the only free text that reaches a
 * resume besides the model's summary.
 */

const Link = z.object({
  label: z.string().trim().min(1).max(60),
  url: z.string().trim().url("Enter a full web address, starting with https://").max(300),
});

const Education = z.object({
  school: z.string().trim().min(1).max(160),
  degree: z.string().trim().max(160).default(""),
  start: z.string().trim().max(20).default(""),
  end: z.string().trim().max(20).default(""),
});

/**
 * §5.16's "Edit details". Strict, and deliberately small: a resume the platform
 * puts its name on says what the platform can stand behind, plus how to contact
 * the person. There is no free-text "experience" field, and that absence is the
 * feature (§7: module completion is a skill, never experience).
 */
const DetailsBody = z
  .object({
    email: z.string().trim().email("Enter a valid email address.").max(200).or(z.literal("")),
    phone: z.string().trim().max(40),
    city: z.string().trim().max(120),
    links: z.array(Link).max(6, "Six links is plenty on a resume."),
    education: z.array(Education).max(4),
  })
  .strict();

/** Which verified items to show. Ids only — never the items themselves. */
const SelectionBody = z
  .object({
    careerPathId: z.string().nullable().optional(),
    skillIds: z.array(z.string()).max(50).optional(),
    certificateCodes: z.array(z.string()).max(20).optional(),
    projectIds: z.array(z.string()).max(10).optional(),
  })
  .strict();

/** §5.16: AI text is editable. Only the fields the model wrote. */
const ContentBody = z
  .object({
    summary: z.string().max(2000).optional(),
    projects: z
      .array(z.object({ projectId: z.string(), description: z.string().max(1000) }))
      .max(10)
      .optional(),
  })
  .strict();

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface StoredContent {
  summary?: string;
  skills?: string[];
  projects?: { projectId: string; description: string }[];
}

export function resumeRoutes(pool: Pool): Router {
  const router = Router();

  /**
   * One resume row per learner, made on first read.
   *
   * Created here rather than at sign-up: a row nobody asked for is a row that
   * has to be migrated and explained later, and reading the screen is the
   * earliest moment the platform knows it is wanted.
   */
  async function resumeFor(userId: string) {
    const existing = await pool.query<{
      id: string;
      career_path_id: string | null;
      selected_evidence: Record<string, string[]> | null;
      content: StoredContent | null;
      ai_fields: string[];
      generated_at: Date | null;
    }>(
      `select id, career_path_id, selected_evidence, content, ai_fields, generated_at
         from resumes where user_id = $1 order by updated_at desc limit 1`,
      [userId],
    );
    if (existing.rows[0]) return existing.rows[0];

    const created = await pool.query<{ id: string }>(
      `insert into resumes (user_id) values ($1) returning id`,
      [userId],
    );
    return {
      id: created.rows[0].id,
      career_path_id: null,
      selected_evidence: null,
      content: null,
      ai_fields: [] as string[],
      generated_at: null,
    };
  }

  router.get("/resume", requireAuth, async (req, res) => {
    const user = sessionUser(req);
    const [resume, evidence, details, name] = await Promise.all([
      resumeFor(user.id),
      readEvidence(pool, user.id),
      pool.query<{
        email: string | null;
        phone: string | null;
        city: string | null;
        links: unknown;
        education: unknown;
      }>(
        `select email, phone, city, links, education from resume_details where user_id = $1`,
        [user.id],
      ),
      pool.query<{ full_name: string }>(`select full_name from users where id = $1`, [user.id]),
    ]);

    const job = await pool.query<{ status: string }>(
      `select status from ai_jobs
        where user_id = $1 and type = 'resume_generation' and source_id = $2
        order by created_at desc limit 1`,
      [user.id, resume.id],
    );

    res.json({
      resume: {
        id: resume.id,
        careerPathId: resume.career_path_id,
        selected: resume.selected_evidence ?? {},
        content: resume.content ?? null,
        /** §5.16: AI-written text is labelled. This is which fields those are. */
        aiFields: resume.ai_fields ?? [],
        generatedAt: resume.generated_at,
        status: job.rows[0]?.status ?? "none",
      },
      /** Only verified items. Nothing here was typed by the learner. */
      evidence,
      details: {
        fullName: name.rows[0]?.full_name ?? "",
        email: details.rows[0]?.email ?? "",
        phone: details.rows[0]?.phone ?? "",
        city: details.rows[0]?.city ?? "",
        links: details.rows[0]?.links ?? [],
        education: details.rows[0]?.education ?? [],
      },
    });
  });

  router.put("/resume/details", requireAuth, async (req, res) => {
    const user = sessionUser(req);
    const parsed = DetailsBody.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0].message);

    await pool.query(
      `insert into resume_details (user_id, email, phone, city, links, education)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (user_id) do update
          set email = excluded.email, phone = excluded.phone, city = excluded.city,
              links = excluded.links, education = excluded.education, updated_at = now()`,
      [
        user.id,
        parsed.data.email || null,
        parsed.data.phone || null,
        parsed.data.city || null,
        JSON.stringify(parsed.data.links),
        JSON.stringify(parsed.data.education),
      ],
    );

    res.json({ details: parsed.data });
  });

  /**
   * Which verified items to include.
   *
   * **Every id is checked against the evidence** before it is stored. A skill id
   * the learner has not earned is dropped rather than refused: the panel cannot
   * offer one, so an unknown id means a stale page rather than an attack, and a
   * 400 would strand somebody whose evidence changed in another tab.
   */
  router.put("/resume/selection", requireAuth, async (req, res) => {
    const user = sessionUser(req);
    const parsed = SelectionBody.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0].message);

    const resume = await resumeFor(user.id);
    const evidence = await readEvidence(pool, user.id);

    const skillIds = new Set(evidence.skills.map((s) => s.skillId));
    const codes = new Set(evidence.certificates.map((c) => c.publicCode));
    const projectIds = new Set(evidence.projects.map((p) => p.id));

    const selected = {
      skillIds: (parsed.data.skillIds ?? []).filter((id) => skillIds.has(id)),
      certificateCodes: (parsed.data.certificateCodes ?? []).filter((c) => codes.has(c)),
      projectIds: (parsed.data.projectIds ?? []).filter((id) => projectIds.has(id)),
    };

    const careerPathId =
      parsed.data.careerPathId && uuid.test(parsed.data.careerPathId)
        ? parsed.data.careerPathId
        : null;

    await pool.query(
      `update resumes set selected_evidence = $1, career_path_id = $2, updated_at = now()
        where id = $3 and user_id = $4`,
      [JSON.stringify(selected), careerPathId, resume.id, user.id],
    );

    res.json({ selected, careerPathId });
  });

  /**
   * §5.16's "Generate resume". Queues the Resume AI.
   *
   * **The evidence goes in the payload**, read here from `module_completions`
   * and `certificates` — the same shape `code_feedback` uses, so the model is
   * handed results the platform computed rather than asked to work out what a
   * learner knows. The worker grounds its answer against this same list before
   * writing anything (§7).
   */
  router.post("/resume/generate", requireAuth, async (req, res) => {
    const user = sessionUser(req);
    const resume = await resumeFor(user.id);
    const evidence = await readEvidence(pool, user.id);

    if (evidence.skills.length === 0) {
      /* §5.16's empty state, as an error the screen can show verbatim. */
      throw new HttpError(
        400,
        "Pass your first module assessment to add a verified skill to your resume.",
      );
    }

    const running = await pool.query<{ id: string }>(
      `select id from ai_jobs
        where user_id = $1 and type = 'resume_generation' and source_id = $2
          and status in ('queued', 'running')`,
      [user.id, resume.id],
    );
    if (running.rows[0]) {
      // Asking twice does not make it faster.
      return res.json({ status: "queued" });
    }

    const selected = (resume.selected_evidence ?? {}) as Record<string, string[]>;
    const chosen = <T>(items: T[], ids: string[] | undefined, key: (item: T) => string) =>
      ids && ids.length > 0 ? items.filter((i) => ids.includes(key(i))) : items;

    const target = await pool.query<{ title: string }>(
      `select title from career_paths where id = $1`,
      [resume.career_path_id],
    );

    await pool.query(
      `insert into ai_jobs (type, user_id, source_id, payload)
       values ('resume_generation', $1, $2, $3)`,
      [
        user.id,
        resume.id,
        JSON.stringify({
          resumeId: resume.id,
          targetTitle: target.rows[0]?.title ?? "a junior developer role",
          skills: chosen(evidence.skills, selected.skillIds, (s) => s.skillId).map((s) => ({
            name: s.name,
            moduleCount: s.moduleCount,
            method: s.method,
          })),
          certificates: chosen(
            evidence.certificates,
            selected.certificateCodes,
            (c) => c.publicCode,
          ).map((c) => ({ title: c.title, issuedAt: c.issuedAt.toISOString() })),
          projects: chosen(evidence.projects, selected.projectIds, (p) => p.id).map((p) => ({
            id: p.id,
            title: p.title,
            technology: p.technology,
            repoFullName: p.repoFullName,
          })),
        }),
      ],
    );

    res.json({ status: "queued" });
  });

  /**
   * §5.16: "AI-written summary and project descriptions are labeled and
   * editable."
   *
   * Editing a field **removes it from `ai_fields`**, so the screen stops
   * labelling as AI something the learner wrote. Only the model's own fields can
   * be edited here — `skills` is not accepted, because that list is evidence and
   * the panel is the only way to change it.
   */
  router.patch("/resume", requireAuth, async (req, res) => {
    const user = sessionUser(req);
    const parsed = ContentBody.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0].message);

    const resume = await resumeFor(user.id);
    const content: StoredContent = { ...(resume.content ?? {}) };
    let aiFields = resume.ai_fields ?? [];

    if (parsed.data.summary !== undefined) {
      content.summary = parsed.data.summary;
      aiFields = aiFields.filter((f) => f !== "summary");
    }

    if (parsed.data.projects !== undefined) {
      const byId = new Map((content.projects ?? []).map((p) => [p.projectId, p]));
      for (const edit of parsed.data.projects) {
        // Only a project the model already described. A new id here would be a
        // project entry the evidence never supported.
        if (!byId.has(edit.projectId)) continue;
        byId.set(edit.projectId, edit);
        aiFields = aiFields.filter((f) => f !== `project:${edit.projectId}`);
      }
      content.projects = [...byId.values()];
    }

    await pool.query(
      `update resumes set content = $1, ai_fields = $2, updated_at = now()
        where id = $3 and user_id = $4`,
      [JSON.stringify(content), aiFields, resume.id, user.id],
    );

    res.json({ content, aiFields });
  });

  return router;
}
