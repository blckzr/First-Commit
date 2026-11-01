import { describe, expect, it } from "vitest";

/**
 * design.md §13.4: **a React and Vue pair shares a brief and its assertions.**
 *
 * The two halves are alternatives to each other — a learner takes one, decided
 * by a technology choice §5.8 tells them they can change. So one half being
 * quietly harder is a fairness problem the platform cannot detect and a learner
 * cannot report: they have nothing to compare against.
 *
 * The seed writes each pair's cases once and shares the array, which is what
 * makes the guarantee mechanical. This asserts the sharing is still happening,
 * because someone "fixing" one half by inlining its cases would look like a
 * tidy-up and would quietly end it.
 */

interface SeedExercise {
  title: string;
  runtime: string;
  passingScore: number;
  instructions: string;
  testCases: { name: string; visible: boolean; code: string }[];
}

/**
 * `supabase/seed/` is plain JavaScript on purpose — `scripts/seed.mjs` loads it
 * with bare node — so there are no types to import. `SeedExercise` above states
 * the shape this test relies on, and the same pattern is in `check-exercises.ts`.
 */
// @ts-expect-error — untyped .mjs seed module; shape asserted by SeedExercise.
const { exercises } = (await import("../../../../supabase/seed/exercises.mjs")) as {
  exercises: Record<string, SeedExercise>;
};

const all = exercises;

/** The pairs, by the slug they share either side of the technology. */
const PAIRS: [react: string, vue: string][] = [
  ["components-in-react", "components-in-vue"],
  ["state-and-props-react", "state-and-props-vue"],
];

describe.each(PAIRS)("%s and %s", (reactSlug, vueSlug) => {
  const react = all[reactSlug];
  const vue = all[vueSlug];

  it("both exist and run on their own framework", () => {
    expect(react).toBeDefined();
    expect(vue).toBeDefined();
    expect(react.runtime).toBe("react");
    expect(vue.runtime).toBe("vue");
  });

  it("ask for the same thing", () => {
    expect(react.title).toBe(vue.title);
    expect(react.instructions).toBe(vue.instructions);
    expect(react.passingScore).toBe(vue.passingScore);
  });

  /**
   * **Character-identical test code**, not merely equivalent. §13.4's helpers
   * are the same for both frameworks precisely so this can be true, and an
   * assertion that differs by a selector is how one half starts being harder.
   */
  it("are checked by the same assertions", () => {
    expect(react.testCases).toEqual(vue.testCases);
  });

  it("hide the same cases", () => {
    const hidden = (e: SeedExercise) => e.testCases.filter((c) => !c.visible).map((c) => c.name);

    expect(hidden(react)).toEqual(hidden(vue));
    // A pair with no hidden case lets a component that writes the visible
    // answers as literals pass both halves.
    expect(hidden(react).length).toBeGreaterThan(0);
  });
});

/**
 * A technology module without an exercise is a learner reaching the module that
 * matters most on their track and finding nothing to practise on. This fails
 * when a new React module arrives without its Vue twin, or either without an
 * exercise.
 */
describe("every seeded component exercise is paired", () => {
  it("leaves no react or vue exercise without its opposite", () => {
    const paired = new Set(PAIRS.flat());

    const unpaired = Object.entries(all)
      .filter(([slug, e]) => (e.runtime === "react" || e.runtime === "vue") && !paired.has(slug))
      .map(([slug]) => slug);

    expect(unpaired).toEqual([]);
  });
});
