import { createRunner } from "../runner.js";
import type { RunRequest } from "./types.js";

/**
 * `npm run exercises:check` — runs every seeded exercise through the real
 * sandbox, twice.
 *
 * The seed loader validates an exercise's **shape**: starter files present, at
 * least one hidden case, a reference solution. It cannot tell you whether the
 * reference solution actually passes, and an exercise nobody can pass is worse
 * than no exercise — a learner would grind at correct code while the tests said
 * no.
 *
 * So for each exercise:
 *
 * 1. **The reference solution must pass every case.** If it does not, either the
 *    solution or a test is wrong, and the exercise is unpassable.
 * 2. **The starter must fail at least one visible case.** A starter that already
 *    passes is not an exercise, and §5.11's screen would open on all green with
 *    nothing to do. It has to fail *visibly*, because a learner who can only see
 *    a hidden failure has nothing to work from.
 *
 * This is the same relationship `npm run check` has with Ollama and
 * `npm run sandbox:check` has with the sandbox: the content claims something, and
 * this measures it rather than trusting it.
 */

const ok = (s: string) => `  \x1b[32m✓\x1b[0m ${s}`;
const bad = (s: string) => `  \x1b[31m✗\x1b[0m ${s}`;
const note = (s: string) => `    \x1b[2m${s}\x1b[0m`;

interface SeedCase {
  name: string;
  visible: boolean;
  code: string;
}

interface SeedExercise {
  title: string;
  runtime: string;
  instructions: string;
  starterFiles: { path: string; content: string }[];
  testCases: SeedCase[];
  referenceSolution: { path: string; content: string }[];
}

const request = (
  exercise: SeedExercise,
  files: { path: string; content: string }[],
): RunRequest => ({
  runtime: exercise.runtime,
  files,
  cases: exercise.testCases.map((c, i) => ({
    id: `c${i}`,
    name: c.name,
    code: c.code,
    visible: c.visible,
  })),
});

async function main(): Promise<void> {
  /**
   * Read at run time so this script has no build-time dependency on the seed.
   *
   * `supabase/seed/` is plain JavaScript on purpose — `scripts/seed.mjs` loads it
   * with bare node — so there are no types to import. `SeedExercise` above states
   * the shape this script relies on, and `npm run db:seed` validates the content
   * itself before writing any of it.
   */
  // @ts-expect-error — untyped .mjs seed module; shape asserted by SeedExercise.
  const { exercises } = (await import("../../../../supabase/seed/exercises.mjs")) as {
    exercises: Record<string, SeedExercise>;
  };

  const runner = createRunner();
  console.log(`\nSandbox: ${runner.name}\n`);

  let failures = 0;
  const fail = (message: string, hint?: string) => {
    console.log(bad(message));
    if (hint) console.log(note(hint));
    failures++;
  };

  for (const [slug, exercise] of Object.entries(exercises)) {
    console.log(`${slug} — "${exercise.title}" (${exercise.runtime})`);

    if (!runner.supports(exercise.runtime)) {
      fail(
        `the sandbox does not run ${exercise.runtime}`,
        "Learners would see an honest error rather than results.",
      );
      continue;
    }

    // ---- 1. The reference solution has to pass everything ------------------
    const reference = await runner.run(request(exercise, exercise.referenceSolution));
    const refFailed = reference.outcomes.filter((o) => !o.passed);

    if (reference.error) {
      fail("the reference solution did not run", reference.error);
    } else if (refFailed.length > 0) {
      fail(
        `the reference solution fails ${refFailed.length} of ${reference.outcomes.length} cases`,
        refFailed
          .map(
            (o) =>
              `${o.name}${o.expected !== undefined ? ` — expected ${o.expected}, got ${o.actual}` : ""}`,
          )
          .join("\n    "),
      );
    } else {
      console.log(ok(`reference solution passes all ${reference.outcomes.length} cases`));
    }

    // ---- 2. The starter has to fail something a learner can see ------------
    const starter = await runner.run(request(exercise, exercise.starterFiles));
    const visibleFailures = starter.outcomes.filter((o) => !o.passed && !o.hidden);
    const hiddenFailures = starter.outcomes.filter((o) => !o.passed && o.hidden);

    if (starter.error) {
      /**
       * Not necessarily wrong — a starter that does not parse is a legitimate
       * exercise — but worth naming, because §5.11's screen then shows an error
       * instead of a list of ticks and there is less for a learner to read.
       */
      console.log(ok("the starter does not run, so every case fails"));
      console.log(note(starter.error));
    } else if (visibleFailures.length === 0 && hiddenFailures.length === 0) {
      fail(
        "the starter already passes every case",
        "There is nothing for a learner to do. Introduce the mistake the module teaches.",
      );
    } else if (visibleFailures.length === 0) {
      fail(
        `the starter only fails hidden cases (${hiddenFailures.length})`,
        "A learner would see all green and a failed submission with nothing to work from.",
      );
    } else {
      console.log(
        ok(
          `starter fails ${visibleFailures.length} visible case${visibleFailures.length === 1 ? "" : "s"}: ` +
            visibleFailures.map((o) => `"${o.name}"`).join(", "),
        ),
      );
      for (const o of visibleFailures) {
        if (o.expected !== undefined) {
          console.log(note(`${o.name}: expected ${o.expected}, got ${o.actual}`));
        }
      }
    }

    console.log("");
  }

  const count = Object.keys(exercises).length;
  console.log(
    failures === 0
      ? `\x1b[32m${count} exercise${count === 1 ? "" : "s"} check out.\x1b[0m Every reference solution passes, and every starter fails something visible.\n`
      : `${failures} problem(s) across ${count} exercise(s).\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(`\n${(err as Error).message}\n`);
  process.exit(1);
});
