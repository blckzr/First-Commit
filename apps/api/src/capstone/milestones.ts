import type { Pool } from "pg";
import type { GitHubClient } from "../github/index.js";
import { runChecks, type CheckResult, type MilestoneCheck } from "./checks.js";
import { flagProject } from "./integrity.js";

/**
 * Milestones and their attempts (`design.md` §5.14 stage 3).
 *
 * ### `milestone_attempts` is evidence
 *
 * AGENT.md §6 rule 1 lists it beside `module_completions` and `certificates`:
 * never written from anything a browser sent. Every row here is written from
 * `runChecks()` — results the API computed from what GitHub reports — and no
 * endpoint accepts a status, a check result, or a `passed` flag. A learner can
 * ask for the checks to be run again; they cannot say how they came out.
 *
 * ### `review_checklist` never leaves the server
 *
 * It is the rubric the Code Review AI judges against, and §6 rule 2 names
 * rubrics among the things that must not reach a learner response. Nothing in
 * this file selects it. `acceptance_criteria` is the opposite — §5.14 draws it
 * on the screen as the list of what the milestone wants.
 *
 * ### An attempt is per commit
 *
 * `(project, milestone, commit_sha)` is the unit, so re-reading the page does
 * not re-run checks against a commit already judged — which would be a handful
 * of GitHub requests on every poll. A **pending** attempt is the exception: it
 * is not a verdict yet, so it is re-run until the workflow finishes.
 */

export interface MilestoneView {
  id: string;
  sortOrder: number;
  title: string;
  acceptanceCriteria: string[];
  /** Asked after some milestones (§5.14). Null when this one asks nothing. */
  explanationQuestion: string | null;
  /** The modules this milestone draws on, filtered to the learner's technology. */
  modules: { id: string; title: string; slug: string }[];
  status: "complete" | "failed" | "checking" | "not-started";
  /** The commit the latest attempt judged, if there is one. */
  commitSha: string | null;
  checks: CheckResult[];
  explanationAnswer: string | null;
  /**
   * The AI review of this attempt, once the worker has written one.
   *
   * `outputId` is what §7's flag control points at — every AI output is
   * labelled, carries a reason, and is flaggable, and a panel without an id to
   * flag would be missing one of the three.
   */
  review: {
    outputId: string;
    summary: string;
    checklist: { criterion: string; met: boolean; note: string }[];
    nextStep: string;
  } | null;
}

interface MilestoneRow {
  id: string;
  sort_order: number;
  title: string;
  acceptance_criteria: unknown;
  explanation_question: string | null;
}

export interface ProjectForMilestones {
  id: string;
  brief_version_id: string;
  technology_id: string;
  repo_full_name: string | null;
  demo_url: string | null;
  installation_id: string | null;
}

/**
 * Every milestone of the project's brief, with where the learner has got to.
 *
 * Checks run here for the **current** milestone only — the first one not yet
 * complete. Running them for all five on every read would be five times the
 * GitHub traffic to tell a learner something about milestones they have either
 * finished or not reached.
 */
export async function readMilestones(
  pool: Pool,
  github: GitHubClient,
  project: ProjectForMilestones,
  latestSha: string | null,
): Promise<MilestoneView[]> {
  const milestones = await pool.query<MilestoneRow>(
    // No `review_checklist`: §6 rule 2. It is the AI's rubric, not the
    // learner's reading.
    `select id, sort_order, title, acceptance_criteria, explanation_question
       from milestones
      where brief_version_id = $1
      order by sort_order`,
    [project.brief_version_id],
  );

  /**
   * Related modules, filtered to the technology the learner chose.
   *
   * A milestone lists the React *and* Vue variants of a skill, because one
   * brief serves both. Showing a React learner a Vue module would send them to
   * something that is not on their roadmap.
   */
  const modules = await pool.query<{
    milestone_id: string;
    id: string;
    slug: string;
    title: string;
    technology_id: string | null;
  }>(
    `select mm.milestone_id, m.id, m.slug, v.title, m.technology_id
       from milestone_modules mm
       join modules m on m.id = mm.module_id
       join module_versions v on v.module_id = m.id and v.status = 'published'`,
  );

  const attempts = await pool.query<{
    id: string;
    milestone_id: string;
    commit_sha: string;
    status: string;
    check_results: unknown;
    explanation_answer: string | null;
  }>(
    `select id, milestone_id, commit_sha, status, check_results, explanation_answer
       from milestone_attempts
      where project_id = $1
      order by created_at`,
    [project.id],
  );

  /**
   * The AI review per attempt, by the `ai_outputs` row the worker writes with
   * `source_id` set to the attempt. Read here rather than joined above so an
   * attempt with no review yet is simply null, not a missing row.
   */
  const reviews = await pool.query<{ source_id: string; id: string; content: unknown }>(
    `select o.source_id, o.id, o.content
       from ai_outputs o
       join milestone_attempts a on a.id = o.source_id
      where a.project_id = $1 and o.source_type = 'milestone_review'
      order by o.created_at`,
    [project.id],
  );
  const reviewByAttempt = new Map(reviews.rows.map((r) => [r.source_id, r]));

  const latestAttempt = new Map<string, (typeof attempts.rows)[number]>();
  const completed = new Set<string>();
  for (const attempt of attempts.rows) {
    latestAttempt.set(attempt.milestone_id, attempt);
    if (attempt.status === "complete") completed.add(attempt.milestone_id);
  }

  /**
   * The first milestone not yet complete, worked out **once** for this read.
   *
   * So completing one does not immediately judge the next: that happens on the
   * following read, which the screen makes within a second of showing the
   * result. One milestone's worth of GitHub traffic per read is the trade, and
   * it is the right way round — the alternative walks the whole brief every
   * time somebody opens the page.
   */
  const current = milestones.rows.find((m) => !completed.has(m.id));

  const views: MilestoneView[] = [];
  for (const row of milestones.rows) {
    let attempt = latestAttempt.get(row.id);

    /**
     * Re-judged only when this is the milestone being worked on, there is a
     * commit to judge, and the result would be new — a different commit, or a
     * previous run that was still waiting on the workflow.
     */
    const stale =
      !attempt || attempt.commit_sha !== latestSha || attempt.status === "checking";

    if (current?.id === row.id && latestSha && stale) {
      const recorded = await evaluate(pool, github, project, row.id, latestSha);
      if (recorded) attempt = { ...recorded, explanation_answer: attempt?.explanation_answer ?? null };
    }

    views.push({
      id: row.id,
      sortOrder: row.sort_order,
      title: row.title,
      acceptanceCriteria: asStrings(row.acceptance_criteria),
      explanationQuestion: row.explanation_question,
      modules: modules.rows
        .filter(
          (m) =>
            m.milestone_id === row.id &&
            (m.technology_id === null || m.technology_id === project.technology_id),
        )
        .map((m) => ({ id: m.id, slug: m.slug, title: m.title })),
      status:
        attempt?.status === "complete"
          ? "complete"
          : attempt?.status === "failed"
            ? "failed"
            : attempt
              ? "checking"
              : "not-started",
      commitSha: attempt?.commit_sha ?? null,
      checks: asChecks(attempt?.check_results),
      explanationAnswer: attempt?.explanation_answer ?? null,
      review: asReview(attempt?.id ? reviewByAttempt.get(attempt.id) : undefined),
    });
  }

  /**
   * **A project is finished when its milestones are**, and the platform works
   * that out rather than being told (§6 rule 1). Every milestone of the brief
   * must hold a `complete` attempt — which only `evaluate()` writes, from checks
   * the API ran.
   *
   * Written here, on the read that completes the last one, for the same reason
   * `syncCertificates()` decides on read: the worker cannot call this, and a
   * learner looking at the tracker is the moment the answer has to be current.
   */
  if (milestones.rows.length > 0 && views.every((view) => view.status === "complete")) {
    const finished = await pool.query(
      `update capstone_projects
          set status = 'completed', completed_at = coalesce(completed_at, now())
        where id = $1 and completed_at is null
        returning id`,
      [project.id],
    );

    /**
     * Integrity signals, raised **once**, on the read that finishes the project
     * — which is the moment a Project Certificate becomes issuable and §6.7's
     * review has something to decide about.
     *
     * Only when the update actually changed a row, so re-reading a finished
     * project does not run the detection again. A flag changes nothing on the
     * learner's screen and nothing about their certificate (§6 rule 2 makes it
     * admin-only); it asks a person to look.
     */
    if (finished.rowCount) {
      await flagProject(pool, project.id);
    }
  }

  return views;
}

/**
 * Runs the checks for one milestone against one commit and records the attempt.
 *
 * **The status is derived from the results, never supplied.** Any pending check
 * means the whole attempt is still `checking`; any failure means `failed`; only
 * all-passed is `complete`. That ordering matters — a milestone with one failing
 * and one still-running check is not complete, and is not yet a failure either.
 */
async function evaluate(
  pool: Pool,
  github: GitHubClient,
  project: ProjectForMilestones,
  milestoneId: string,
  sha: string,
): Promise<{
  id: string;
  milestone_id: string;
  commit_sha: string;
  status: string;
  check_results: unknown;
} | null> {
  if (!project.repo_full_name || !project.installation_id) return null;

  const checks = await pool.query<{
    id: string;
    type: string;
    name: string;
    config: unknown;
  }>(
    `select id, type, name, config from milestone_checks
      where milestone_id = $1 order by sort_order`,
    [milestoneId],
  );

  const results = await runChecks(
    github,
    checks.rows.map((c) => ({
      id: c.id,
      type: c.type as MilestoneCheck["type"],
      name: c.name,
      config: (c.config ?? {}) as Record<string, unknown>,
    })),
    {
      installationId: Number(project.installation_id),
      repoFullName: project.repo_full_name,
      sha,
      demoUrl: project.demo_url,
    },
  );

  const status = results.some((r) => r.state === "pending")
    ? "checking"
    : results.every((r) => r.state === "passed")
      ? "complete"
      : "failed";

  /**
   * One row per (project, milestone, commit). Re-running against the same
   * commit updates it — a workflow that finished since the last read turns a
   * `checking` row into its verdict rather than adding a second.
   *
   * `milestone_attempts_one_complete` is a partial unique index on
   * `(project_id, milestone_id) where status = 'complete'`, so a milestone
   * cannot be completed twice however many commits are judged.
   */
  const existing = await pool.query<{ id: string }>(
    `select id from milestone_attempts
      where project_id = $1 and milestone_id = $2 and commit_sha = $3`,
    [project.id, milestoneId, sha],
  );

  let attemptId: string;
  if (existing.rows[0]) {
    attemptId = existing.rows[0].id;
    await pool.query(
      `update milestone_attempts
          set status = $1, check_results = $2,
              completed_at = case when $1 = 'complete' then now() else null end
        where id = $3`,
      [status, JSON.stringify(results), attemptId],
    );
  } else {
    const inserted = await pool.query<{ id: string }>(
      `insert into milestone_attempts
         (project_id, milestone_id, commit_sha, status, check_results, completed_at)
       values ($1, $2, $3, $4, $5, case when $4 = 'complete' then now() else null end)
       returning id`,
      [project.id, milestoneId, sha, status, JSON.stringify(results)],
    );
    attemptId = inserted.rows[0].id;
  }

  /**
   * Queue the AI review — but only once a verdict exists.
   *
   * Nothing useful can be said while a workflow is still running: the model
   * would be explaining results that have not arrived, which is the one thing
   * §7 forbids. A `checking` attempt is re-judged on the next read anyway, and
   * the review is queued then.
   */
  if (status !== "checking") {
    await queueReview(pool, github, project, milestoneId, sha, results);
  }

  return { id: attemptId, milestone_id: milestoneId, commit_sha: sha, status, check_results: results };
}

/**
 * Queues `milestone_review` with everything the worker needs in the payload.
 *
 * **The diff goes in the job.** The worker has no GitHub credentials — the
 * App's private key lives only in the API — so the diff is fetched here and
 * sent, exactly as `queueFeedback` sends files and test results for
 * `code_feedback`. The checks travel with it, which keeps §7's ordering: the
 * model is handed conclusions, never asked to reach them.
 *
 * `source_id` is the **attempt**, so the `ai_outputs` row the worker writes
 * hangs off it and `POST /ai-outputs/:id/flags` works with no new endpoint
 * (§7: all AI output is flaggable).
 */
async function queueReview(
  pool: Pool,
  github: GitHubClient,
  project: ProjectForMilestones,
  milestoneId: string,
  sha: string,
  results: CheckResult[],
): Promise<void> {
  if (!project.repo_full_name || !project.installation_id) return;

  const attempt = await pool.query<{ id: string; user_id: string }>(
    `select a.id, p.user_id
       from milestone_attempts a
       join capstone_projects p on p.id = a.project_id
      where a.project_id = $1 and a.milestone_id = $2 and a.commit_sha = $3`,
    [project.id, milestoneId, sha],
  );
  if (!attempt.rows[0]) return;

  /**
   * One review per attempt. Re-reading the page must not queue another — the
   * worker handles one job at a time on one 8GB card, and a queue filling with
   * duplicates of the same review would starve everything else.
   */
  const existing = await pool.query(
    `select 1 from ai_jobs
      where type = 'milestone_review' and source_id = $1 and status <> 'failed'`,
    [attempt.rows[0].id],
  );
  if (existing.rowCount) return;

  const milestone = await pool.query<{
    title: string;
    acceptance_criteria: unknown;
    review_checklist: unknown;
  }>(
    // `review_checklist` is read **here** and sent to the worker, which is
    // allowed: §6 rule 2 keeps it out of a *learner* response, and this is a
    // server-to-server payload. Nothing in `readMilestones` selects it.
    `select title, acceptance_criteria, review_checklist from milestones where id = $1`,
    [milestoneId],
  );
  if (!milestone.rows[0]) return;

  let files;
  try {
    files = await github.commitDiff(
      Number(project.installation_id),
      project.repo_full_name,
      sha,
    );
  } catch {
    // No diff, no review. Not an error worth failing the read for — the next
    // push queues another.
    return;
  }

  await pool.query(
    `insert into ai_jobs (type, user_id, source_id, payload)
     values ('milestone_review', $1, $2, $3)`,
    [
      attempt.rows[0].user_id,
      attempt.rows[0].id,
      JSON.stringify({
        milestoneTitle: milestone.rows[0].title,
        acceptanceCriteria: asStrings(milestone.rows[0].acceptance_criteria),
        reviewChecklist: asStrings(milestone.rows[0].review_checklist),
        checks: results.map((r) => ({ name: r.name, state: r.state, detail: r.detail })),
        commitSha: sha,
        files,
      }),
    ],
  );
}

function asStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function asChecks(value: unknown): CheckResult[] {
  return Array.isArray(value) ? (value as CheckResult[]) : [];
}

/**
 * The stored review, shaped for the screen.
 *
 * Read defensively rather than cast: `ai_outputs.content` is `jsonb` written by
 * another process, and a model whose output shape changed between prompt
 * versions should leave the panel empty rather than crash the whole tracker.
 */
function asReview(row?: { id: string; content: unknown }): MilestoneView["review"] {
  if (!row || typeof row.content !== "object" || row.content === null) return null;

  const content = row.content as Record<string, unknown>;
  if (typeof content.summary !== "string" || typeof content.nextStep !== "string") return null;

  return {
    outputId: row.id,
    summary: content.summary,
    nextStep: content.nextStep,
    checklist: Array.isArray(content.checklist)
      ? (content.checklist as { criterion: string; met: boolean; note: string }[])
      : [],
  };
}
