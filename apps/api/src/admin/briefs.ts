import { Router } from "express";
import { z } from "zod";
import type { Pool, PoolClient } from "pg";
import { HttpError } from "../middleware/errors.js";
import { requireAdmin, requireAuth, sessionUser } from "../middleware/session.js";
import { logAdminAction } from "./log.js";

/**
 * The capstone brief editor (design.md §6.5).
 *
 * **Briefs follow the same versioning rules as modules** (§6.5's History tab),
 * so this is the module editor's shape again: a draft is copied from the
 * published version, only a draft is editable, publishing demotes the old one,
 * and progress is never repointed. `capstone_projects` references a
 * `brief_version_id`, so a learner part-way through finishes the version they
 * started for the same reason a module learner does — nothing moves them.
 *
 * **The one gate that is particular to a brief**: §6.5 says "the brief cannot
 * be published for an option without one [a starter template]". A learner who
 * picks Vue and finds no template cannot start their capstone at all, and
 * nothing else in the platform surfaces it — the admin overview counts it, this
 * refuses it.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const id = (value: unknown): string => {
  if (typeof value !== "string" || !UUID.test(value)) throw new HttpError(404, "Not found");
  return value;
};

const Check = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("file_exists"),
    name: z.string().min(1),
    /** A glob, so `src/components/TaskForm.*` matches `.jsx` and `.vue`. */
    path: z.string().min(1, "A file check needs a path."),
  }),
  z.object({
    type: z.literal("workflow_test"),
    name: z.string().min(1),
    workflow: z.string().min(1, "A workflow check needs a workflow file."),
    testName: z.string().min(1, "A workflow check needs a test name."),
  }),
  z.object({ type: z.literal("deployment_url"), name: z.string().min(1) }),
]);

const Milestone = z.object({
  title: z.string().min(1, "Every milestone needs a title."),
  acceptanceCriteria: z.array(z.string().min(1)).default([]),
  reviewChecklist: z.array(z.string().min(1)).default([]),
  explanationQuestion: z.string().nullable().default(null),
  checks: z.array(Check).default([]),
});

const BriefEdit = z
  .object({
    title: z.string().min(1, "Give the brief a title.").optional(),
    description: z.string().optional(),
    goals: z.string().optional(),
    estimatedWeeks: z.number().int().min(1).max(52).optional(),
  })
  .strict();

export function adminBriefRoutes(pool: Pool): Router {
  const router = Router();

  /** §6.5's entry: the briefs, and where each one's content stands. */
  router.get("/admin/briefs", requireAuth, requireAdmin, async (_req, res) => {
    const { rows } = await pool.query(
      `select b.id, b.slug, b.status, t.title as track_title,
              pub.id as published_id, pub.version_no as published_no, pub.title as published_title,
              draft.id as draft_id, draft.version_no as draft_no, draft.title as draft_title
         from capstone_briefs b
         join tracks t on t.id = b.track_id
         left join capstone_brief_versions pub on pub.brief_id = b.id and pub.status = 'published'
         left join capstone_brief_versions draft on draft.brief_id = b.id and draft.status = 'draft'
        order by b.slug`,
    );

    res.json({
      briefs: rows.map((row) => ({
        id: row.id,
        slug: row.slug,
        status: row.status,
        trackTitle: row.track_title,
        published: row.published_id
          ? { id: row.published_id, versionNo: row.published_no, title: row.published_title }
          : null,
        draft: row.draft_id
          ? { id: row.draft_id, versionNo: row.draft_no, title: row.draft_title }
          : null,
      })),
    });
  });

  /** One brief: every version, its milestones, checks and templates. */
  router.get("/admin/briefs/:id", requireAuth, requireAdmin, async (req, res) => {
    const briefId = id(req.params.id);

    const brief = await pool.query<{ id: string; slug: string; status: string; track_id: string }>(
      `select id, slug, status, track_id from capstone_briefs where id = $1`,
      [briefId],
    );
    if (!brief.rows[0]) throw new HttpError(404, "Not found");

    const [versions, milestones, checks, templates, options] = await Promise.all([
      pool.query(
        `select id, version_no, title, description, goals, estimated_weeks, status, published_at
           from capstone_brief_versions where brief_id = $1 order by version_no desc`,
        [briefId],
      ),
      pool.query(
        `select m.id, m.brief_version_id, m.sort_order, m.title,
                m.acceptance_criteria, m.review_checklist, m.explanation_question
           from milestones m
           join capstone_brief_versions v on v.id = m.brief_version_id
          where v.brief_id = $1 order by m.sort_order`,
        [briefId],
      ),
      pool.query(
        `select c.id, c.milestone_id, c.type, c.name, c.config, c.sort_order
           from milestone_checks c
           join milestones m on m.id = c.milestone_id
           join capstone_brief_versions v on v.id = m.brief_version_id
          where v.brief_id = $1 order by c.sort_order`,
        [briefId],
      ),
      pool.query(
        `select st.brief_version_id, st.technology_id, st.repo_full_name, t.name as technology
           from starter_templates st
           join technologies t on t.id = st.technology_id
           join capstone_brief_versions v on v.id = st.brief_version_id
          where v.brief_id = $1`,
        [briefId],
      ),
      /** The options this brief's track offers — what a template is needed for. */
      pool.query(
        `select t.id, t.name
           from technology_decisions td
           join decision_options o on o.decision_id = td.id and o.status = 'published'
           join technologies t on t.id = o.technology_id
          where td.track_id = $1`,
        [brief.rows[0].track_id],
      ),
    ]);

    res.json({
      brief: brief.rows[0],
      technologies: options.rows.map((row) => ({ id: row.id, name: row.name })),
      versions: versions.rows.map((version) => ({
        id: version.id,
        versionNo: version.version_no,
        title: version.title,
        description: version.description,
        goals: version.goals,
        estimatedWeeks: version.estimated_weeks,
        status: version.status,
        publishedAt: version.published_at,
        milestones: milestones.rows
          .filter((m) => m.brief_version_id === version.id)
          .map((milestone) => ({
            id: milestone.id,
            sortOrder: milestone.sort_order,
            title: milestone.title,
            acceptanceCriteria: milestone.acceptance_criteria ?? [],
            reviewChecklist: milestone.review_checklist ?? [],
            explanationQuestion: milestone.explanation_question,
            checks: checks.rows
              .filter((c) => c.milestone_id === milestone.id)
              .map((check) => ({
                type: check.type,
                name: check.name,
                ...(check.config as Record<string, unknown>),
              })),
          })),
        templates: templates.rows
          .filter((t) => t.brief_version_id === version.id)
          .map((template) => ({
            technologyId: template.technology_id,
            technology: template.technology,
            repoFullName: template.repo_full_name,
          })),
        /** §6.5's publish gate, as a fact the screen can show. */
        missingTemplates: options.rows
          .filter(
            (option) =>
              !templates.rows.some(
                (t) => t.brief_version_id === version.id && t.technology_id === option.id,
              ),
          )
          .map((option) => option.name),
      })),
    });
  });

  /** Start a draft, copied from the published version (§6.5's History tab). */
  router.post("/admin/briefs/:id/versions", requireAuth, requireAdmin, async (req, res) => {
    const briefId = id(req.params.id);

    const client = await pool.connect();
    try {
      await client.query("begin");

      const exists = await client.query(`select id from capstone_briefs where id = $1`, [briefId]);
      if (!exists.rows[0]) {
        await client.query("rollback");
        throw new HttpError(404, "Not found");
      }

      const open = await client.query<{ id: string; version_no: number }>(
        `select id, version_no from capstone_brief_versions
          where brief_id = $1 and status = 'draft'`,
        [briefId],
      );
      if (open.rows[0]) {
        // One draft at a time, as with modules: a second tab lands on the same one.
        await client.query("commit");
        res.json({ versionId: open.rows[0].id, versionNo: open.rows[0].version_no, reused: true });
        return;
      }

      const versionId = await copyBriefVersion(client, briefId);

      await client.query("commit");
      res.status(201).json({ versionId, reused: false });
    } catch (err) {
      await client.query("rollback").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  });

  /** Edit a draft's own fields. */
  router.patch(
    "/admin/briefs/:id/versions/:versionId",
    requireAuth,
    requireAdmin,
    async (req, res) => {
      const briefId = id(req.params.id);
      const versionId = id(req.params.versionId);

      const parsed = BriefEdit.safeParse(req.body);
      if (!parsed.success) {
        throw new HttpError(400, parsed.error.issues[0]?.message ?? "Check the fields.");
      }

      const { rowCount } = await pool.query(
        `update capstone_brief_versions
            set title = coalesce($3, title),
                description = coalesce($4, description),
                goals = coalesce($5, goals),
                estimated_weeks = coalesce($6, estimated_weeks)
          where id = $1 and brief_id = $2 and status = 'draft'`,
        [
          versionId,
          briefId,
          parsed.data.title ?? null,
          parsed.data.description ?? null,
          parsed.data.goals ?? null,
          parsed.data.estimatedWeeks ?? null,
        ],
      );
      if (rowCount === 0) throw new HttpError(404, "Not found");

      res.json({ ok: true });
    },
  );

  /**
   * Replace a draft's milestones, with their checks.
   *
   * The whole list, for the reason lessons and questions are: `milestones` is
   * keyed by `(brief_version_id, sort_order)`, so reordering one at a time
   * collides with itself. Safe to delete and reinsert only because this is a
   * draft — `milestone_attempts` references a milestone, and no attempt can
   * exist against an unpublished version.
   */
  router.put(
    "/admin/briefs/:id/versions/:versionId/milestones",
    requireAuth,
    requireAdmin,
    async (req, res) => {
      const briefId = id(req.params.id);
      const versionId = id(req.params.versionId);

      const parsed = z
        .object({ milestones: z.array(Milestone).max(20) })
        .safeParse(req.body);
      if (!parsed.success) {
        throw new HttpError(400, parsed.error.issues[0]?.message ?? "Check the milestones.");
      }

      const client = await pool.connect();
      try {
        await client.query("begin");

        const version = await client.query<{ id: string }>(
          `select id from capstone_brief_versions
            where id = $1 and brief_id = $2 and status = 'draft' for update`,
          [versionId, briefId],
        );
        if (!version.rows[0]) {
          await client.query("rollback");
          throw new HttpError(404, "Not found");
        }

        await client.query(`delete from milestones where brief_version_id = $1`, [versionId]);

        for (const [index, milestone] of parsed.data.milestones.entries()) {
          const created = await client.query<{ id: string }>(
            `insert into milestones
               (brief_version_id, sort_order, title, acceptance_criteria,
                review_checklist, explanation_question)
             values ($1, $2, $3, $4, $5, $6)
             returning id`,
            [
              versionId,
              index,
              milestone.title,
              JSON.stringify(milestone.acceptanceCriteria),
              JSON.stringify(milestone.reviewChecklist),
              milestone.explanationQuestion,
            ],
          );

          for (const [checkIndex, check] of milestone.checks.entries()) {
            const { type, name, ...config } = check;
            await client.query(
              `insert into milestone_checks (milestone_id, type, name, config, sort_order)
               values ($1, $2, $3, $4, $5)`,
              [created.rows[0].id, type, name, JSON.stringify(config), checkIndex],
            );
          }
        }

        await client.query("commit");
        res.json({ milestones: parsed.data.milestones.length });
      } catch (err) {
        await client.query("rollback").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
  );

  /** §6.5's Templates tab: one starter repository per technology option. */
  router.put(
    "/admin/briefs/:id/versions/:versionId/templates",
    requireAuth,
    requireAdmin,
    async (req, res) => {
      const briefId = id(req.params.id);
      const versionId = id(req.params.versionId);

      const parsed = z
        .object({
          templates: z.array(
            z.object({
              technologyId: z.string().uuid(),
              repoFullName: z
                .string()
                .regex(/^[\w.-]+\/[\w.-]+$/, "A repository looks like owner/name."),
            }),
          ),
        })
        .safeParse(req.body);
      if (!parsed.success) {
        throw new HttpError(400, parsed.error.issues[0]?.message ?? "Check the templates.");
      }

      const client = await pool.connect();
      try {
        await client.query("begin");

        const version = await client.query<{ id: string }>(
          `select id from capstone_brief_versions
            where id = $1 and brief_id = $2 and status = 'draft' for update`,
          [versionId, briefId],
        );
        if (!version.rows[0]) {
          await client.query("rollback");
          throw new HttpError(404, "Not found");
        }

        await client.query(`delete from starter_templates where brief_version_id = $1`, [
          versionId,
        ]);
        for (const template of parsed.data.templates) {
          await client.query(
            `insert into starter_templates (brief_version_id, technology_id, repo_full_name)
             values ($1, $2, $3)`,
            [versionId, template.technologyId, template.repoFullName],
          );
        }

        await client.query("commit");
        res.json({ templates: parsed.data.templates.length });
      } catch (err) {
        await client.query("rollback").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
  );

  /**
   * Publish a draft brief.
   *
   * Same shape as a module version, and §6 rule 6 for the same reason:
   * `capstone_projects` references a `brief_version_id`, so a learner part-way
   * through finishes the version they started because nothing moves them.
   * Nothing in this file writes to `capstone_projects` or `milestone_attempts`.
   */
  router.post(
    "/admin/briefs/:id/versions/:versionId/publish",
    requireAuth,
    requireAdmin,
    async (req, res) => {
      const admin = sessionUser(req);
      const briefId = id(req.params.id);
      const versionId = id(req.params.versionId);

      const client = await pool.connect();
      try {
        await client.query("begin");

        const draft = await client.query<{ version_no: number; title: string }>(
          `select version_no, title from capstone_brief_versions
            where id = $1 and brief_id = $2 and status = 'draft' for update`,
          [versionId, briefId],
        );
        if (!draft.rows[0]) {
          await client.query("rollback");
          throw new HttpError(404, "Not found");
        }

        await requireReadyToBuild(client, briefId, versionId);

        const demoted = await client.query<{ version_no: number }>(
          `update capstone_brief_versions set status = 'superseded'
            where brief_id = $1 and status = 'published'
            returning version_no`,
          [briefId],
        );

        await client.query(
          `update capstone_brief_versions
              set status = 'published', published_at = now()
            where id = $1`,
          [versionId],
        );

        await logAdminAction(client, {
          adminId: admin.id,
          action: "brief_version.published",
          targetType: "capstone_brief_version",
          targetId: versionId,
          details: {
            briefId,
            versionNo: draft.rows[0].version_no,
            supersededVersionNo: demoted.rows[0]?.version_no ?? null,
          },
        });

        await client.query("commit");
        res.json({
          versionNo: draft.rows[0].version_no,
          title: draft.rows[0].title,
          supersededVersionNo: demoted.rows[0]?.version_no ?? null,
        });
      } catch (err) {
        await client.query("rollback").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
  );

  return router;
}

/** Copies the published version's milestones, checks and templates into a new draft. */
async function copyBriefVersion(client: PoolClient, briefId: string): Promise<string> {
  const source = await client.query<{
    id: string;
    title: string;
    description: string;
    goals: string;
    estimated_weeks: number;
  }>(
    `select id, title, description, goals, estimated_weeks
       from capstone_brief_versions where brief_id = $1 and status = 'published'`,
    [briefId],
  );

  const next = await client.query<{ next: number }>(
    `select coalesce(max(version_no), 0) + 1 as next
       from capstone_brief_versions where brief_id = $1`,
    [briefId],
  );

  const created = await client.query<{ id: string }>(
    `insert into capstone_brief_versions
       (brief_id, version_no, title, description, goals, estimated_weeks, status)
     values ($1, $2, $3, $4, $5, $6, 'draft')
     returning id`,
    [
      briefId,
      next.rows[0].next,
      source.rows[0]?.title ?? "Untitled",
      source.rows[0]?.description ?? "",
      source.rows[0]?.goals ?? "",
      source.rows[0]?.estimated_weeks ?? 3,
    ],
  );
  const versionId = created.rows[0].id;
  if (!source.rows[0]) return versionId;

  const milestones = await client.query<{
    id: string;
    sort_order: number;
    title: string;
    acceptance_criteria: unknown;
    review_checklist: unknown;
    explanation_question: string | null;
  }>(
    `select id, sort_order, title, acceptance_criteria, review_checklist, explanation_question
       from milestones where brief_version_id = $1 order by sort_order`,
    [source.rows[0].id],
  );

  for (const milestone of milestones.rows) {
    const copy = await client.query<{ id: string }>(
      `insert into milestones
         (brief_version_id, sort_order, title, acceptance_criteria, review_checklist, explanation_question)
       values ($1, $2, $3, $4, $5, $6) returning id`,
      [
        versionId,
        milestone.sort_order,
        milestone.title,
        JSON.stringify(milestone.acceptance_criteria ?? []),
        JSON.stringify(milestone.review_checklist ?? []),
        milestone.explanation_question,
      ],
    );

    await client.query(
      `insert into milestone_checks (milestone_id, type, name, config, sort_order)
       select $1, type, name, config, sort_order from milestone_checks where milestone_id = $2`,
      [copy.rows[0].id, milestone.id],
    );
  }

  await client.query(
    `insert into starter_templates (brief_version_id, technology_id, repo_full_name)
     select $1, technology_id, repo_full_name from starter_templates where brief_version_id = $2`,
    [versionId, source.rows[0].id],
  );

  return versionId;
}

/**
 * What must be true before a learner can be sent to build this.
 *
 * §6.5: "the brief cannot be published for an option without one [a starter
 * template]". A learner who picks Vue and finds no template **cannot start at
 * all**, and nothing else in the platform stops them getting there — the admin
 * overview counts the gap, this refuses to create it.
 */
async function requireReadyToBuild(
  client: PoolClient,
  briefId: string,
  versionId: string,
): Promise<void> {
  const milestones = await client.query<{ count: string }>(
    `select count(*) as count from milestones where brief_version_id = $1`,
    [versionId],
  );
  if (Number(milestones.rows[0].count) === 0) {
    throw new HttpError(400, "Add at least one milestone before publishing this brief.");
  }

  const missing = await client.query<{ name: string }>(
    `select t.name
       from capstone_briefs b
       join technology_decisions td on td.track_id = b.track_id
       join decision_options o on o.decision_id = td.id and o.status = 'published'
       join technologies t on t.id = o.technology_id
       left join starter_templates st
              on st.brief_version_id = $2 and st.technology_id = t.id
      where b.id = $1 and st.brief_version_id is null`,
    [briefId, versionId],
  );

  if (missing.rows[0]) {
    const names = missing.rows.map((row) => row.name).join(", ");
    throw new HttpError(
      400,
      `No starter template for ${names}. A learner who picks it could not start the project.`,
    );
  }
}
