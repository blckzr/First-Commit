import { config } from "../config.js";
import { createRunner } from "../runner.js";
import { DockerRunner } from "./docker.js";
import { buildHarness } from "./harness.js";
import type { RunRequest } from "./types.js";

/**
 * `npm run sandbox:check` — proves the configured sandbox works before a learner
 * needs it.
 *
 * The same idea as `npm run check` for Ollama: the setup guide says what should
 * be true, this says what *is* true on this machine. It checks whichever runner
 * `CODE_RUNNER` selects, so it keeps working if the sandbox is ever swapped.
 *
 * It ends with a **real run of the seeded exercise's starter code**, which
 * carries §5.11's deliberate bug. The expected outcome is therefore *not* all
 * green — it is **3 of 5**, failing the two cases the bug breaks. Five of five
 * would mean the harness is not running the assertions, which is the failure
 * this script mainly exists to catch.
 */

const ok = (s: string) => `  \x1b[32m✓\x1b[0m ${s}`;
const bad = (s: string) => `  \x1b[31m✗\x1b[0m ${s}`;
const note = (s: string) => `    \x1b[2m${s}\x1b[0m`;

/** The seeded starter, bug and all — see `supabase/seed/exercises.mjs`. */
const STARTER = `function sumEven(numbers) {
  let total = 0;
  for (let i = 1; i < numbers.length; i++) {
    if (numbers[i] % 2 === 0) {
      total += numbers[i];
    }
  }
  return total;
}

module.exports = { sumEven };
`;

const CASES = [
  { id: "c1", name: "Sums [2, 4, 6] to 12", code: "expect(sumEven([2, 4, 6])).toBe(12);", visible: true },
  { id: "c2", name: "Ignores odd numbers", code: "expect(sumEven([1, 2, 3, 4])).toBe(6);", visible: true },
  { id: "c3", name: "Includes the first item", code: "expect(sumEven([2, 1])).toBe(2);", visible: true },
  { id: "c4", name: "Totals an empty array to zero", code: "expect(sumEven([])).toBe(0);", visible: true },
  { id: "c5", name: "Works on a longer list", code: "expect(sumEven([5, 8, 13, 21, 34, 2])).toBe(44);", visible: false },
];

const request: RunRequest = {
  runtime: "javascript",
  files: [{ path: "script.js", content: STARTER }],
  cases: CASES,
};

/** Printed so the generated program can be read — or piped to `node` — freely. */
if (process.argv.includes("source")) {
  console.log(buildHarness(request).source);
  process.exit(0);
}

async function main(): Promise<void> {
  let failures = 0;
  const fail = (message: string, hint?: string) => {
    console.log(bad(message));
    if (hint) console.log(note(hint));
    failures++;
  };

  if (config.codeRunner === "none") {
    console.log(`\nCODE_RUNNER is "none", so no sandbox is configured.\n`);
    console.log(note("Submissions fail with an explanation rather than queueing forever."));
    console.log(note("Set CODE_RUNNER=docker in apps/worker/.env, then run this again.\n"));
    process.exit(1);
  }

  const runner = createRunner();
  console.log(`\nSandbox: ${runner.name}\n`);

  // ---- 1. Does it take the runtimes the platform has? ---------------------
  for (const runtime of ["javascript", "python"]) {
    if (runner.supports(runtime)) console.log(ok(`accepts ${runtime}`));
    else console.log(note(`does not accept ${runtime} — exercises in it will refuse honestly`));
  }
  /**
   * §5.11's React and Vue exercises need Vitest with jsdom. Claiming them would
   * mean sending a component test to a bare runtime and reporting the syntax
   * error as the learner's fault, so refusing is the correct answer here.
   */
  for (const runtime of ["react", "vue"]) {
    if (runner.supports(runtime)) {
      fail(`claims to support ${runtime}, which needs a component test runner`);
    }
  }

  // ---- 2. The whole path, on real content ---------------------------------
  console.log("\n  The seeded exercise, with its starter code:");
  const started = Date.now();
  const result = await runner.run(request);
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  for (const outcome of result.outcomes) {
    const mark = outcome.passed ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";
    const detail =
      outcome.expected !== undefined
        ? ` — expected ${outcome.expected}, got ${outcome.actual}`
        : outcome.actual !== undefined
          ? ` — ${outcome.actual}`
          : "";
    console.log(`    ${mark} ${outcome.name}${detail}`);
  }
  if (result.error) {
    /**
     * A learner sees `result.error`. An operator running this needs the *other*
     * message — "spawn docker ENOENT" explained nothing the first time somebody
     * hit it, and the actual cause was a terminal older than the Docker install.
     */
    const unavailable = runner instanceof DockerRunner ? runner.lastUnavailable : null;
    fail("the run reported an error", unavailable?.operatorHint ?? result.error);
    if (unavailable) console.log(note(`Learners would see: ${unavailable.learnerMessage}`));
  }

  /**
   * **3 of 5, failing cases 1 and 3.** Verified by running the generated
   * program. The starter's loop begins at index 1, so it drops whatever is
   * first: `[2, 4, 6]` totals 10 instead of 12, and `[2, 1]` totals 0 instead
   * of 2. The other three survive the bug, which is a useful reminder that
   * passing tests do not mean correct code.
   */
  const passed = result.outcomes.filter((o) => o.passed).length;
  const rightOnes = [0, 2].every((i) => !result.outcomes[i].passed);

  if (passed === 3 && rightOnes) {
    console.log(ok(`\n  3 of 5 in ${elapsed}s, failing exactly where the starter's bug is`));
    console.log(note(`"Includes the first item" reports expected 2, got 0 — §5.11's own example`));
  } else if (!result.error) {
    fail(
      `\n  expected 3 of 5 failing cases 1 and 3, got ${passed} of 5`,
      passed === 5
        ? "Five of five means the assertions are not running at all."
        : "The harness is not reporting what the assertions actually did.",
    );
  }

  // ---- 3. Does a program that will not stop get stopped? ------------------
  /**
   * The check that found a real bug. Without `--init` the in-container
   * `timeout` is PID 1 and silently does nothing — an infinite loop ran for
   * **631 seconds** before it was killed by hand. A sandbox that cannot stop a
   * runaway loop would hold the worker's only slot indefinitely.
   */
  if (failures === 0) {
    console.log("\n  A program that never finishes:");
    const loopStart = Date.now();
    const loop = await runner.run({
      runtime: "javascript",
      files: [{ path: "script.js", content: "while (true) {}" }],
      cases: [{ id: "c1", name: "anything", code: "expect(1).toBe(1);", visible: true }],
    });
    const loopSeconds = (Date.now() - loopStart) / 1000;

    if (loop.outcomes.every((o) => !o.passed) && loopSeconds < 60) {
      console.log(ok(`stopped after ${loopSeconds.toFixed(1)}s, and passed nothing`));
      if (loop.error) console.log(note(loop.error));
    } else {
      fail(
        `a loop that never ends ran for ${loopSeconds.toFixed(1)}s`,
        "Check that `--init` is in the docker arguments — without it the in-container timeout does nothing.",
      );
    }
  }

  console.log(
    failures === 0
      ? `\n\x1b[32mReady.\x1b[0m CODE_RUNNER=${config.codeRunner} works. Restart the worker to pick it up.\n`
      : `\n${failures} problem(s). Leave CODE_RUNNER=none until they are fixed — ` +
          `a half-working sandbox is worse than an honest refusal.\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(`\n${(err as Error).message}\n`);
  process.exit(1);
});
