import type { Pool } from "pg";
import type { Runner, TestOutcome } from "./runner.js";
import { CodeFeedbackInput } from "./prompts/code-feedback.js";

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
 * **It builds the payload the handler declares.** An earlier version wrote
 * `{ files, failing }` — a shape nothing consumed — and the handler cast
 * `job.payload as CodeFeedbackInput` without checking, so every attempt died on
 * `Cannot read properties of undefined (reading 'map')` and retried twice before
 * giving up. `CodeFeedbackInput` is a Zod schema now, and this function is
 * checked against it before anything is written, so a mismatch fails here —
 * beside the code that caused it — rather than three retries later.
 *
 * Queued for failures only. There is nothing to explain about a pass, and
 * `code_feedback` gives hints, which a learner who just passed does not need.
 */
export async function queueFeedback(
  pool: Pool,
  submission: Submission,
  /**
   * The **redacted** outcomes, as written to `code_submissions.test_results`.
   * A hidden case arrives as a name and an outcome with no values, so the model
   * cannot repeat something the learner is not allowed to see — the hint would
   * otherwise hand over the hidden case's answer.
   *
   * Typed as the four fields this actually reads rather than a whole
   * `TestOutcome`, so a caller with only the stored shape does not need a cast.
   * The *redacted* part is a contract the caller keeps; no type can state it.
   */
  outcomes: Pick<TestOutcome, "name" | "passed" | "expected" | "actual">[],
): Promise<void> {
  if (outcomes.length === 0) return;
  if (outcomes.every((o) => o.passed)) return;

  const meta = await pool.query<{
    title: string;
    instructions: string;
    runtime: string | null;
  }>(
    `select title, instructions, runtime from assessments where id = $1`,
    [submission.assessment_id],
  );
  if (!meta.rows[0]) return;

  /**
   * The rubric goes to the **model**, never to the learner (§6 rule 2 names
   * rubrics, and `GET /submissions/:id` strips it from the output). It is what
   * lets feedback speak to what the exercise was teaching rather than only to
   * the assertion that failed.
   */
  const rubric = await pool.query<{ criteria: unknown }>(
    `select criteria from rubrics where assessment_id = $1`,
    [submission.assessment_id],
  );

  const payload = CodeFeedbackInput.parse({
    exerciseTitle: meta.rows[0].title,
    instructions: meta.rows[0].instructions,
    language: meta.rows[0].runtime ?? "javascript",
    files: submission.files,
    // Passes included: the model should be able to say what already works.
    testResults: outcomes.map((o) => ({
      name: o.name,
      passed: o.passed,
      ...(o.expected !== undefined ? { expected: o.expected } : {}),
      ...(o.actual !== undefined ? { actual: o.actual } : {}),
    })),
    // §5's flow names a linter. It is not built, so there is nothing to report
    // and the prompt says "No linter issues." rather than inventing any.
    lintResults: [],
    rubric: criteriaOf(rubric.rows[0]?.criteria),
  });

  await pool.query(
    `insert into ai_jobs (type, user_id, source_id, payload)
     values ('code_feedback', $1, $2, $3)`,
    [submission.user_id, submission.id, JSON.stringify(payload)],
  );
}

/** `rubrics.criteria` is `jsonb`, so it is whatever an author put there. */
function criteriaOf(value: unknown): { name: string; description: string }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((c) => {
    const row = c as Record<string, unknown>;
    return typeof row?.name === "string" && typeof row?.description === "string"
      ? [{ name: row.name, description: row.description }]
      : [];
  });
}
