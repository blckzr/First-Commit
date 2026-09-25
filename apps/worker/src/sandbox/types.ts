/**
 * What a sandbox is, as types.
 *
 * **Separate from `runner.ts` on purpose.** That file holds `createRunner()`,
 * which has to import every implementation; the implementations have to import
 * these types. Keeping both in one file made a cycle — `runner.ts` →
 * `sandbox/docker.ts` → `sandbox/results.ts` → `runner.ts` — and TypeScript
 * quietly resolved `RunResult` as `any` partway round it, which is worse than a
 * build error because it turns off checking exactly where the outcomes are
 * decided.
 *
 * Nothing here imports anything, which is what guarantees the cycle cannot come
 * back.
 */

/** One case as a sandbox reports it. The shape `code_submissions.test_results` holds. */
export interface TestOutcome {
  testCaseId: string;
  name: string;
  passed: boolean;
  /**
   * What the case expected and what it got, for §5.11's "Expected 2, got 0".
   * Absent when the run never reached the assertion.
   */
  expected?: string;
  actual?: string;
  /** Present on a case the learner may not read. Its name is still shown. */
  hidden: boolean;
}

export interface RunRequest {
  runtime: string;
  files: { path: string; content: string }[];
  cases: { id: string; name: string; code: string; visible: boolean }[];
}

export interface RunResult {
  outcomes: TestOutcome[];
  /** Compiler or interpreter output when the code did not run at all. */
  error?: string;
}

export interface Runner {
  name: string;
  /** Whether this runner can handle a `code_runtime`. */
  supports(runtime: string): boolean;
  run(request: RunRequest): Promise<RunResult>;
}
