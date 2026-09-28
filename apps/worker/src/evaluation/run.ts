import { execFileSync } from "node:child_process";
import { relative } from "node:path";
import { config } from "../config.js";
import { seededDb } from "./db.js";
import { Recorder } from "./report.js";
import { evaluateCodeFeedback, summariseCodeFeedback } from "./code-feedback.js";
import { evaluateRoadmap, summariseRoadmap } from "./roadmap.js";
import { evaluateResume, summariseResume } from "./resume.js";
import { scoringSheet } from "./sheet.js";

/**
 * `npm run evaluate` — the §9 evaluation harness.
 *
 * ```
 * npm run evaluate                      the configured model
 * npm run evaluate -- code roadmap      only those components
 * ```
 *
 * The model is **not** a flag here. `OLLAMA_MAX_LOADED_MODELS=1` and 8GB of
 * VRAM mean one model at a time, so comparing 4B with 9B (`model-setup-guide.md`
 * §13) is two runs with `AI_MODEL` changed between them, not one run that
 * swaps models halfway and reports both from a card that was thrashing.
 *
 * Every case is written to disk as it finishes. A full run is 40-odd model
 * calls and takes tens of minutes; losing it to a crash at the end would be
 * losing the measurement.
 *
 * ### What this does not measure
 *
 * - **`milestone_review`** — a stub. There is no handler to evaluate.
 * - **React and Vue submissions**, which §9.1 names. Neither sandbox runs a
 *   component test, so there would be no test results to explain — and §7 says
 *   the results come first.
 * - **Capstone milestone diffs**, for the same reason as `milestone_review`.
 * - **A completed project** on a resume, since Phase 4 is not built.
 *
 * They are printed as not-measured rather than left out, so the gaps are part
 * of the result.
 */

const NOT_MEASURED = [
  "**Code Review AI: capstone milestones** — `milestone_review` is a stub.",
  "**React and Vue submissions** — neither sandbox runs a component test, so there are no results to explain.",
  "**Roadmap adaptation** — reinforcement and challenge modules are not built.",
  "**Resume at the completed-project level** — Phase 4 is not built, so no learner can have one.",
];

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const wanted = (name: string) => args.length === 0 || args.includes(name);

  const recorder = new Recorder(config.model, config.jsonMode);
  console.log(`\nEvaluating ${config.model} (${config.jsonMode})`);
  console.log(`Writing to ${relative(process.cwd(), recorder.dir)}`);

  const db = await seededDb();

  if (wanted("code")) await evaluateCodeFeedback(recorder);
  if (wanted("roadmap")) await evaluateRoadmap(db.pool, recorder);
  if (wanted("resume")) await evaluateResume(db.pool, recorder);

  recorder.gpu(placement());

  const summary = [
    `# Evaluation — ${config.model}`,
    "",
    `Run ${new Date().toISOString()} · JSON mode \`${config.jsonMode}\` · one job at a time on one 8GB card.`,
    "",
    "Counted metrics only. Everything §9.1 marks evaluator-rated is in",
    "`scoring-sheet.md`, filled in by hand.",
    "",
    "## Where the model ran",
    "",
    "```",
    placement().trim() || "ollama ps returned nothing",
    "```",
    "",
    "`model-setup-guide.md` §13 chooses between 4B and 9B partly on whether the",
    "larger one stays on the GPU. `100% GPU` above means it did.",
    "",
    ...(wanted("code") ? [summariseCodeFeedback(recorder), ""] : []),
    ...(wanted("roadmap") ? [summariseRoadmap(recorder), ""] : []),
    ...(wanted("resume") ? [summariseResume(recorder), ""] : []),
    "## Not measured",
    "",
    ...NOT_MEASURED.map((n) => `- ${n}`),
  ].join("\n");

  const summaryPath = recorder.write("summary.md", summary);
  const sheetPath = recorder.write("scoring-sheet.md", scoringSheet(recorder));

  console.log(`\n  Summary       ${relative(process.cwd(), summaryPath)}`);
  console.log(`  Scoring sheet ${relative(process.cwd(), sheetPath)}`);
  console.log(`\nDone. Fill in the scoring sheet, then run the other model size.\n`);
}

/** What Ollama reports about the loaded model — GPU or CPU, and how much of each. */
function placement(): string {
  try {
    return execFileSync("ollama", ["ps"], { encoding: "utf8" });
  } catch {
    return "";
  }
}

main().catch((err) => {
  console.error(`\n  ✗ ${(err as Error).message}\n`);
  process.exitCode = 1;
});
