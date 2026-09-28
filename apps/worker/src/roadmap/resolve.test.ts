import { describe, expect, it } from "vitest";
import { resolvePlan } from "./resolve.js";
import type { Catalogue } from "./catalogue.js";

/**
 * Resolving the model's answer.
 *
 * The reason this layer exists is in `resolve.ts`: across three evaluation runs
 * **every** rejected roadmap attempt was a miscopied UUID. What matters here is
 * that a wrong name still fails — swapping ids for slugs must not become a way
 * for an invented module to slip through — and that a near miss says what it
 * nearly was, because that is the failure slugs make likely and the retry needs
 * to be told.
 */

function module(slug: string, title: string) {
  return {
    id: `id-${slug}`,
    slug,
    title,
    description: "",
    kind: "core" as const,
    technologyId: null,
    technologyName: null,
    skillId: "s1",
    skillName: "Skill",
    layer: "core" as const,
    trackId: null,
    estimatedHours: 2,
    requiredForCertificate: true,
    sortOrder: 1,
    requires: [],
  };
}

const catalogue = {
  careerPathId: "p1",
  careerPathTitle: "Junior Web Developer",
  tracks: [
    { id: "track-frontend", title: "Frontend", description: "", audience: "", decisions: [] },
    { id: "track-backend", title: "Backend", description: "", audience: "", decisions: [] },
  ],
  modules: [module("js-basics", "JavaScript basics"), module("css-layout", "CSS layout")],
  learner: {
    userId: "u1",
    experienceLevel: "none",
    goal: "company_job",
    weeklyHours: 10,
    placement: {},
    completedModuleIds: [],
  },
} as unknown as Catalogue;

const draft = (over: Partial<Record<string, unknown>> = {}) => ({
  recommendedTrack: "Frontend",
  orderedModuleSlugs: ["js-basics", "css-layout"],
  skipModuleSlugs: [],
  explanation: "because",
  ...over,
});

describe("resolving slugs to ids", () => {
  it("turns slugs and a track title into the ids the platform stores", () => {
    const result = resolvePlan(draft(), catalogue);
    expect("plan" in result).toBe(true);
    if (!("plan" in result)) return;

    expect(result.plan.recommendedTrackId).toBe("track-frontend");
    expect(result.plan.orderedModuleIds).toEqual(["id-js-basics", "id-css-layout"]);
    expect(result.plan.explanation).toBe("because");
  });

  it("keeps the order the model chose", () => {
    const result = resolvePlan(draft({ orderedModuleSlugs: ["css-layout", "js-basics"] }), catalogue);
    if (!("plan" in result)) throw new Error("expected a plan");
    expect(result.plan.orderedModuleIds).toEqual(["id-css-layout", "id-js-basics"]);
  });

  it("resolves the skip list too", () => {
    const result = resolvePlan(draft({ skipModuleSlugs: ["js-basics"] }), catalogue);
    if (!("plan" in result)) throw new Error("expected a plan");
    expect(result.plan.skipModuleIds).toEqual(["id-js-basics"]);
  });

  /** The model's casing and stray spaces are not worth a retry. */
  it("is forgiving about case and surrounding space", () => {
    const result = resolvePlan(
      draft({ recommendedTrack: " frontend ", orderedModuleSlugs: [" JS-Basics ", "css-layout"] }),
      catalogue,
    );
    if (!("plan" in result)) throw new Error("expected a plan");
    expect(result.plan.recommendedTrackId).toBe("track-frontend");
    expect(result.plan.orderedModuleIds[0]).toBe("id-js-basics");
  });
});

describe("a name that resolves to nothing", () => {
  /**
   * The check that matters. Slugs are easier for the model to get right, which
   * is the point — but they must not be easier to *fake*. An invented module
   * has to fail here exactly as an invented UUID did.
   */
  it("refuses a module that does not exist", () => {
    const result = resolvePlan(draft({ orderedModuleSlugs: ["js-basics", "react-hooks"] }), catalogue);
    expect("error" in result).toBe(true);
    if (!("error" in result)) return;
    expect(result.error).toContain("react-hooks");
    expect(result.error).toContain("not a module slug");
  });

  it("refuses an invented track", () => {
    const result = resolvePlan(draft({ recommendedTrack: "Full Stack" }), catalogue);
    if (!("error" in result)) throw new Error("expected an error");
    expect(result.error).toContain("Full Stack");
    // The retry needs to know what it may choose from.
    expect(result.error).toContain("Frontend");
    expect(result.error).toContain("Backend");
  });

  it("refuses an invented slug in the skip list, not only the ordered one", () => {
    const result = resolvePlan(draft({ skipModuleSlugs: ["nope"] }), catalogue);
    expect("error" in result).toBe(true);
  });

  /**
   * **What slugs buy over UUIDs.** A wrong hex digit tells a retry nothing; a
   * near-miss slug tells it exactly what it nearly typed.
   */
  it("names the closest real slug on a near miss", () => {
    const result = resolvePlan(draft({ orderedModuleSlugs: ["js-basic"] }), catalogue);
    if (!("error" in result)) throw new Error("expected an error");
    expect(result.error).toContain('Did you mean "js-basics"');
  });

  /** A guess that is merely least-bad would send the retry somewhere wrong. */
  it("suggests nothing when nothing is close", () => {
    const result = resolvePlan(draft({ orderedModuleSlugs: ["kubernetes"] }), catalogue);
    if (!("error" in result)) throw new Error("expected an error");
    expect(result.error).not.toContain("Did you mean");
  });

  /** The mangled ids from the real runs, which is what this change is for. */
  it.each([
    "48b67ec1-9336-4067-933b-16ac7f50-a97e-4544-ab19-fbed91c4c966",
    "c056c754-a1ef-44d6-994a-170dc83b1696",
  ])("still refuses %s", (bad) => {
    const result = resolvePlan(draft({ orderedModuleSlugs: [bad] }), catalogue);
    expect("error" in result).toBe(true);
  });
});
