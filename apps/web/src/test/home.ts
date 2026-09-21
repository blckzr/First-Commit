import type { HomeSummary } from "../api/home";

/** Typed against the API schema, so a change to either breaks here first. */
export const mockHome: HomeSummary = {
  roadmap: {
    id: "10000000-0000-0000-0000-000000000001",
    careerPathTitle: "Junior Web Developer",
    trackTitle: "Frontend",
    passedCount: 6,
    totalCount: 16,
  },
  continue: {
    kind: "module",
    moduleId: "mod-arrays",
    moduleTitle: "Arrays and objects",
    skillTitle: "JavaScript",
    estimatedHours: 5,
    lessonNumber: 2,
    lessonCount: 4,
    lessonId: "lesson-2",
    started: true,
  },
  updates: [
    {
      id: "added-mod-loops",
      kind: "ai_added",
      text: "Practice: loops was added to your roadmap for extra practice. Added after two attempts on the arrays quiz.",
      moduleId: "mod-loops",
      fromAi: true,
    },
  ],
};

/** A learner who has finished onboarding but has no roadmap yet (§5.6's empty state). */
export const emptyHome: HomeSummary = { roadmap: null, continue: null, updates: [] };
