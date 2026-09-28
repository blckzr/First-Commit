import { describe, expect, it } from "vitest";
import { noSolutionLeak } from "../schemas.js";
import { validateRoadmapPlan } from "../roadmap/validate.js";
import { hintGivesCode, isLeak } from "./code-feedback.js";
import { classify } from "./roadmap.js";

/**
 * The evaluation counts by reading rejection messages that other modules write.
 *
 * **That coupling fails silently.** If `noSolutionLeak` or `validate.ts` rewords
 * a message, nothing breaks, no test goes red, and the affected metric simply
 * reports 0% — which reads as a perfect score rather than as a broken counter.
 * A run is 40 model calls and tens of minutes, so the wrong number would likely
 * be believed.
 *
 * These tests close that by feeding the **real** validators bad input and
 * asserting the classifiers recognise what actually comes back. Nothing here
 * hard-codes an expected sentence; the sentence is whatever the validator
 * produces today.
 */

describe("solution leakage is counted from the guard's own message", () => {
  it("recognises what noSolutionLeak returns", () => {
    const reason = noSolutionLeak({
      summary: "Nearly there.",
      issues: [
        {
          line: 3,
          problem: "The loop skips the first item.",
          hint: "Try this:\n```js\nfor (let i = 0; i < numbers.length; i++) {\n```",
        },
      ],
      rubric: [],
      encouragement: "Good structure.",
    });

    expect(reason, "the guard did not reject a hint full of code").not.toBeNull();
    expect(isLeak(reason!)).toBe(true);
  });

  it("does not count a schema rejection as a leak", () => {
    expect(isLeak("issues: Array must contain at most 3 element(s)")).toBe(false);
    expect(isLeak("summary: Required")).toBe(false);
  });
});

describe("roadmap rejections are sorted by the validator's own wording", () => {
  /**
   * A catalogue small enough to reason about, shaped like the real one: one
   * track, two core modules where the second requires the first.
   */
  const catalogue = {
    careerPathId: "p1",
    careerPathTitle: "Test path",
    tracks: [{ id: "t1", title: "Frontend", description: "", audience: "", decisions: [] }],
    modules: [
      mod("m1", "Basics", []),
      mod("m2", "Next steps", ["m1"]),
    ],
    learner: {
      userId: "u1",
      experienceLevel: "none",
      goal: "company_job",
      weeklyHours: 10,
      placement: {},
      completedModuleIds: [],
    },
  };

  function mod(id: string, title: string, requires: string[]) {
    return {
      id,
      slug: id,
      title,
      description: "",
      kind: "core" as const,
      technologyId: null,
      technologyName: null,
      skillId: "s1",
      skillName: "Skill",
      layer: "core",
      trackId: null,
      estimatedHours: 2,
      requiredForCertificate: true,
      sortOrder: 1,
      requires,
    };
  }

  const eligible = catalogue.modules;
  const reject = (plan: { recommendedTrackId: string; orderedModuleIds: string[] }) =>
    validateRoadmapPlan(
      { ...plan, skipModuleIds: [], explanation: "because" } as never,
      { catalogue: catalogue as never, eligible: eligible as never },
    );

  it("bins a module id that does not exist", () => {
    const reason = reject({ recommendedTrackId: "t1", orderedModuleIds: ["m1", "nope", "m2"] });
    expect(reason).not.toBeNull();
    expect(classify([reason!]).unknownModuleId).toBe(1);
  });

  it("bins a module placed before what it requires", () => {
    const reason = reject({ recommendedTrackId: "t1", orderedModuleIds: ["m2", "m1"] });
    expect(reason).not.toBeNull();
    expect(classify([reason!]).prerequisiteViolations).toBe(1);
  });

  it("bins a missing core module", () => {
    const reason = reject({ recommendedTrackId: "t1", orderedModuleIds: ["m1"] });
    expect(reason).not.toBeNull();
    expect(classify([reason!]).missingCoreCoverage).toBe(1);
  });

  /**
   * The bin that exists so a reworded validator message is visible instead of
   * silently dropped — the failure this whole file guards against.
   */
  it("counts an unrecognised reason rather than discarding it", () => {
    const counts = classify(["Something the validator started saying last week"]);
    expect(counts.otherRejections).toBe(1);
    expect(
      Object.values(counts).reduce((a, b) => a + b, 0),
      "a reason was counted twice or not at all",
    ).toBe(1);
  });
});

describe("hints that hand over the fix", () => {
  /**
   * **These came out of a real run and were all accepted.** `noSolutionLeak`
   * needs a fenced block or more than one line of code punctuation, so a
   * one-line fix reaches the learner. §9.1 asks for the model's leakage rate,
   * which is why this is counted separately from what the guard rejected.
   */
  it.each([
    "Change the comparison operator from `>` to `>=` on line 5.",
    "Think about what happens if you change `count += word.length` to `count++`.",
    'Try running your code again after changing line 3 to `sentence.split(" ")`.',
    "Try changing this to split by a space: `sentence.split(\" \")`",
  ])("rejects %s", (hint) => {
    expect(hintGivesCode(hint)).toBe(true);
    // Every one of these was **accepted and shown to a learner** before the
    // guard was tightened; each asserts it would not be now.
    expect(noSolutionLeak(feedbackWith(hint))).not.toBeNull();
  });

  /**
   * **The cost of tightening, kept visible.** Naming a thing points at the
   * problem, which is what §7 asks a hint to do, and these must keep passing —
   * a guard that rejected them would push the model toward vaguer feedback,
   * which is the opposite of the goal.
   */
  it.each([
    "Look at the `minLength` variable. Is every word being measured against it?",
    "What separates the words in your example sentence?",
    "Think about which item the loop starts from, and whether anything comes before it.",
    "Recall how you handled the default greeting. Could the name work the same way?",
  ])("still allows %s", (hint) => {
    expect(hintGivesCode(hint)).toBe(false);
    expect(noSolutionLeak(feedbackWith(hint))).toBeNull();
  });

  function feedbackWith(hint: string) {
    return {
      summary: "Close.",
      issues: [{ line: 1, problem: "Something is off.", hint }],
      rubric: [],
      encouragement: "Keep going.",
    };
  }
});
