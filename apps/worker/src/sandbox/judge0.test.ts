import { describe, expect, it } from "vitest";
import { Judge0Runner, type Judge0Submission } from "./judge0.js";
import { buildHarness, RESULT_MARKER, UnsupportedRuntime } from "./harness.js";
import type { RunRequest } from "./types.js";

/**
 * Judge0's **single status** has to become §5.11's list of ticks.
 *
 * Reading the per-case output is shared with the local container sandbox and is
 * tested in `results.test.ts`. What is Judge0-specific, and therefore here, is
 * turning one overall status — compile error, time limit, runtime error, an
 * internal failure — into something a learner can act on without being blamed
 * for a problem that was not theirs.
 *
 * **Not the sandbox in use on this machine.** Judge0 needs cgroup v1 and
 * Docker Desktop's WSL 2 VM is cgroup v2 unified. It is kept tested because it
 * works unchanged on a Linux host — see `docker/judge0/README.md`.
 *
 * No container is needed either way: Judge0's response is data.
 */

const runner = new Judge0Runner({ url: "http://127.0.0.1:2358" });

/** The third is hidden on purpose — redaction downstream depends on that flag. */
const cases = [
  { i: 0, id: "case-a", name: "Sums [2, 4, 6] to 12", hidden: false },
  { i: 1, id: "case-b", name: "Includes the first item", hidden: false },
  { i: 2, id: "case-c", name: "Works on a longer list", hidden: true },
];

const line = (o: Record<string, unknown>) => `${RESULT_MARKER} ${JSON.stringify(o)}`;

const submission = (over: Partial<Judge0Submission> = {}): Judge0Submission => ({
  stdout: null,
  stderr: null,
  compile_output: null,
  message: null,
  time: "0.05",
  status: { id: 3, description: "Accepted" },
  ...over,
});

describe("reading a finished submission", () => {
  /**
   * Judge0's stdout is read by the shared `readOutcomes`, which
   * `results.test.ts` covers in full. This is only here to prove Judge0's
   * response is wired into it at all.
   */
  it("hands stdout to the shared reader", () => {
    const result = runner.readResult(
      submission({
        stdout: [
          line({ i: 0, passed: true }),
          line({ i: 1, passed: false, expected: "2", actual: "0" }),
          line({ i: 2, passed: true }),
        ].join("\n"),
      }),
      cases,
    );

    expect(result.error).toBeUndefined();
    expect(result.outcomes.map((o) => o.passed)).toEqual([true, false, true]);
    expect(result.outcomes[1].expected).toBe("2");
    expect(result.outcomes.map((o) => o.testCaseId)).toEqual(["case-a", "case-b", "case-c"]);
  });

  /** Still asserted here, because it is the property that must never regress. */
  it("fails a case that reported nothing", () => {
    const result = runner.readResult(submission({ stdout: line({ i: 0, passed: true }) }), cases);

    expect(result.outcomes[0].passed).toBe(true);
    expect(result.outcomes[1].passed).toBe(false);
    expect(result.outcomes[2].passed).toBe(false);
  });
});

describe("a run that never produced results", () => {
  const failsEverything = (result: { outcomes: { passed: boolean }[]; error?: string }) => {
    expect(result.outcomes.every((o) => !o.passed)).toBe(true);
    expect(result.error).toBeTruthy();
  };

  /** §9: pass the compiler's own words through — they are the useful part. */
  it("passes a compile error through", () => {
    const result = runner.readResult(
      submission({
        status: { id: 6, description: "Compilation Error" },
        compile_output: "SyntaxError: Unexpected token }",
      }),
      cases,
    );

    failsEverything(result);
    expect(result.error).toContain("Unexpected token");
  });

  /** §9: explain and direct. "Time Limit Exceeded" tells a beginner nothing. */
  it("explains a timeout as a loop that never ends", () => {
    const result = runner.readResult(
      submission({ status: { id: 5, description: "Time Limit Exceeded" } }),
      cases,
    );

    failsEverything(result);
    expect(result.error).toContain("loop that never ends");
    expect(result.error).not.toContain("Time Limit Exceeded");
  });

  it.each([7, 8, 11, 12])("reports runtime error status %s with stderr", (id) => {
    const result = runner.readResult(
      submission({ status: { id, description: "Runtime Error" }, stderr: "RangeError: stack" }),
      cases,
    );

    failsEverything(result);
    expect(result.error).toContain("RangeError");
  });

  /**
   * Queued or an internal error. The platform has no results, and it must not
   * tell a learner their tests failed when they never ran.
   */
  it.each([1, 2, 13, 14])("does not blame the learner for status %s", (id) => {
    const result = runner.readResult(
      submission({ status: { id, description: "Internal Error" }, message: "isolate: cgroup" }),
      cases,
    );

    failsEverything(result);
    expect(result.error).toContain("cgroup");
  });

});

describe("which runtimes it takes", () => {
  it.each(["javascript", "python"])("supports %s", (runtime) => {
    expect(runner.supports(runtime)).toBe(true);
  });

  /**
   * React and Vue need Vitest with jsdom and a node_modules tree, which Judge0
   * has not got. Saying so means the worker records an honest error rather than
   * reporting a syntax error as the learner's fault.
   */
  it.each(["react", "vue"])("does not claim to support %s", (runtime) => {
    expect(runner.supports(runtime)).toBe(false);
  });

  it("fails a react submission without pretending to run it", async () => {
    const result = await runner.run({
      runtime: "react",
      files: [{ path: "App.jsx", content: "export default function App() {}" }],
      cases: [{ id: "case-a", name: "renders", code: "expect(true).toBe(true);", visible: true }],
    });

    expect(result.outcomes[0].passed).toBe(false);
    expect(result.error).toContain("component test runner");
    expect(result.error).toContain("Your work is saved");
  });
});
