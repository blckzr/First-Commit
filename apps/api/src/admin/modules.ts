import { Router } from "express";
import { z } from "zod";
import type { Pool, PoolClient } from "pg";
import { HttpError } from "../middleware/errors.js";
import { requireAdmin, requireAuth, sessionUser } from "../middleware/session.js";
import { logAdminAction } from "./log.js";

/**
 * The module editor (design.md §6.3) and its impact preview (§6.4).
 *
 * **This is where §6 rule 6 lives**, so it is worth stating plainly what the
 * rule is and what enforces it:
 *
 * > Content is versioned. Progress points at the exact `module_version_id`
 * > taken. In-progress learners finish their version; completed learners keep
 * > credit. Never repoint existing progress at a new version.
 *
 * Nothing here ever updates a `module_enrollments` or `module_completions` row.
 * Publishing a new version demotes the old one to `superseded` and promotes the
 * draft — the rows that point at the old version keep pointing at it, and
 * `on delete restrict` means it can never be removed underneath them. A learner
 * halfway through version 2 finishes version 2 because that is the row they
 * are joined to, not because anything checks a date.
 *
 * `module_versions_one_published` is a partial unique index, so the demote and
 * the promote **must** be one transaction: two published versions is a state
 * the database refuses, which is the right place for that invariant to live.
 *
 * **A draft is the only thing here that can be deleted.** §6 rule 5 says
 * nothing learners depend on is hard-deleted, and a draft is by definition
 * something no learner has seen: it is not `published`, so no enrollment can
 * reference it.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const id = (value: unknown): string => {
  if (typeof value !== "string" || !UUID.test(value)) throw new HttpError(404, "Not found");
  return value;
};

/** §13.3's `LessonBlock`. Validated here so nothing unrenderable is stored. */
const Block = z.discriminatedUnion("type", [
  z.object({ type: z.literal("paragraph"), text: z.string().min(1) }),
  z.object({ type: z.literal("heading"), text: z.string().min(1) }),
  z.object({
    type: z.literal("list"),
    ordered: z.boolean().optional(),
    items: z.array(z.string().min(1)).min(1),
  }),
  z.object({
    type: z.literal("code"),
    language: z.string().min(1),
    code: z.string(),
    caption: z.string().optional(),
  }),
  z.object({
    type: z.literal("callout"),
    tone: z.enum(["info", "notice"]),
    text: z.string().min(1),
  }),
]);

const Lessons = z.object({
  lessons: z
    .array(
      z.object({
        title: z.string().min(1, "Give the lesson a title."),
        blocks: z.array(Block),
      }),
    )
    .max(50),
});

const VersionEdit = z
  .object({
    title: z.string().min(1, "Give the version a title.").optional(),
    description: z.string().optional(),
    estimatedHours: z.number().positive().max(999).optional(),
    changeSummary: z.string().optional(),
  })
  .strict();

export function adminModuleRoutes(pool: Pool): Router {
  const router = Router();

  /** §6.3's entry point: every module, with where its content stands. */
  router.get("/admin/modules", requireAuth, requireAdmin, async (req, res) => {
    const search = typeof req.query.q === "string" ? req.query.q.trim() : "";

    const { rows } = await pool.query(
      `select m.id, m.slug, m.kind, m.status,
              s.name as skill_name,
              t.name as technology_name,
              pub.id as published_id, pub.version_no as published_no, pub.title as published_title,
              draft.id as draft_id, draft.version_no as draft_no, draft.title as draft_title
         from modules m
         join skills s on s.id = m.skill_id
         left join technologies t on t.id = m.technology_id
         left join module_versions pub on pub.module_id = m.id and pub.status = 'published'
         left join module_versions draft on draft.module_id = m.id and draft.status = 'draft'
        where $1 = '' or m.slug ilike '%' || $1 || '%'
           or coalesce(pub.title, draft.title, '') ilike '%' || $1 || '%'
        order by s.name, m.slug`,
      [search],
    );

    res.json({
      modules: rows.map((row) => ({
        id: row.id,
        slug: row.slug,
        kind: row.kind,
        status: row.status,
        skillName: row.skill_name,
        technologyName: row.technology_name,
        /** §6.3's header: "Version 3 (draft)  Published: version 2". */
        published: row.published_id
          ? { id: row.published_id, versionNo: row.published_no, title: row.published_title }
          : null,
        draft: row.draft_id
          ? { id: row.draft_id, versionNo: row.draft_no, title: row.draft_title }
          : null,
      })),
    });
  });

  /** One module: its versions (§6.3's History tab) and the lessons of each. */
  router.get("/admin/modules/:id", requireAuth, requireAdmin, async (req, res) => {
    const moduleId = id(req.params.id);

    const module = await pool.query(
      `select m.id, m.slug, m.kind, m.status, s.name as skill_name, t.name as technology_name
         from modules m
         join skills s on s.id = m.skill_id
         left join technologies t on t.id = m.technology_id
        where m.id = $1`,
      [moduleId],
    );
    if (!module.rows[0]) throw new HttpError(404, "Not found");

    const versions = await pool.query(
      `select id, version_no, title, description, estimated_hours, status,
              change_summary, published_at, created_at
         from module_versions
        where module_id = $1
        order by version_no desc`,
      [moduleId],
    );

    const lessons = await pool.query(
      `select l.id, l.module_version_id, l.sort_order, l.title, l.content
         from lessons l
         join module_versions v on v.id = l.module_version_id
        where v.module_id = $1
        order by l.module_version_id, l.sort_order`,
      [moduleId],
    );

    res.json({
      module: {
        id: module.rows[0].id,
        slug: module.rows[0].slug,
        kind: module.rows[0].kind,
        status: module.rows[0].status,
        skillName: module.rows[0].skill_name,
        technologyName: module.rows[0].technology_name,
      },
      versions: versions.rows.map((row) => ({
        id: row.id,
        versionNo: row.version_no,
        title: row.title,
        description: row.description,
        estimatedHours: Number(row.estimated_hours),
        status: row.status,
        changeSummary: row.change_summary,
        publishedAt: row.published_at,
        createdAt: row.created_at,
        lessons: lessons.rows
          .filter((lesson) => lesson.module_version_id === row.id)
          .map((lesson) => ({
            id: lesson.id,
            sortOrder: lesson.sort_order,
            title: lesson.title,
            blocks: (lesson.content as { blocks?: unknown[] })?.blocks ?? [],
          })),
      })),
    });
  });

  /**
   * Start a draft (§6.3: "Version 3 (draft)").
   *
   * **Copied from the published version, not from nothing.** An author editing
   * a module is almost always changing a few paragraphs, and starting from an
   * empty version means retyping a lesson to fix a sentence — which is how a
   * "small edit" becomes a rewrite that loses something.
   *
   * No log entry: a draft changes nothing a learner can see. Publishing it does,
   * and that is logged.
   */
  router.post("/admin/modules/:id/versions", requireAuth, requireAdmin, async (req, res) => {
    const moduleId = id(req.params.id);

    const client = await pool.connect();
    try {
      await client.query("begin");

      const exists = await client.query(`select id from modules where id = $1`, [moduleId]);
      if (!exists.rows[0]) {
        await client.query("rollback");
        throw new HttpError(404, "Not found");
      }

      const open = await client.query<{ id: string; version_no: number }>(
        `select id, version_no from module_versions
          where module_id = $1 and status = 'draft'`,
        [moduleId],
      );
      if (open.rows[0]) {
        /*
         * One draft at a time. Two would be two answers to "what is being
         * written", and §6.3's header shows one. The existing one is returned
         * rather than refused, so a second tab lands on the same draft instead
         * of an error.
         */
        await client.query("commit");
        res.json({ versionId: open.rows[0].id, versionNo: open.rows[0].version_no, reused: true });
        return;
      }

      const source = await client.query(
        `select id, version_no, title, description, estimated_hours
           from module_versions
          where module_id = $1 and status = 'published'`,
        [moduleId],
      );

      const next = await client.query<{ next: number }>(
        `select coalesce(max(version_no), 0) + 1 as next
           from module_versions where module_id = $1`,
        [moduleId],
      );
      const versionNo = next.rows[0].next;

      const created = await client.query<{ id: string }>(
        `insert into module_versions
           (module_id, version_no, title, description, estimated_hours, status)
         values ($1, $2, $3, $4, $5, 'draft')
         returning id`,
        [
          moduleId,
          versionNo,
          source.rows[0]?.title ?? "Untitled",
          source.rows[0]?.description ?? "",
          source.rows[0]?.estimated_hours ?? 1,
        ],
      );
      const versionId = created.rows[0].id;

      if (source.rows[0]) {
        await client.query(
          `insert into lessons (module_version_id, sort_order, title, content)
           select $1, sort_order, title, content from lessons where module_version_id = $2`,
          [versionId, source.rows[0].id],
        );
      }

      await client.query("commit");
      res.status(201).json({ versionId, versionNo, reused: false });
    } catch (err) {
      await client.query("rollback").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  });

  /** Edit a draft's own fields. Only a draft: a published version is history. */
  router.patch(
    "/admin/modules/:id/versions/:versionId",
    requireAuth,
    requireAdmin,
    async (req, res) => {
      const moduleId = id(req.params.id);
      const versionId = id(req.params.versionId);

      const parsed = VersionEdit.safeParse(req.body);
      if (!parsed.success) {
        throw new HttpError(400, parsed.error.issues[0]?.message ?? "Check the fields.");
      }

      const { rowCount } = await pool.query(
        `update module_versions
            set title = coalesce($3, title),
                description = coalesce($4, description),
                estimated_hours = coalesce($5, estimated_hours),
                change_summary = coalesce($6, change_summary),
                updated_at = now()
          where id = $1 and module_id = $2 and status = 'draft'`,
        [
          versionId,
          moduleId,
          parsed.data.title ?? null,
          parsed.data.description ?? null,
          parsed.data.estimatedHours ?? null,
          parsed.data.changeSummary ?? null,
        ],
      );

      /*
       * A 404 covers both "no such version" and "that version is published".
       * Editing a published version is not a thing an author may do — learners
       * are reading it — and the screen only ever offers it on a draft, so a
       * request to do it is a bug or a stale tab, not a question to answer.
       */
      if (rowCount === 0) throw new HttpError(404, "Not found");

      res.json({ ok: true });
    },
  );

  /**
   * Replace a draft's lessons.
   *
   * **The whole list at once, not one lesson at a time.** `lessons` has
   * `unique (module_version_id, sort_order)`, so reordering by individual
   * updates collides with itself halfway through; and an author reordering
   * three lessons means one edit, not three. The list that arrives is the list
   * that is stored.
   *
   * Deleting and reinserting is safe **only because this is a draft**: no
   * `module_enrollments.current_lesson_id` can point into it, since nobody can
   * be enrolled on an unpublished version.
   */
  router.put(
    "/admin/modules/:id/versions/:versionId/lessons",
    requireAuth,
    requireAdmin,
    async (req, res) => {
      const moduleId = id(req.params.id);
      const versionId = id(req.params.versionId);

      const parsed = Lessons.safeParse(req.body);
      if (!parsed.success) {
        throw new HttpError(400, parsed.error.issues[0]?.message ?? "Check the lessons.");
      }

      const client = await pool.connect();
      try {
        await client.query("begin");

        const version = await client.query<{ id: string }>(
          `select id from module_versions
            where id = $1 and module_id = $2 and status = 'draft'
              for update`,
          [versionId, moduleId],
        );
        if (!version.rows[0]) {
          await client.query("rollback");
          throw new HttpError(404, "Not found");
        }

        await client.query(`delete from lessons where module_version_id = $1`, [versionId]);

        for (const [index, lesson] of parsed.data.lessons.entries()) {
          await client.query(
            `insert into lessons (module_version_id, sort_order, title, content)
             values ($1, $2, $3, $4)`,
            [versionId, index, lesson.title, JSON.stringify({ blocks: lesson.blocks })],
          );
        }

        await client.query("commit");
        res.json({ lessons: parsed.data.lessons.length });
      } catch (err) {
        await client.query("rollback").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
  );

  /**
   * §6.4's impact preview.
   *
   * **Counted, never estimated.** The dialog's whole job is to let an admin
   * decide whether to publish, and a number that is approximately right is
   * worse than none: the sentences under it are promises about real people.
   */
  router.get(
    "/admin/modules/:id/versions/:versionId/impact",
    requireAuth,
    requireAdmin,
    async (req, res) => {
      const moduleId = id(req.params.id);
      const versionId = id(req.params.versionId);

      const version = await pool.query<{ version_no: number; title: string; status: string }>(
        `select version_no, title, status from module_versions
          where id = $1 and module_id = $2`,
        [versionId, moduleId],
      );
      if (!version.rows[0]) throw new HttpError(404, "Not found");

      const current = await pool.query<{ id: string; version_no: number }>(
        `select id, version_no from module_versions
          where module_id = $1 and status = 'published'`,
        [moduleId],
      );

      const counts = await pool.query<{ roadmaps: string; taking: string; passed: string }>(
        `select
           (select count(distinct r.id)
              from roadmap_items ri
              join roadmaps r on r.id = ri.roadmap_id
             where ri.module_id = $1 and r.status = 'active') as roadmaps,
           (select count(*) from module_enrollments
             where module_id = $1
               and module_version_id = coalesce($2, '00000000-0000-0000-0000-000000000000'::uuid)
               and user_id not in (select user_id from module_completions where module_id = $1)
           ) as taking,
           (select count(*) from module_completions where module_id = $1) as passed`,
        [moduleId, current.rows[0]?.id ?? null],
      );

      res.json({
        versionNo: version.rows[0].version_no,
        title: version.rows[0].title,
        currentVersionNo: current.rows[0]?.version_no ?? null,
        activeRoadmaps: Number(counts.rows[0].roadmaps),
        takingCurrent: Number(counts.rows[0].taking),
        passed: Number(counts.rows[0].passed),
      });
    },
  );

  /**
   * Publish a draft (§6.3, §6.4).
   *
   * **The one action here that changes what a learner sees**, so it is the one
   * that is logged (§6.1 step 5), and the log entry and the publish are one
   * transaction.
   *
   * `module_versions_one_published` is a partial unique index, so demoting the
   * old version and promoting the draft **must** happen together — two
   * published versions is a state the database refuses. That is the right place
   * for the invariant: a bug here fails loudly instead of leaving a module with
   * two live versions and no way to tell which a learner gets.
   *
   * §6 rule 6 needs no code: `module_enrollments` and `module_completions`
   * reference a version id directly, so a learner on version 2 stays on version
   * 2 because nothing moved them. Nothing in this file writes to either table.
   */
  router.post(
    "/admin/modules/:id/versions/:versionId/publish",
    requireAuth,
    requireAdmin,
    async (req, res) => {
      const admin = sessionUser(req);
      const moduleId = id(req.params.id);
      const versionId = id(req.params.versionId);

      const client = await pool.connect();
      try {
        await client.query("begin");

        const draft = await client.query<{ version_no: number; title: string }>(
          `select version_no, title from module_versions
            where id = $1 and module_id = $2 and status = 'draft'
              for update`,
          [versionId, moduleId],
        );
        if (!draft.rows[0]) {
          await client.query("rollback");
          throw new HttpError(404, "Not found");
        }

        await requireSomethingToRead(client, versionId);

        const demoted = await client.query<{ id: string; version_no: number }>(
          `update module_versions set status = 'superseded'
            where module_id = $1 and status = 'published'
            returning id, version_no`,
          [moduleId],
        );

        await client.query(
          `update module_versions
              set status = 'published', published_at = now(), published_by = $2, updated_at = now()
            where id = $1`,
          [versionId, admin.id],
        );

        await logAdminAction(client, {
          adminId: admin.id,
          action: "module_version.published",
          targetType: "module_version",
          targetId: versionId,
          details: {
            moduleId,
            versionNo: draft.rows[0].version_no,
            supersededVersionNo: demoted.rows[0]?.version_no ?? null,
          },
        });

        await client.query("commit");

        // §6.4's toast: "Version 3 of Components in React published."
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

  /**
   * Discard a draft (§6.3's "Discard draft").
   *
   * **The only delete in this file, and only ever a draft.** §6 rule 5: nothing
   * learners depend on is hard-deleted. A draft is by definition something no
   * learner has seen — it is not `published`, so no enrollment can reference it
   * — which is what makes this safe where deleting any other version would not
   * be.
   *
   * Logged even though no learner is affected: work disappeared, and §6.12's
   * activity log is where an author asks "where did my draft go".
   */
  router.delete(
    "/admin/modules/:id/versions/:versionId",
    requireAuth,
    requireAdmin,
    async (req, res) => {
      const admin = sessionUser(req);
      const moduleId = id(req.params.id);
      const versionId = id(req.params.versionId);

      const client = await pool.connect();
      try {
        await client.query("begin");

        const draft = await client.query<{ version_no: number }>(
          `delete from module_versions
            where id = $1 and module_id = $2 and status = 'draft'
            returning version_no`,
          [versionId, moduleId],
        );
        if (!draft.rows[0]) {
          await client.query("rollback");
          throw new HttpError(404, "Not found");
        }

        await logAdminAction(client, {
          adminId: admin.id,
          action: "module_version.discarded",
          targetType: "module_version",
          targetId: versionId,
          details: { moduleId, versionNo: draft.rows[0].version_no },
        });

        await client.query("commit");
        res.json({ discarded: draft.rows[0].version_no });
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

/**
 * What must be true before learners can be sent here.
 *
 * §6.3 blocks publishing when a reference solution fails its tests. These are
 * the same idea for the parts that exist: a version a learner opens must have
 * something to read, and an assessment they can be sent to must have something
 * in it. **A half-finished module reaches a learner as a bug in the platform**,
 * not as a draft somebody was still working on.
 *
 * The reference-solution check itself arrives with the exercise editor, which
 * needs the worker: the sandbox is not in this process.
 */
async function requireSomethingToRead(client: PoolClient, versionId: string): Promise<void> {
  const lessons = await client.query<{ count: string }>(
    `select count(*) as count from lessons where module_version_id = $1`,
    [versionId],
  );

  if (Number(lessons.rows[0].count) === 0) {
    throw new HttpError(400, "Add at least one lesson before publishing this version.");
  }

  /*
   * An empty quiz is worse than no quiz: the module page offers it, the learner
   * opens it, and there is nothing there. Having none at all is a legitimate
   * state — not every module is assessed — so this refuses the empty one rather
   * than requiring one.
   */
  const quizzes = await client.query<{ title: string; questions: string }>(
    // Grouped here, counted here, filtered below: pg-mem does not support
    // `having`, so a query using it could not be tested. See packages/test-db.
    `select a.title, count(q.id) as questions
       from assessments a
       left join quiz_questions q on q.assessment_id = a.id
      where a.module_version_id = $1 and a.type = 'quiz'
      group by a.id, a.title`,
    [versionId],
  );

  const emptyQuiz = { rows: quizzes.rows.filter((q) => Number(q.questions) === 0) };

  if (emptyQuiz.rows[0]) {
    throw new HttpError(
      400,
      `"${emptyQuiz.rows[0].title}" has no questions. Add one, or remove the quiz.`,
    );
  }

  /*
   * §6.3: "Publishing is blocked if the reference solution fails any test."
   *
   * **Checked as a fact, not re-run here.** The sandbox is in the worker, and
   * `last_verified_at` is the column it writes on a full pass — cleared by every
   * edit to the exercise, so a stamp that survives means the solution passed
   * against exactly these cases.
   *
   * A learner who reaches an exercise whose own answer fails has been handed a
   * problem with no solution and no way to know it.
   */
  const unverified = await client.query<{ title: string; verified: Date | null }>(
    `select a.title, r.last_verified_at as verified
       from assessments a
       left join reference_solutions r on r.assessment_id = a.id
      where a.module_version_id = $1 and a.type = 'code'`,
    [versionId],
  );

  const failing = unverified.rows.find((row) => row.verified === null);
  if (failing) {
    throw new HttpError(
      400,
      `"${failing.title}" has not been verified. Run its tests against the reference solution first.`,
    );
  }
}
