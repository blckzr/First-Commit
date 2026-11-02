import { z } from "zod";
import type { Pool } from "pg";
import type { Runner } from "./sandbox/types.js";

/**
 * Verifying an exercise's reference solution (design.md §6.3, migration 0005).
 *
 * > "Publishing is blocked if the reference solution fails any test."
 *
 * The API cannot check that: the sandbox is here, in the worker, and that is
 * the point — running submitted code in the process that holds `DATABASE_URL`
 * is what the sandbox design exists to prevent. So the admin screen queues a
 * job and this runs it.
 *
 * **It writes no learner evidence.** `module_completions` is never touched;
 * `submissions.ts` does that for a *learner's* run and is deliberately not
 * reused here. The only thing this writes is `reference_solutions.last_verified_at`,
 * and only on a full pass.
 *
 * **A failure clears the stamp rather than leaving the last good one.** An
 * exercise that passed yesterday and fails today is not verified, and a stale
 * `last_verified_at` is exactly how a broken exercise reaches a learner through
 * a publish check that looks like it ran.
 */

export const ValidateExerciseInput = z.object({
  assessmentId: z.string().uuid(),
});

export interface ValidationResult {
  /** True only when every case passed. */
  verified: boolean;
  outcomes: { name: string; passed: boolean; expected?: string; actual?: string }[];
  /** Set when the sandbox could not run at all — an operator problem. */
  error?: string;
}

export async function validateExercise(
  pool: Pool,
  runner: Runner,
  payload: unknown,
): Promise<ValidationResult> {
  /** Parsed, not cast: the payload crossed a process and a database (§8). */
  const { assessmentId } = ValidateExerciseInput.parse(payload);

  const assessment = await pool.query<{ runtime: string | null; starter_files: unknown }>(
    `select runtime, starter_files from assessments where id = $1 and type = 'code'`,
    [assessmentId],
  );
  if (!assessment.rows[0]) {
    return { verified: false, outcomes: [], error: "That exercise no longer exists." };
  }

  const solution = await pool.query<{ files: { path: string; content: string }[] }>(
    `select files from reference_solutions where assessment_id = $1`,
    [assessmentId],
  );
  if (!solution.rows[0]) {
    return {
      verified: false,
      outcomes: [],
      error: "This exercise has no reference solution yet.",
    };
  }

  const cases = await pool.query<{ id: string; name: string; test_code: string; is_visible: boolean }>(
    `select id, name, test_code, is_visible from test_cases
      where assessment_id = $1 order by sort_order`,
    [assessmentId],
  );
  if (cases.rows.length === 0) {
    return { verified: false, outcomes: [], error: "This exercise has no test cases yet." };
  }

  const runtime = assessment.rows[0].runtime ?? "javascript";

  if (!runner.supports(runtime)) {
    return {
      verified: false,
      outcomes: [],
      error: `This worker cannot run ${runtime} exercises, so it cannot verify this one.`,
    };
  }

  const result = await runner.run({
    runtime,
    files: solution.rows[0].files,
    /**
     * The exercise's own files, so a DOM or component exercise gets the page it
     * asserts against. The same reason `runSubmission` reads them: what a result
     * is measured against belongs to the exercise.
     */
    fixtures: (assessment.rows[0].starter_files as { path: string; content: string }[]) ?? [],
    cases: cases.rows.map((row) => ({
      id: row.id,
      name: row.name,
      code: row.test_code,
      visible: row.is_visible,
    })),
  });

  const verified = result.outcomes.length > 0 && result.outcomes.every((o) => o.passed);

  if (verified) {
    await pool.query(
      `update reference_solutions set last_verified_at = now() where assessment_id = $1`,
      [assessmentId],
    );
  } else {
    /*
     * Cleared, not left alone. An exercise that passed last week and fails now
     * is not verified, and a stale stamp is how a broken exercise reaches a
     * learner through a publish check that appears to have run.
     */
    await pool.query(
      `update reference_solutions set last_verified_at = null where assessment_id = $1`,
      [assessmentId],
    );
  }

  return {
    verified,
    /**
     * **Every case's name and values, hidden ones included.** `redact()` exists
     * because a *learner* may not read a hidden case; an author wrote them and
     * cannot fix a failing one they are not shown. This result is only ever
     * served to an admin.
     */
    outcomes: result.outcomes.map((outcome) => ({
      name: outcome.name,
      passed: outcome.passed,
      expected: outcome.expected,
      actual: outcome.actual,
    })),
    error: result.error,
  };
}
