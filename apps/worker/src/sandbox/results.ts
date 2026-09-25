import { z } from "zod";
import type { RunResult, TestOutcome } from "./types.js";
import { RESULT_MARKER, type HarnessCase } from "./harness.js";

/**
 * Reading a sandbox's stdout back into per-case outcomes.
 *
 * **This is the rule that decides whether a learner passed**, so it lives in
 * exactly one place. Both sandboxes — Judge0 and the local container runner —
 * run the same harness and read its output through here. Two copies of this
 * logic would be two chances for one of them to drift into treating silence as
 * success.
 *
 * ### What it trusts
 *
 * Nothing. The outcomes come out of the **learner's own stdout**: their code and
 * the assertions share one program and one output stream, so a learner can print
 * a line that looks like a result. Three things make that harmless:
 *
 * 1. A result line must carry `RESULT_MARKER`. A learner printing bare JSON —
 *    `console.log('{"i":1,"passed":true}')` — is not a result.
 * 2. It must name an index this run actually sent. The harness never puts a
 *    database id or a case name in the source, so a forgery has no real case to
 *    attach to.
 * 3. The **first** line for an index wins, so a forged duplicate cannot
 *    overwrite a real failure.
 *
 * And above all: **a case that reports nothing is a failure.** Code that exits
 * early, or deletes the assertions, fails the exercise. Treating silence as a
 * pass is how the hidden cases would stop meaning anything.
 */

const ResultLine = z.object({
  i: z.number().int().nonnegative(),
  passed: z.boolean(),
  expected: z.string().optional(),
  actual: z.string().optional(),
  error: z.string().optional(),
});
type ResultLine = z.infer<typeof ResultLine>;

/** Every case failed, and not because of anything the learner wrote. */
export function failAll(cases: HarnessCase[]): TestOutcome[] {
  return cases.map((c) => ({
    testCaseId: c.id,
    name: c.name,
    passed: false,
    hidden: c.hidden,
  }));
}

export function readOutcomes(stdout: string, cases: HarnessCase[]): RunResult {
  const reported = parseLines(stdout, cases.length);

  const outcomes: TestOutcome[] = cases.map((c) => {
    const line = reported.get(c.i);
    if (!line) {
      return {
        testCaseId: c.id,
        name: c.name,
        passed: false,
        hidden: c.hidden,
        actual: "the test did not report a result",
      };
    }
    return {
      testCaseId: c.id,
      name: c.name,
      passed: line.passed,
      hidden: c.hidden,
      ...(line.expected !== undefined ? { expected: line.expected } : {}),
      ...(line.actual !== undefined ? { actual: line.actual } : {}),
      // Their code threw rather than failing an assertion, so the message is
      // the most useful thing we have to show as "what happened".
      ...(line.error !== undefined && line.actual === undefined ? { actual: line.error } : {}),
    };
  });

  /**
   * Nothing usable came back at all. The program reported success but stdout is
   * not what the harness writes, so this is **our** problem and the message has
   * to say so — every test failing would blame the learner for it.
   */
  if (reported.size === 0 && cases.length > 0) {
    return {
      outcomes,
      error:
        "The tests ran but reported nothing back. This is a problem on our side, not with " +
        "your code — your work is saved.",
    };
  }

  return { outcomes };
}

function parseLines(stdout: string, count: number): Map<number, ResultLine> {
  const found = new Map<number, ResultLine>();

  for (const raw of stdout.split("\n")) {
    const line = raw.trim();
    if (!line.startsWith(RESULT_MARKER)) continue;

    let json: unknown;
    try {
      json = JSON.parse(line.slice(RESULT_MARKER.length).trim());
    } catch {
      continue;
    }

    const parsed = ResultLine.safeParse(json);
    if (!parsed.success) continue;
    if (parsed.data.i >= count) continue;
    if (found.has(parsed.data.i)) continue;

    found.set(parsed.data.i, parsed.data);
  }

  return found;
}

/**
 * Trims output that is read on a phone too (§11), and by a model on an 8GB
 * budget (§7). Enough to find the problem, not a whole stack trace.
 */
export function trim(value: string | null | undefined, limit = 2000): string | null {
  const text = value?.trim();
  if (!text) return null;
  return text.length > limit ? `${text.slice(0, limit)}\n…` : text;
}
