import { Router } from "express";
import type { Pool } from "pg";
import { requireAdmin, requireAuth } from "../middleware/session.js";

/**
 * The admin overview (design.md §6.1).
 *
 * **Every number here is counted, never estimated.** §6.1 is a page whose whole
 * job is to say what needs attention, so a figure that is approximately right is
 * worse than no figure: an admin who learns the counts drift stops acting on
 * them, and the screen becomes decoration. Where the schema cannot answer a
 * question §6.1 asks, this returns nothing for it and the screen says so, rather
 * than returning a plausible number.
 *
 * It is a read, so nothing here writes `admin_activity_log` (§6.1 step 5 is for
 * actions that change a learner's outcome). `requireAdmin` answers 404 rather
 * than 403, because a 403 confirms the route exists.
 *
 * **`select` lists columns.** Several of these touch `users` and
 * `code_submissions`, which hold a password hash and learner source; §6.1 step 6
 * exists for exactly this kind of aggregate query, where `*` is tempting and
 * nothing would look wrong.
 */

/** Below this, a module is "struggling" (§6.1 draws 41% and 38%). */
const STRUGGLING_BELOW = 0.6;

/**
 * A module needs this many learners before its pass rate is shown.
 *
 * One learner failing once is a 0% pass rate, and putting that at the top of an
 * admin's page would bury the module that fifteen people are actually stuck on.
 * The threshold is small because the platform is small; it exists to stop a
 * single attempt reading as a trend.
 */
const ENOUGH_LEARNERS = 3;

/** §6.1's "Active learners". Counted as a sign-in, not as a page view. */
const ACTIVE_WITHIN_DAYS = 30;

export function adminOverviewRoutes(pool: Pool): Router {
  const router = Router();

  router.get("/admin/overview", requireAuth, requireAdmin, async (_req, res) => {
    const [review, content, modules, milestones, totals] = await Promise.all([
      needsReview(pool),
      contentGaps(pool),
      strugglingModules(pool),
      strugglingMilestones(pool),
      totalsFor(pool),
    ]);

    res.json({ ...review, ...content, ...totals, strugglingModules: modules, strugglingMilestones: milestones });
  });

  return router;
}

/** §6.1's "Needs review" panel. Both are things an admin has to rule on. */
async function needsReview(pool: Pool) {
  const { rows } = await pool.query<{ ai: string; projects: string }>(
    `select
       (select count(*) from ai_feedback_flags where status = 'open') as ai,
       (select count(*) from integrity_flags where status = 'open') as projects`,
  );

  return {
    openAiFlags: Number(rows[0].ai),
    openProjectFlags: Number(rows[0].projects),
  };
}

/**
 * §6.1's "Content" panel: drafts, and briefs missing a starter template.
 *
 * **A missing starter template is a real failure, not a tidiness warning.** A
 * learner who picks Vue and finds no template cannot start their capstone at
 * all, and nothing else in the platform surfaces it — `starter_templates` has a
 * row per (brief version, technology) and simply lacking one is silent.
 */
async function contentGaps(pool: Pool) {
  const drafts = await pool.query<{ title: string; module_slug: string; updated_at: Date }>(
    `select v.title, m.slug as module_slug, v.updated_at
       from module_versions v
       join modules m on m.id = v.module_id
      where v.status = 'draft'
      order by v.updated_at desc
      limit 5`,
  );

  const draftCount = await pool.query<{ count: string }>(
    `select count(*) as count from module_versions where status = 'draft'`,
  );

  /*
   * A published brief should have a template for every technology its track
   * offers. The pair that is missing is what an admin needs, not a count: "Task
   * tracker is missing Vue" is actionable, "1 gap" is not.
   */
  const missing = await pool.query<{ brief_title: string; technology: string }>(
    `select bv.title as brief_title, t.name as technology
       from capstone_brief_versions bv
       join capstone_briefs b on b.id = bv.brief_id
       join technology_decisions td on td.track_id = b.track_id
       join decision_options o on o.decision_id = td.id and o.status = 'published'
       join technologies t on t.id = o.technology_id
       left join starter_templates st
              on st.brief_version_id = bv.id and st.technology_id = t.id
      where bv.status = 'published' and st.brief_version_id is null
      order by bv.title, t.name`,
  );

  return {
    draftCount: Number(draftCount.rows[0].count),
    drafts: drafts.rows.map((row) => ({
      title: row.title,
      moduleSlug: row.module_slug,
      updatedAt: row.updated_at,
    })),
    missingTemplates: missing.rows.map((row) => ({
      briefTitle: row.brief_title,
      technology: row.technology,
    })),
  };
}

/**
 * §6.1's "Learners struggling": modules whose pass rate is low.
 *
 * **Counted per learner, not per attempt.** One learner failing an exercise six
 * times and passing on the seventh is a learner who got there; counting
 * attempts would read that as a 14% pass rate and send an admin to rewrite a
 * module that works. The question §6.1 asks is how many *people* are stuck.
 *
 * **`count(distinct case when ... end)`, not `count(distinct ...) filter`.**
 * The two mean the same thing in PostgreSQL, and pg-mem **silently ignores the
 * `filter`** — it answered "4 of 4 passed" for one pass and three failures. Not
 * an error, a wrong number, which is the worst kind: every test over this query
 * would have agreed with a production answer that was different.
 */
async function strugglingModules(pool: Pool) {
  const { rows } = await pool.query<{
    slug: string;
    title: string;
    learners: string;
    passed: string;
  }>(
    `select m.slug, v.title,
            count(distinct a.user_id) as learners,
            count(distinct case when a.passed then a.user_id end) as passed
       from assessment_attempts a
       join assessments s on s.id = a.assessment_id
       join module_versions v on v.id = s.module_version_id
       join modules m on m.id = v.module_id
      group by m.slug, v.title`,
  );

  /*
   * **The thresholds are applied here, not in a `having` clause.**
   *
   * Partly because pg-mem does not support `having` at all, so the alternative
   * was a query the tests could not run — and an untested aggregate is how a
   * page of numbers starts drifting. But it reads better this way regardless:
   * `ENOUGH_LEARNERS` and `STRUGGLING_BELOW` are policy, and policy named in
   * TypeScript beside its reasoning is easier to find and change than the same
   * numbers buried in a `having`.
   *
   * The grouping — the expensive part — still happens in Postgres. What comes
   * back is one row per module, not one per attempt.
   */
  return rows
    .map((row) => ({
      slug: row.slug,
      title: row.title,
      learners: Number(row.learners),
      passRate: Number(row.passed) / Number(row.learners),
    }))
    .filter((m) => m.learners >= ENOUGH_LEARNERS && m.passRate < STRUGGLING_BELOW)
    .sort((a, b) => a.passRate - b.passRate)
    .slice(0, 5);
}

/**
 * §6.1's second struggling row: "Milestone 4: Save tasks — 38% stuck".
 *
 * **Stuck means tried and not finished**, counted per project. A project that
 * has not reached a milestone is not stuck on it, so only projects with an
 * attempt are counted — otherwise every milestone would look worse the more
 * learners joined.
 */
async function strugglingMilestones(pool: Pool) {
  /*
   * **Grouped by milestone id, with the titles fetched separately.**
   *
   * `milestones.title` and `capstone_brief_versions.title` share a column name,
   * and under `group by` pg-mem resolves two aliases of the same name to the
   * same value — this panel used to select both in one grouped query, and in
   * tests the milestone's title came back as the brief's. Real PostgreSQL
   * answers correctly, which is why nothing caught it: the figure was right
   * and the label was wrong, only under the test engine. Found while building
   * §6.9, which asks the same question. `packages/test-db` lists the
   * divergence; `overview.test.ts` now covers this panel, which it did not.
   */
  const counts = await pool.query<{
    milestone_id: string;
    attempted: string;
    complete: string;
  }>(
    `select at.milestone_id,
            count(distinct at.project_id) as attempted,
            count(distinct case when at.status = 'complete' then at.project_id end) as complete
       from milestone_attempts at
      group by at.milestone_id`,
  );

  const titles = await pool.query<{
    id: string;
    milestone_title: string;
    brief_title: string;
    sort_order: number;
  }>(
    `select ms.id, ms.title as milestone_title, bv.title as brief_title, ms.sort_order
       from milestones ms
       join capstone_brief_versions bv on bv.id = ms.brief_version_id
      order by ms.sort_order`,
  );

  const countFor = new Map(counts.rows.map((row) => [row.milestone_id, row]));

  // Same reasoning as `strugglingModules` above: the thresholds are policy.
  return titles.rows
    .map((row) => {
      const c = countFor.get(row.id);
      const attempted = Number(c?.attempted ?? 0);
      return {
        title: row.milestone_title,
        briefTitle: row.brief_title,
        attempted,
        stuckRate: attempted === 0 ? 0 : 1 - Number(c?.complete ?? 0) / attempted,
      };
    })
    .filter((m) => m.attempted >= ENOUGH_LEARNERS && m.stuckRate > 1 - STRUGGLING_BELOW)
    .slice(0, 5);
}

/** §6.1's footer line: active learners, and certificates this month. */
async function totalsFor(pool: Pool) {
  const { rows } = await pool.query<{
    active: string;
    issued: string;
    revoked: string;
  }>(
    `select
       (select count(distinct s.user_id)
          from sessions s
          join users u on u.id = s.user_id
         where u.role = 'learner' and u.status = 'active'
           and s.created_at > now() - ($1 || ' days')::interval) as active,
       (select count(*) from certificates
         where issued_at >= date_trunc('month', now()) and status <> 'revoked') as issued,
       (select count(*) from certificates
         where issued_at >= date_trunc('month', now()) and status = 'revoked') as revoked`,
    [String(ACTIVE_WITHIN_DAYS)],
  );

  return {
    activeLearners: Number(rows[0].active),
    certificatesThisMonth: Number(rows[0].issued),
    revokedThisMonth: Number(rows[0].revoked),
    activeWithinDays: ACTIVE_WITHIN_DAYS,
  };
}
