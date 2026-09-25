import type { Pool } from "pg";
import type { Runner, TestOutcome } from "./runner.js";

/**
 * Running a learner's coding exercise (design.md §5.11).
 *
 * **This is the third place the platform writes evidence**, and the only one
 * outside the API. AGENT.md §6 rule 4: "Browser test results never count.
 * Only worker-run results are written as evidence." So the passing decision is
 * made here, from cases this process read out of the database and ran itself —
 * never from anything that arrived with the submission.
 *
 * §7: the Code Review AI explains these results; it does not produce them.
 * Tests run first, then the job is queued with the outcomes attached, which is
 * what keeps feedback grounded in something that actually happened.
 */

export interface Submission {
  id: string;
  user_id: string;
  assessment_id: string;
  files: { path: string; content: string }[];
}

interface CaseRow {
  id: string;
  name: string;
  test_code: string;
  is_visible: boolean;
}

/**
 * Runs one submission and records what happened.
 *
 * Returns the outcome so the caller can log it. Throws only on a database
 * failure: a submission the runner could not run is a **completed piece of
 * work with a bad result**, not an error in this function, and it is written
 * as `error` with an explanation rather than retried forever.
 */
export async function runSubmission(
  pool: Pool,
  runner: Runner,
  submission: Submission,
): Promise<{ passed: boolean; status: string }> {
  const assessment = await pool.query<{
    runtime: string | null;
    module_id: string;
    module_version_id: string;
  }>(
    `select a.runtime, v.module_id, v.id as module_version_id
       from assessments a
       join module_versions v on v.id = a.module_version_id
      where a.id = $1 and a.type = 'code'`,
    [submission.assessment_id],
  );
  if (!assessment.rows[0]) {
    await fail(pool, submission.id, "That exercise no longer exists.");
    return { passed: false, status: "error" };
  }
  const { runtime, module_id, module_version_id } = assessment.rows[0];

  /**
   * **Every case, hidden ones included.** The API filters `is_visible` because
   * a learner must not read a hidden case; the worker must run it, or the
   * hidden cases would decide nothing.
   */
  const cases = await pool.query<CaseRow>(
    `select id, name, test_code, is_visible from test_cases
      where assessment_id = $1 order by sort_order`,
    [submission.assessment_id],
  );

  if (cases.rows.length === 0) {
    await fail(pool, submission.id, "That exercise has no test cases yet.");
    return { passed: false, status: "error" };
  }

  const result = await runner.run({
    runtime: runtime ?? "javascript",
    files: submission.files,
    cases: cases.rows.map((c) => ({
      id: c.id,
      name: c.name,
      code: c.test_code,
      visible: c.is_visible,
    })),
  });

  /**
   * Passing means **every** case passed. There is no partial credit on an
   * exercise: `assessments.passing_score` is 100 for one, and a percentage
   * would let a solution that fails the hidden cases through.
   */
  const passed = !result.error && result.outcomes.every((o) => o.passed);

  await pool.query(
    `update code_submissions
        set status = $2, test_results = $3, passed = $4, completed_at = now()
      where id = $1`,
    [
      submission.id,
      result.error ? "error" : "completed",
      JSON.stringify(redact(result.outcomes)),
      result.error ? null : passed,
    ],
  );

  if (passed) {
    /**
     * §6 rule 7: progress belongs to the learner, not the roadmap — one row
     * per learner per module, read by every roadmap they have.
     *
     * `do nothing` on conflict: a learner who already passed the module keeps
     * that completion, and redoing the exercise does not move their
     * `completed_at`.
     */
    await pool.query(
      `insert into module_completions (user_id, module_id, module_version_id, method, score)
       values ($1, $2, $3, 'passed', 100)
       on conflict (user_id, module_id) do nothing`,
      [submission.user_id, module_id, module_version_id],
    );
  }

  return { passed, status: result.error ? "error" : "completed" };
}

/**
 * What a learner is allowed to read back.
 *
 * A hidden case keeps its **name** — "one of the hidden checks failed" is
 * useful and honest — but loses its expected and actual values, which would
 * describe the input it was hiding (§6 rule 2).
 */
function redact(outcomes: TestOutcome[]): TestOutcome[] {
  return outcomes.map((o) =>
    o.hidden ? { testCaseId: o.testCaseId, name: o.name, passed: o.passed, hidden: true } : o,
  );
}

async function fail(pool: Pool, id: string, message: string): Promise<void> {
  await pool.query(
    `update code_submissions
        set status = 'error', passed = null, completed_at = now(), test_results = $2
      where id = $1`,
    [id, JSON.stringify({ error: message })],
  );
}

/**
 * Queues the Code Review AI on a finished submission.
 *
 * §7: "Tests and checks run *before* any model call", and "correctness claims
 * must come from test and check results". The job carries the outcomes so the
 * model explains a run that happened rather than reading the code and guessing
 * at one.
 *
 * Queued for failures only. There is nothing to explain about a pass, and
 * `code_feedback` gives hints — which a learner who just passed does not need.
 */
export async function queueFeedback(
  pool: Pool,
  submission: Submission,
  outcomes: TestOutcome[],
): Promise<void> {
  const failing = outcomes.filter((o) => !o.passed);
  if (failing.length === 0) return;

  await pool.query(
    `insert into ai_jobs (type, user_id, source_id, payload)
     values ('code_feedback', $1, $2, $3)`,
    [
      submission.user_id,
      submission.id,
      JSON.stringify({
        files: submission.files,
        // Names and values only. The assertion itself stays server-side, and
        // a hidden case has already been redacted by the time it gets here.
        failing: failing.map((o) => ({
          name: o.name,
          expected: o.expected,
          actual: o.actual,
        })),
      }),
    ],
  );
}
