import { chatJson } from "../ollama.js";
import {
  buildCodeFeedbackMessages,
  CodeFeedbackInput,
  PROMPT_VERSION,
} from "../prompts/code-feedback.js";
import { CodeFeedback, noSolutionLeak } from "../schemas.js";
import { createRunner } from "../runner.js";
import type { TestOutcome } from "../sandbox/types.js";
import { submissions, type SubmissionFixture } from "./fixtures/submissions.js";
import { rate, ms, type CaseRecord, type Recorder } from "./report.js";
// The seed's own exercise definitions, so the harness and the database can
// never disagree about what a test case is.
// @ts-expect-error — a .mjs data module with no types; the shape is checked below.
import { exercises as rawExercises } from "../../../../supabase/seed/exercises.mjs";

/**
 * Code Review AI evaluation (`project-proposal.md` §9.1).
 *
 * ### The tests really run
 *
 * Each fixture goes through the configured sandbox against the seeded
 * exercise's real cases, and the outcomes that come back are what the model is
 * given — redacted exactly as `submissions.ts` redacts them, so a hidden case
 * reaches the prompt as a name and an outcome and nothing else (§6 rule 2).
 *
 * This is slower than writing the test results by hand, and it is the only way
 * the number means anything: §7's rule is that tests run *before* the model,
 * so an evaluation that skipped them would be measuring a different pipeline
 * from the one learners use.
 *
 * ### What is counted here, and what is left for a person
 *
 * Counted: valid output rate, solution leakage, response time, and whether the
 * sandbox agreed with the fixture's label. **Bug detection and false alarms are
 * not counted here** — §9.1 marks them evaluator-rated, and a keyword match
 * would score vocabulary rather than understanding. They go to the sheet.
 */

interface SeedExercise {
  title: string;
  runtime: string;
  instructions: string;
  testCases: { name: string; visible: boolean; code: string }[];
}

const exercises = rawExercises as Record<string, SeedExercise>;

const COMPONENT = "code_feedback";

export async function evaluateCodeFeedback(recorder: Recorder): Promise<void> {
  const runner = createRunner();
  console.log(`\nCode Review AI — ${submissions.length} submissions through ${runner.name}\n`);

  for (const fixture of submissions) {
    const exercise = exercises[fixture.exercise];
    if (!exercise) throw new Error(`Fixture ${fixture.id} names no seeded exercise`);

    const record = await evaluateOne(runner, fixture, exercise);
    recorder.add(record);

    const mark = record.ok ? "✓" : "✗";
    const note = record.ok
      ? `${record.attempts} attempt${record.attempts === 1 ? "" : "s"}, ${((record.durationMs ?? 0) / 1000).toFixed(1)}s`
      : record.error;
    console.log(`  ${mark} ${fixture.id.padEnd(28)} ${note}`);
  }
}

async function evaluateOne(
  runner: ReturnType<typeof createRunner>,
  fixture: SubmissionFixture,
  exercise: SeedExercise,
): Promise<CaseRecord> {
  const base: CaseRecord = { component: COMPONENT, caseId: fixture.id, ok: false };

  const run = await runner.run({
    runtime: exercise.runtime,
    files: fixture.files,
    cases: exercise.testCases.map((c, i) => ({
      id: `c${i}`,
      name: c.name,
      code: c.code,
      visible: c.visible,
    })),
  });

  if (run.error) {
    return { ...base, error: `the sandbox could not run it: ${run.error}` };
  }

  /**
   * **The fixture's own label is checked before the model is asked anything.**
   *
   * `exercises:check` caught a wrong expected value the first time it ran — the
   * seed loader validates shape and cannot do arithmetic. The same risk applies
   * here and costs more: a submission labelled correct that actually fails would
   * quietly become a false-alarm point against the model, and a bug that does
   * not fail anything gives it nothing to find.
   */
  const failed = run.outcomes.filter((o) => !o.passed);
  const shouldFail = fixture.bug !== null;
  if (shouldFail && failed.length === 0) {
    return { ...base, error: "labelled buggy but every test passed — fix the fixture" };
  }
  if (!shouldFail && failed.length > 0) {
    return {
      ...base,
      error: `labelled correct but failed: ${failed.map((f) => f.name).join(", ")}`,
    };
  }

  // A correct submission is never sent to the model in production either —
  // `queueFeedback` returns early on a full pass. It is run here to prove the
  // fixture is what it says.
  if (!shouldFail) {
    return {
      ...base,
      ok: true,
      metrics: { passedAll: true, sentToModel: false },
    };
  }

  const input = CodeFeedbackInput.parse({
    exerciseTitle: exercise.title,
    instructions: exercise.instructions,
    language: exercise.runtime,
    files: fixture.files,
    testResults: redact(run.outcomes).map((o) => ({
      name: o.name,
      passed: o.passed,
      ...(o.expected !== undefined ? { expected: o.expected } : {}),
      ...(o.actual !== undefined ? { actual: o.actual } : {}),
    })),
    lintResults: [],
    rubric: [],
  });

  try {
    const response = await chatJson({
      schema: CodeFeedback,
      messages: buildCodeFeedbackMessages(input),
      validate: noSolutionLeak,
    });

    return {
      ...base,
      ok: true,
      attempts: response.attempts,
      durationMs: response.durationMs,
      promptVersion: PROMPT_VERSION,
      rejections: response.rejections,
      metrics: {
        sentToModel: true,
        visibleFailures: failed.filter((f) => !f.hidden).length,
        hiddenFailures: failed.filter((f) => f.hidden).length,
        /** The guard firing is the measurement, not a failure (§9.1). */
        leakedThenRetried: response.rejections.filter(isLeak).length,
      },
      scoring: {
        knownBug: fixture.bug,
        failingTests: failed.map((f) => f.name),
        feedback: response.data,
      },
    };
  } catch (err) {
    return { ...base, error: (err as Error).message };
  }
}

/**
 * `noSolutionLeak`'s rejection, as opposed to a schema or shape one.
 *
 * Matched on the guard's own sentence in `schemas.ts` — "A hint contains code."
 * Keep the two in step: if that wording changes, this stops counting and the
 * leakage rate silently reads 0%.
 */
export function isLeak(reason: string): boolean {
  return reason.includes("A hint contains code");
}

/** Exactly what `submissions.ts` does before a hidden case reaches a prompt. */
function redact(outcomes: TestOutcome[]): TestOutcome[] {
  return outcomes.map((o) =>
    o.hidden ? { testCaseId: o.testCaseId, name: o.name, passed: o.passed, hidden: true } : o,
  );
}

export function summariseCodeFeedback(recorder: Recorder): string {
  const all = recorder.of(COMPONENT);
  const asked = all.filter((c) => c.metrics?.sentToModel === true);
  const ok = asked.filter((c) => c.ok);
  const firstTry = ok.filter((c) => c.attempts === 1);
  const leaked = ok.filter((c) => Number(c.metrics?.leakedThenRetried ?? 0) > 0);
  const broken = all.filter((c) => !c.ok);

  const lines = [
    "## Code Review AI",
    "",
    `${submissions.length} submissions, ${asked.length} with a failing test and therefore sent to the model.`,
    "",
    "| Metric | Result |",
    "|---|---|",
    `| Valid output rate (first attempt) | ${rate(firstTry.length, asked.length)} |`,
    `| Needed a retry | ${rate(ok.length - firstTry.length, ok.length)} |`,
    `| Solution leakage, caught and retried | ${rate(leaked.length, ok.length)} |`,
    `| Solution leakage reaching the learner | ${rate(0, ok.length)} — the guard rejects, so this is 0 by construction |`,
    `| Response time, mean | ${ms(ok.map((c) => c.durationMs ?? 0))} |`,
    `| Failed outright | ${rate(broken.length, all.length)} |`,
    "",
    "**Bug detection rate, false alarm rate and explanation clarity are in",
    "`scoring-sheet.md`** — §9.1 rates them by evaluator, and matching the model's",
    "wording against an expected phrase would measure vocabulary, not understanding.",
  ];

  if (broken.length > 0) {
    lines.push("", "### Did not complete", "");
    for (const c of broken) lines.push(`- \`${c.caseId}\` — ${c.error}`);
  }

  return lines.join("\n");
}
