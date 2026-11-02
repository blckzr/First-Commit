import { Router } from "express";
import type { Pool } from "pg";
import { HttpError } from "../middleware/errors.js";
import { requireAdmin, requireAuth } from "../middleware/session.js";

/**
 * Analytics (design.md §6.9).
 *
 * **"Show where learners succeed and where they get stuck"** — so every figure
 * here has to be one an admin could act on. Three rules follow from that, and
 * they are the reason this file is longer than the queries it holds:
 *
 * 1. **Counted per learner, never per attempt.** Someone failing an exercise
 *    six times and passing on the seventh is a learner who got there. Counting
 *    attempts reads that as a 14% pass rate and sends an author to rewrite a
 *    module that works. The overview already made this choice; analytics is
 *    where it would be easiest to quietly make the other one.
 * 2. **A rate needs a denominator worth having.** One learner is not a trend,
 *    so anything below `ENOUGH_LEARNERS` is returned with its counts and no
 *    rate, and the screen shows "too few to say" rather than 0%.
 * 3. **A question the schema cannot answer is returned as unanswerable**, not
 *    as a zero. §6.9 asks for "switches between options", and
 *    `roadmap_technology_choices` is keyed `(roadmap_id, decision_id)` — a
 *    switch overwrites `technology_id` and leaves nothing behind. Reporting
 *    "0 switches" would be a lie that looks like data; the response says the
 *    history is not recorded and the screen prints that sentence.
 *
 * It is all reads. Nothing here writes `admin_activity_log` (§6.1 step 5 is for
 * actions that change a learner's outcome) and nothing writes evidence.
 *
 * **`select` lists columns** (§6.1 step 6) — these queries touch `users` and
 * `code_submissions`, which hold a password hash and learner source, and an
 * aggregate is exactly where `select *` looks harmless.
 *
 * **No `filter (where ...)` and no `having` anywhere in this file.** pg-mem
 * *silently ignores* `filter` and returns the unfiltered count, and does not
 * support `having` at all. Both are in `packages/test-db`'s divergence list;
 * the first is the dangerous one, because a test over it agrees with a wrong
 * answer. `count(case when … then … end)` and a TypeScript threshold instead.
 */

/** Below this many learners, a rate is noise. Matches the overview's threshold. */
const ENOUGH_LEARNERS = 3;

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A rate, or null when too few learners to mean anything. */
const rate = (part: number, whole: number): number | null =>
  whole >= ENOUGH_LEARNERS ? part / whole : null;

export function adminAnalyticsRoutes(pool: Pool): Router {
  const router = Router();

  /** The career paths the funnel can be drawn for. */
  router.get("/admin/analytics/paths", requireAuth, requireAdmin, async (_req, res) => {
    const { rows } = await pool.query<{ id: string; title: string; status: string }>(
      `select id, title, status::text as status from career_paths order by title`,
    );
    res.json({ paths: rows.map((r) => ({ id: r.id, title: r.title, status: r.status })) });
  });

  /**
   * §6.9's journey funnel, for one career path.
   *
   * **Each stage counts learners who reached it, not learners still there.** A
   * funnel of current states would show someone who earned a certificate as
   * having "left" the finished-core stage, and every stage would shrink for the
   * wrong reason. Reaching a stage is permanent here.
   *
   * "Finished core" is the honest hard one: it means every module the path
   * marks `required_for_certificate` on a **core** skill is in that learner's
   * completions. Counted against the path's current requirements — if an admin
   * marks a module optional tomorrow, more learners will have finished core,
   * which is correct, because the requirement is what it is now.
   */
  router.get("/admin/analytics/funnel", requireAuth, requireAdmin, async (req, res) => {
    const pathId = requiredId(req.query.path);

    const exists = await pool.query<{ id: string }>(
      `select id from career_paths where id = $1`,
      [pathId],
    );
    if (!exists.rows[0]) throw new HttpError(404, "Not found");

    /*
     * The modules a learner must pass for this path's certificate of
     * completion, on the core layer. One query, then the set intersection in
     * TypeScript — a correlated subquery over the same tables is on the pg-mem
     * divergence list and would not run in the tests.
     */
    const required = await pool.query<{ module_id: string }>(
      `select psm.module_id
         from path_skills ps
         join path_skill_modules psm on psm.path_skill_id = ps.id
        where ps.career_path_id = $1 and ps.layer = 'core'
          and psm.required_for_certificate`,
      [pathId],
    );
    const requiredIds = new Set(required.rows.map((r) => r.module_id));

    const roadmaps = await pool.query<{ user_id: string; id: string }>(
      `select user_id, id from roadmaps where career_path_id = $1`,
      [pathId],
    );
    const learners = new Set(roadmaps.rows.map((r) => r.user_id));
    const roadmapIds = new Set(roadmaps.rows.map((r) => r.id));

    const completions = await pool.query<{ user_id: string; module_id: string }>(
      `select mc.user_id, mc.module_id
         from module_completions mc
         join roadmaps r on r.user_id = mc.user_id
        where r.career_path_id = $1`,
      [pathId],
    );
    const passedByUser = new Map<string, Set<string>>();
    for (const row of completions.rows) {
      const set = passedByUser.get(row.user_id) ?? new Set<string>();
      set.add(row.module_id);
      passedByUser.set(row.user_id, set);
    }

    const finishedCore = [...learners].filter((userId) => {
      const passed = passedByUser.get(userId) ?? new Set<string>();
      return requiredIds.size > 0 && [...requiredIds].every((m) => passed.has(m));
    }).length;

    const chose = await pool.query<{ user_id: string }>(
      `select distinct r.user_id
         from roadmap_technology_choices c
         join roadmaps r on r.id = c.roadmap_id
        where r.career_path_id = $1 and c.technology_id is not null`,
      [pathId],
    );

    const projects = await pool.query<{ user_id: string }>(
      `select distinct pr.user_id
         from capstone_projects pr
         join roadmaps r on r.id = pr.roadmap_id
        where r.career_path_id = $1`,
      [pathId],
    );

    const certificates = await pool.query<{ type: string; n: string }>(
      `select c.type::text as type, count(distinct c.user_id) as n
         from certificates c
         join roadmaps r on r.id = c.roadmap_id
        where r.career_path_id = $1 and c.status <> 'revoked'
        group by c.type`,
      [pathId],
    );
    const byType = new Map(certificates.rows.map((r) => [r.type, Number(r.n)]));

    /*
     * The stages in order, each with the count that reached it. The screen
     * draws drop-off between neighbours; it is not computed here, because the
     * interesting comparison is sometimes to the first stage rather than to the
     * one before.
     */
    res.json({
      pathId,
      requiredCoreModules: requiredIds.size,
      stages: [
        { key: "started", label: "Started a roadmap", learners: learners.size },
        { key: "finished_core", label: "Finished the core modules", learners: finishedCore },
        { key: "chose_technology", label: "Chose a technology", learners: chose.rowCount ?? 0 },
        {
          key: "certificate_completion",
          label: "Earned the Certificate of Completion",
          learners: byType.get("completion") ?? 0,
        },
        { key: "started_capstone", label: "Started a capstone", learners: projects.rowCount ?? 0 },
        {
          key: "certificate_project",
          label: "Earned the Project Certificate",
          learners: byType.get("project") ?? 0,
        },
      ],
      roadmaps: roadmapIds.size,
    });
  });

  /**
   * §6.9's modules view: pass rate and drop-off, filterable by technology.
   *
   * **Two different things, deliberately side by side.** Pass rate is of the
   * learners who *attempted* an assessment. Drop-off is of the learners who
   * *started* the module and never finished it — `module_enrollments` against
   * `module_completions`. A module can have a fine pass rate and terrible
   * drop-off, which is the case an author most needs to see: the people it
   * defeated never reached the quiz.
   */
  router.get("/admin/analytics/modules", requireAuth, requireAdmin, async (req, res) => {
    const technologyId =
      req.query.technology === undefined || req.query.technology === ""
        ? null
        : requiredId(req.query.technology);

    const attempts = await pool.query<{
      module_id: string;
      learners: string;
      passed: string;
    }>(
      `select m.id as module_id,
              count(distinct a.user_id) as learners,
              count(distinct case when a.passed then a.user_id end) as passed
         from assessment_attempts a
         join assessments s on s.id = a.assessment_id
         join module_versions v on v.id = s.module_version_id
         join modules m on m.id = v.module_id
        where ($1::uuid is null or m.technology_id = $1::uuid)
        group by m.id`,
      [technologyId],
    );

    const submissions = await pool.query<{
      module_id: string;
      learners: string;
      passed: string;
    }>(
      `select m.id as module_id,
              count(distinct cs.user_id) as learners,
              count(distinct case when cs.passed then cs.user_id end) as passed
         from code_submissions cs
         join assessments s on s.id = cs.assessment_id
         join module_versions v on v.id = s.module_version_id
         join modules m on m.id = v.module_id
        where cs.status = 'completed'
          and ($1::uuid is null or m.technology_id = $1::uuid)
        group by m.id`,
      [technologyId],
    );

    const started = await pool.query<{ module_id: string; n: string }>(
      `select module_id, count(distinct user_id) as n
         from module_enrollments group by module_id`,
    );

    const completed = await pool.query<{ module_id: string; n: string }>(
      `select module_id, count(distinct user_id) as n
         from module_completions group by module_id`,
    );

    const names = await pool.query<{
      id: string;
      slug: string;
      title: string | null;
      technology: string | null;
      kind: string;
    }>(
      `select m.id, m.slug, v.title, t.name as technology, m.kind::text as kind
         from modules m
         left join module_versions v on v.module_id = m.id and v.status = 'published'
         left join technologies t on t.id = m.technology_id
        where ($1::uuid is null or m.technology_id = $1::uuid)`,
      [technologyId],
    );

    const sum = (rows: { module_id: string; learners: string; passed: string }[]) => {
      const out = new Map<string, { learners: number; passed: number }>();
      for (const row of rows) {
        const current = out.get(row.module_id) ?? { learners: 0, passed: 0 };
        out.set(row.module_id, {
          /*
           * A learner who took both a quiz and an exercise in one module is
           * counted once per assessment type, so these are added rather than
           * de-duplicated. The rate is "assessments passed by the people who
           * attempted them", which is what the two numbers beside it say.
           */
          learners: current.learners + Number(row.learners),
          passed: current.passed + Number(row.passed),
        });
      }
      return out;
    };

    const quiz = sum(attempts.rows);
    const code = sum(submissions.rows);
    const startedBy = new Map(started.rows.map((r) => [r.module_id, Number(r.n)]));
    const completedBy = new Map(completed.rows.map((r) => [r.module_id, Number(r.n)]));

    const modules = names.rows
      .map((row) => {
        const q = quiz.get(row.id) ?? { learners: 0, passed: 0 };
        const c = code.get(row.id) ?? { learners: 0, passed: 0 };
        const attempted = q.learners + c.learners;
        const passed = q.passed + c.passed;
        const startedCount = startedBy.get(row.id) ?? 0;
        const completedCount = completedBy.get(row.id) ?? 0;

        return {
          id: row.id,
          slug: row.slug,
          title: row.title ?? row.slug,
          kind: row.kind,
          technology: row.technology,
          attempted,
          passed,
          /** Null below the threshold — the screen says "too few to say". */
          passRate: rate(passed, attempted),
          started: startedCount,
          completed: completedCount,
          droppedOff: Math.max(0, startedCount - completedCount),
          dropOffRate: rate(Math.max(0, startedCount - completedCount), startedCount),
        };
      })
      .sort((a, b) => b.started - a.started || a.slug.localeCompare(b.slug));

    const technologies = await pool.query<{ id: string; name: string }>(
      `select id, name from technologies order by name`,
    );

    res.json({
      modules,
      technologies: technologies.rows.map((t) => ({ id: t.id, name: t.name })),
      enoughLearners: ENOUGH_LEARNERS,
    });
  });

  /**
   * §6.9's milestones view: "where learners stop progressing in each brief".
   *
   * **Only projects that reached a milestone count against it.** A project that
   * has not got there is not stuck on it, and counting every project would make
   * every milestone look worse as the platform grew — including milestone one,
   * against every learner who is still connecting a repository.
   */
  router.get("/admin/analytics/milestones", requireAuth, requireAdmin, async (_req, res) => {
    /*
     * **The counts are grouped by milestone id alone, and the titles come from
     * a separate query.**
     *
     * `milestones.title` and `capstone_brief_versions.title` are both called
     * `title`, and under `group by` pg-mem resolves two aliases of the same
     * column name to the same value — the first version of this returned "Task
     * tracker" as the *milestone's* title. The aliases were right and the
     * answer was wrong, which is the worst shape a bug can take here. See
     * `packages/test-db`'s divergence list.
     */
    const counts = await pool.query<{
      milestone_id: string;
      attempted: string;
      complete: string;
      failures: string;
    }>(
      `select ms.id as milestone_id,
              count(distinct at.project_id) as attempted,
              count(distinct case when at.status = 'complete' then at.project_id end) as complete,
              count(case when at.status = 'failed' then 1 end) as failures
         from milestones ms
         left join milestone_attempts at on at.milestone_id = ms.id
        group by ms.id`,
    );

    const titles = await pool.query<{
      id: string;
      milestone_title: string;
      sort_order: number;
      brief_title: string;
    }>(
      `select ms.id, ms.title as milestone_title, ms.sort_order, bv.title as brief_title
         from milestones ms
         join capstone_brief_versions bv on bv.id = ms.brief_version_id
        order by bv.title, ms.sort_order`,
    );

    const countFor = new Map(counts.rows.map((row) => [row.milestone_id, row]));

    res.json({
      milestones: titles.rows.map((row) => {
        const c = countFor.get(row.id);
        const attempted = Number(c?.attempted ?? 0);
        const complete = Number(c?.complete ?? 0);
        return {
          id: row.id,
          title: row.milestone_title,
          sortOrder: row.sort_order,
          briefTitle: row.brief_title,
          attempted,
          complete,
          stuck: attempted - complete,
          stuckRate: rate(attempted - complete, attempted),
          /** Attempts, not learners: how hard it is, not how many it stopped. */
          failedAttempts: Number(c?.failures ?? 0),
        };
      }),
      enoughLearners: ENOUGH_LEARNERS,
    });
  });

  /**
   * §6.9's technology choices: the share taking each option.
   *
   * **"and switches between options" is not answerable and says so.**
   * `roadmap_technology_choices` has primary key `(roadmap_id, decision_id)`,
   * so changing a choice overwrites `technology_id` in place. There is no
   * history table, no audit column, and nothing in the log — a switch leaves
   * no trace at all. Returning `switches: 0` would read as "nobody switches",
   * which is a claim this platform cannot make; `switchesRecorded: false` is
   * the truth and the screen prints it as a sentence.
   */
  router.get("/admin/analytics/technologies", requireAuth, requireAdmin, async (_req, res) => {
    /*
     * **Grouped by ids only; the names are looked up separately and joined in
     * TypeScript.**
     *
     * Not a style choice. Under `group by`, pg-mem resolves two aliases of the
     * *same column name* from different tables to the same value: a single
     * query selecting `d.title as decision_title` beside `tr.title as track_title`
     * returned the track's title for both. The aliases were right, the shape was
     * right, and the answer was wrong — so every decision on this screen was
     * labelled "Frontend". Added to `packages/test-db`'s divergence list; the
     * same query without `group by` is fine, which is what made it hard to see.
     */
    const grouped = await pool.query<{
      decision_id: string;
      technology_id: string | null;
      recommended_id: string | null;
      n: string;
    }>(
      `select c.decision_id, c.technology_id, c.recommended_technology_id as recommended_id,
              count(*) as n
         from roadmap_technology_choices c
        group by c.decision_id, c.technology_id, c.recommended_technology_id`,
    );

    const decisionRows = await pool.query<{
      id: string;
      decision_title: string;
      track_title: string;
    }>(
      `select d.id, d.title as decision_title, tr.title as track_title
         from technology_decisions d
         join tracks tr on tr.id = d.track_id`,
    );
    const names = await pool.query<{ id: string; name: string }>(
      `select id, name from technologies`,
    );
    const technologyName = new Map(names.rows.map((t) => [t.id, t.name]));

    const decisions = new Map<
      string,
      {
        id: string;
        title: string;
        trackTitle: string;
        undecided: number;
        options: { technology: string; learners: number; recommendedTo: number }[];
      }
    >();
    for (const row of decisionRows.rows) {
      decisions.set(row.id, {
        id: row.id,
        title: row.decision_title,
        trackTitle: row.track_title,
        undecided: 0,
        options: [],
      });
    }

    for (const row of grouped.rows) {
      const entry = decisions.get(row.decision_id);
      if (!entry) continue;

      if (row.technology_id === null) {
        /** Null until chosen — a roadmap that reached the decision and stopped. */
        entry.undecided += Number(row.n);
        continue;
      }

      const name = technologyName.get(row.technology_id);
      if (!name) continue;
      const existing = entry.options.find((o) => o.technology === name);
      const option = existing ?? { technology: name, learners: 0, recommendedTo: 0 };
      option.learners += Number(row.n);
      if (row.recommended_id === row.technology_id) option.recommendedTo += Number(row.n);
      if (!existing) entry.options.push(option);
    }

    res.json({
      /** Only decisions a learner has actually reached are worth a chart. */
      decisions: [...decisions.values()]
        .filter((d) => d.options.length > 0 || d.undecided > 0)
        .map((d) => ({
          ...d,
          options: d.options.sort((a, b) => b.learners - a.learners),
        })),
      switchesRecorded: false,
      switchesReason:
        "A technology choice is stored once per roadmap and decision, so changing it overwrites the previous answer. Nothing records that a switch happened.",
    });
  });

  /**
   * §6.9's AI quality: flag rate per source, and the share ruled wrong.
   *
   * **The flag rate's denominator is AI outputs, not learners.** "12 flags"
   * means nothing without how much output there was to flag — twelve flags on
   * two thousand pieces of feedback is a different platform from twelve on
   * forty.
   *
   * **The share confirmed wrong is of *ruled* flags, not of all of them.** An
   * open flag is a question nobody has answered; counting it as "not wrong"
   * would make the model look better the further behind an admin fell.
   */
  router.get("/admin/analytics/ai", requireAuth, requireAdmin, async (_req, res) => {
    const outputs = await pool.query<{ source_type: string; n: string }>(
      `select source_type::text as source_type, count(*) as n
         from ai_outputs group by source_type`,
    );

    const flags = await pool.query<{
      source_type: string;
      n: string;
      wrong: string;
      correct: string;
      open: string;
    }>(
      `select o.source_type::text as source_type,
              count(*) as n,
              count(case when f.status = 'confirmed_wrong' then 1 end) as wrong,
              count(case when f.status = 'confirmed_correct' then 1 end) as correct,
              count(case when f.status = 'open' then 1 end) as open
         from ai_feedback_flags f
         join ai_outputs o on o.id = f.ai_output_id
        group by o.source_type`,
    );

    const flagged = new Map(flags.rows.map((r) => [r.source_type, r]));

    res.json({
      sources: outputs.rows.map((row) => {
        const f = flagged.get(row.source_type);
        const total = Number(row.n);
        const flagCount = f ? Number(f.n) : 0;
        const wrong = f ? Number(f.wrong) : 0;
        const correct = f ? Number(f.correct) : 0;
        const ruled = wrong + correct;

        return {
          source: row.source_type,
          outputs: total,
          flags: flagCount,
          flagRate: total >= ENOUGH_LEARNERS ? flagCount / total : null,
          open: f ? Number(f.open) : 0,
          confirmedWrong: wrong,
          confirmedCorrect: correct,
          /** Of the flags an admin has ruled on. Null while none have been. */
          wrongShare: ruled > 0 ? wrong / ruled : null,
        };
      }),
      enoughLearners: ENOUGH_LEARNERS,
    });
  });

  /**
   * §6.9's certificates: issued and revoked over time.
   *
   * By month, over the last year. `date_trunc` is registered in
   * `packages/test-db` because pg-mem has no such function; without it this
   * query would throw in every test and pass in production, which is the
   * reverse of useful.
   */
  router.get("/admin/analytics/certificates", requireAuth, requireAdmin, async (_req, res) => {
    const { rows } = await pool.query<{
      month: Date;
      type: string;
      issued: string;
      revoked: string;
    }>(
      `select date_trunc('month', issued_at) as month,
              type::text as type,
              count(*) as issued,
              count(case when status = 'revoked' then 1 end) as revoked
         from certificates
        where issued_at >= date_trunc('month', now()) - interval '11 months'
        group by date_trunc('month', issued_at), type
        order by month`,
    );

    res.json({
      months: rows.map((row) => ({
        month: row.month,
        type: row.type,
        /**
         * Issued counts every certificate issued that month, revoked included.
         * A revocation is counted in the month the certificate was *issued*,
         * not the month it was withdrawn: `certificates` has `revoked_at`, but
         * the pair only reads as "of the ones we issued then, this many did not
         * hold up" when both sit on the same month.
         */
        issued: Number(row.issued),
        revoked: Number(row.revoked),
      })),
    });
  });

  return router;
}

function requiredId(value: unknown): string {
  if (typeof value !== "string" || !uuid.test(value)) {
    throw new HttpError(400, "Choose a career path.");
  }
  return value;
}
