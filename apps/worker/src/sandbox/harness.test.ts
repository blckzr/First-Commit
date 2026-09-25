import { describe, expect, it } from "vitest";
import { buildHarness, UnsupportedRuntime } from "./harness.js";
import type { RunRequest } from "./types.js";

/**
 * Compiling an exercise into one program.
 *
 * Both sandboxes run this same program, so what it contains — and more
 * importantly what it does **not** contain — is tested here once.
 */

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
