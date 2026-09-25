import { describe, expect, it } from "vitest";
import { readOutcomes, trim } from "./results.js";
import { RESULT_MARKER } from "./harness.js";

/**
 * **The rule that decides whether a learner passed**, tested once and used by
 * both sandboxes.
 *
 * The outcomes come out of the learner's own stdout — their code and the
 * assertions share one program and one output stream — so these tests are mostly
 * about what happens when that output is missing, mangled, or forged.
 */

/** The third is hidden on purpose — redaction downstream depends on that flag. */
const cases = [
  { i: 0, id: "case-a", name: "Sums [2, 4, 6] to 12", hidden: false },
  { i: 1, id: "case-b", name: "Includes the first item", hidden: false },
  { i: 2, id: "case-c", name: "Works on a longer list", hidden: true },
];

const line = (o: Record<string, unknown>) => `${RESULT_MARKER} ${JSON.stringify(o)}`;

describe("reading a run's output", () => {
  it("reports each case as the harness printed it", () => {
    const result = readOutcomes(
      [
        line({ i: 0, passed: true }),
        line({ i: 1, passed: false, expected: "2", actual: "0" }),
        line({ i: 2, passed: true }),
      ].join("\n"),
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
   * failure. Code that exits early, or deletes the assertions, must not clear
   * the exercise by staying quiet — that is how the hidden cases would stop
   * meaning anything.
   */
  it("fails a case that reported nothing", () => {
    const result = readOutcomes(line({ i: 0, passed: true }), cases);

    expect(result.outcomes[0].passed).toBe(true);
    expect(result.outcomes[1].passed).toBe(false);
    expect(result.outcomes[2].passed).toBe(false);
    expect(result.outcomes[2].actual).toContain("did not report");
  });

  it("passes nothing when the program printed nothing at all", () => {
    const result = readOutcomes("", cases);

    expect(result.outcomes.every((o) => !o.passed)).toBe(true);
    // Not the learner's fault, so it is an error rather than a clean failure.
    expect(result.error).toContain("problem on our side");
  });

  /** A learner's own `console.log` shares the stream and must be ignored. */
  it("ignores output that is not a result line", () => {
    const result = readOutcomes(
      [
        "debugging my loop",
        line({ i: 0, passed: true }),
        "total is 12",
        line({ i: 1, passed: true }),
        "{ not json }",
        line({ i: 2, passed: true }),
      ].join("\n"),
      cases,
    );

    expect(result.outcomes.every((o) => o.passed)).toBe(true);
    expect(result.error).toBeUndefined();
  });

  /**
   * **The marker is what separates a result from a learner's output**, and a
   * learner can print valid JSON. Without it, `console.log('{"i":1,...}')` in a
   * solution would forge a pass.
   */
  it("ignores a result-shaped line that has no marker", () => {
    const result = readOutcomes(
      [
        line({ i: 0, passed: true }),
        JSON.stringify({ i: 1, passed: true }),
        '{"i": 2, "passed": true}',
      ].join("\n"),
      cases,
    );

    expect(result.outcomes[0].passed).toBe(true);
    expect(result.outcomes[1].passed).toBe(false);
    expect(result.outcomes[2].passed).toBe(false);
  });

  /**
   * A learner could print a line that looks like a result. The harness never
   * puts a database id in the source, so a forgery carries an index — and the
   * first line for an index wins, so it cannot overwrite a real failure.
   */
  it("keeps the first result for a case, not a later forgery", () => {
    const result = readOutcomes(
      [line({ i: 1, passed: false, expected: "2", actual: "0" }), line({ i: 1, passed: true })].join(
        "\n",
      ),
      cases,
    );

    expect(result.outcomes[1].passed).toBe(false);
  });

  it("drops a result for a case this run did not send", () => {
    const result = readOutcomes(
      [line({ i: 0, passed: true }), line({ i: 99, passed: true })].join("\n"),
      cases,
    );

    expect(result.outcomes).toHaveLength(3);
    expect(result.outcomes.filter((o) => o.passed)).toHaveLength(1);
  });

  /**
   * Nothing usable came back, so this is our problem, not the learner's — and
   * the message has to say so.
   */
  it("does not blame the learner when only unusable lines came back", () => {
    const result = readOutcomes(
      [line({ i: 98, passed: true }), line({ i: 99, passed: true })].join("\n"),
      cases,
    );

    expect(result.outcomes.every((o) => !o.passed)).toBe(true);
    expect(result.error).toContain("problem on our side");
  });

  /**
   * **The bug this file did not catch.** `readOutcomes` reported `hidden: false`
   * for every case, because `HarnessCase` did not carry the flag. `redact()` in
   * `submissions.ts` keys on exactly that, so nothing was ever redacted — and a
   * failing hidden case would have sent its expected and actual to the learner's
   * screen, which is the §6 rule 2 leak hidden cases exist to prevent.
   *
   * It survived because the two sides were tested against their own assumptions:
   * `submissions.test.ts` fed redaction a `hidden: true` outcome from a fake
   * runner, and this file never asserted the flag at all. A real run found it.
   */
  it("marks a hidden case as hidden, so redaction downstream can see it", () => {
    const result = readOutcomes(
      [
        line({ i: 0, passed: true }),
        line({ i: 1, passed: false, expected: "2", actual: "0" }),
        line({ i: 2, passed: false, expected: "44", actual: "41" }),
      ].join("\n"),
      cases,
    );

    expect(result.outcomes[0].hidden).toBe(false);
    expect(result.outcomes[1].hidden).toBe(false);
    expect(result.outcomes[2].hidden).toBe(true);
  });

  it("marks a hidden case that reported nothing as hidden too", () => {
    const result = readOutcomes(line({ i: 0, passed: true }), cases);

    expect(result.outcomes[2].passed).toBe(false);
    expect(result.outcomes[2].hidden).toBe(true);
  });

  it("keeps hidden set when nothing ran at all", () => {
    const result = readOutcomes("", cases);
    expect(result.outcomes.map((o) => o.hidden)).toEqual([false, false, true]);
  });

  it("reports a thrown error as what the case actually did", () => {
    const result = readOutcomes(
      line({ i: 0, passed: false, error: "sumEven is not a function" }),
      cases,
    );

    expect(result.outcomes[0].passed).toBe(false);
    expect(result.outcomes[0].actual).toBe("sumEven is not a function");
  });

  /** An expected/actual pair is more useful than a message, so it wins. */
  it("prefers expected and actual over a thrown message", () => {
    const result = readOutcomes(
      line({ i: 0, passed: false, expected: "12", actual: "10", error: "noise" }),
      cases,
    );

    expect(result.outcomes[0].expected).toBe("12");
    expect(result.outcomes[0].actual).toBe("10");
  });
});

describe("trim", () => {
  it("leaves short output alone", () => {
    expect(trim("  SyntaxError: bad  ")).toBe("SyntaxError: bad");
  });

  it("returns null for nothing", () => {
    expect(trim("")).toBeNull();
    expect(trim("   ")).toBeNull();
    expect(trim(null)).toBeNull();
    expect(trim(undefined)).toBeNull();
  });

  /** Read on a phone (§11), and by a model on an 8GB budget (§7). */
  it("truncates very long output", () => {
    const trimmed = trim("x".repeat(5000))!;
    expect(trimmed.length).toBeLessThan(2100);
    expect(trimmed).toContain("…");
  });
});
