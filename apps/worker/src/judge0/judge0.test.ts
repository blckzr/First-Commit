import { describe, expect, it } from "vitest";
import { Judge0Runner, type Judge0Submission } from "./index.js";
import { buildHarness, RESULT_MARKER, UnsupportedRuntime } from "./harness.js";
import type { RunRequest } from "../runner.js";

/**
 * Judge0's single status has to become §5.11's list of ticks, and the outcomes
 * come out of the **learner's own stdout**. That makes this mapping the place
 * where a mistake either passes a submission that should not have passed, or
 * blames a learner for something the platform did.
 *
 * No container is needed to test it: Judge0's response is data.
 */

const runner = new Judge0Runner({ url: "http://127.0.0.1:2358" });

const cases = [
  { i: 0, id: "case-a", name: "Sums [2, 4, 6] to 12" },
  { i: 1, id: "case-b", name: "Includes the first item" },
  { i: 2, id: "case-c", name: "Works on a longer list" },
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
  it("reports each case as the harness printed it", () => {
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
    expect(result.outcomes[1].actual).toBe("0");
    // The database id comes from our list, never from the program's output.
    expect(result.outcomes.map((o) => o.testCaseId)).toEqual(["case-a", "case-b", "case-c"]);
  });

  /**
   * **The one that matters most.** A case the program said nothing about is a
   * failure. A solution that exits early, or deletes the assertions, must not
   * clear the exercise by staying quiet — that is how the hidden cases would
   * stop meaning anything.
   */
  it("fails a case that reported nothing", () => {
    const result = runner.readResult(
      submission({ stdout: line({ i: 0, passed: true }) }),
      cases,
    );

    expect(result.outcomes[0].passed).toBe(true);
    expect(result.outcomes[1].passed).toBe(false);
    expect(result.outcomes[2].passed).toBe(false);
    expect(result.outcomes[2].actual).toContain("did not report");
  });

  it("passes nothing when the program printed nothing at all", () => {
    const result = runner.readResult(submission({ stdout: "" }), cases);

    expect(result.outcomes.every((o) => !o.passed)).toBe(true);
    // Not the learner's fault, so it is an error rather than a clean failure.
    expect(result.error).toContain("problem on our side");
  });

  /** A learner's own `console.log` shares the stream and must be ignored. */
  it("ignores output that is not a result line", () => {
    const result = runner.readResult(
      submission({
        stdout: [
          "debugging my loop",
          line({ i: 0, passed: true }),
          "total is 12",
          line({ i: 1, passed: true }),
          "{ not json }",
          line({ i: 2, passed: true }),
        ].join("\n"),
      }),
      cases,
    );

    expect(result.outcomes.every((o) => o.passed)).toBe(true);
    expect(result.error).toBeUndefined();
  });

  /**
   * A learner could print a line that looks like a result. The harness never
   * puts a database id in the source, so a forgery carries an index — and the
   * first line for an index wins, so it cannot overwrite a real failure.
   */
  it("keeps the first result for a case, not a later forgery", () => {
    const result = runner.readResult(
      submission({
        stdout: [
          line({ i: 1, passed: false, expected: "2", actual: "0" }),
          line({ i: 1, passed: true }),
        ].join("\n"),
      }),
      cases,
    );

    expect(result.outcomes[1].passed).toBe(false);
  });

  /**
   * **The marker is what separates a result from a learner's output**, and a
   * learner can print valid JSON. Without it, `console.log('{"i":1,...}')` in a
   * solution would forge a pass. Mutation-testing found this: the other
   * "ignores output" test used lines that were not JSON at all, so dropping the
   * marker check changed nothing.
   */
  it("ignores a result-shaped line that has no marker", () => {
    const result = runner.readResult(
      submission({
        stdout: [
          line({ i: 0, passed: true }),
          JSON.stringify({ i: 1, passed: true }),
          '{"i": 2, "passed": true}',
        ].join("\n"),
      }),
      cases,
    );

    expect(result.outcomes[0].passed).toBe(true);
    expect(result.outcomes[1].passed).toBe(false);
    expect(result.outcomes[2].passed).toBe(false);
  });

  /**
   * Nothing usable came back, so this is our problem, not the learner's — and
   * the message has to say so. Mutation-testing found the out-of-range guard
   * was unobserved: dropping it left the counts right but turned "we got
   * nothing" into "all your tests failed".
   */
  it("does not blame the learner when only unusable lines came back", () => {
    const result = runner.readResult(
      submission({
        stdout: [line({ i: 98, passed: true }), line({ i: 99, passed: true })].join("\n"),
      }),
      cases,
    );

    expect(result.outcomes.every((o) => !o.passed)).toBe(true);
    expect(result.error).toContain("problem on our side");
  });

  it("drops a result for a case this run did not send", () => {
    const result = runner.readResult(
      submission({ stdout: [line({ i: 0, passed: true }), line({ i: 99, passed: true })].join("\n") }),
      cases,
    );

    expect(result.outcomes).toHaveLength(3);
    expect(result.outcomes.filter((o) => o.passed)).toHaveLength(1);
  });

  it("reports a thrown error as what the case actually did", () => {
    const result = runner.readResult(
      submission({ stdout: line({ i: 0, passed: false, error: "sumEven is not a function" }) }),
      cases,
    );

    expect(result.outcomes[0].passed).toBe(false);
    expect(result.outcomes[0].actual).toBe("sumEven is not a function");
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

  it("truncates very long compiler output", () => {
    const result = runner.readResult(
      submission({
        status: { id: 6, description: "Compilation Error" },
        compile_output: "x".repeat(5000),
      }),
      cases,
    );

    expect(result.error!.length).toBeLessThan(2100);
    expect(result.error).toContain("…");
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

describe("the harness it builds", () => {
  const request: RunRequest = {
    runtime: "javascript",
    files: [{ path: "script.js", content: "function sumEven(n) { return 0; }" }],
    cases: [
      { id: "db-id-a", name: "one", code: "expect(sumEven([2])).toBe(2);", visible: true },
      { id: "db-id-b", name: "two", code: "expect(sumEven([])).toBe(0);", visible: false },
    ],
  };

  it("includes the learner's code and every assertion", () => {
    const { source, cases: built } = buildHarness(request);

    expect(source).toContain("function sumEven(n) { return 0; }");
    expect(source).toContain("expect(sumEven([2])).toBe(2);");
    expect(source).toContain("expect(sumEven([])).toBe(0);");
    expect(built.map((c) => c.id)).toEqual(["db-id-a", "db-id-b"]);
  });

  /**
   * §6 rule 2 in a place that is easy to miss: the source goes into a container
   * the learner's code runs in, so anything in it is readable by that code. A
   * database id in there would let a forged result line name a real case.
   */
  it("puts no database id in the source", () => {
    const { source } = buildHarness(request);

    expect(source).not.toContain("db-id-a");
    expect(source).not.toContain("db-id-b");
  });

  /** A hidden case's *name* must not reach the container either. */
  it("puts no case name in the source", () => {
    const { source } = buildHarness({
      ...request,
      cases: [{ id: "x", name: "SECRET-CASE-NAME", code: "expect(1).toBe(1);", visible: false }],
    });

    expect(source).not.toContain("SECRET-CASE-NAME");
  });

  it("indents a python assertion into its function body", () => {
    const { source } = buildHarness({
      runtime: "python",
      files: [{ path: "main.py", content: "def sum_even(n):\n    return 0" }],
      cases: [{ id: "p1", name: "one", code: "expect(sum_even([2])).toBe(2)", visible: true }],
    });

    expect(source).toContain("def __fc_case_0():\n    expect(sum_even([2])).toBe(2)");
  });

  it("refuses a runtime it has no harness for", () => {
    expect(() => buildHarness({ ...request, runtime: "ruby" })).toThrow(UnsupportedRuntime);
  });
});
