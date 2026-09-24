import type { Roadmap, RoadmapModuleNode } from "../features/roadmap/types";

/**
 * The roadmap the tests and the Playwright stubs serve.
 *
 * It is the roadmap design.md §2.1 draws — Junior Web Developer, Frontend,
 * 6 of 16 passed — filled out far enough to exercise **every** branch the
 * components have to handle: all six statuses, all five module kinds, an
 * unmade decision, and three milestones. A real one from the API rarely has all
 * six statuses at once, so this stays as the thorough case.
 *
 * It is typed as `Roadmap`, so a change to §13.3's types breaks it here rather
 * than at the first render.
 */

const DATA_ANALYST = "aa000000-0000-0000-0000-00000000000d";

function module(node: Omit<RoadmapModuleNode, "sharedWithPaths" | "hasUpdate"> &
  Partial<Pick<RoadmapModuleNode, "sharedWithPaths" | "hasUpdate">>): RoadmapModuleNode {
  return { sharedWithPaths: [], hasUpdate: false, ...node };
}

export const mockRoadmap: Roadmap = {
  id: "10000000-0000-0000-0000-000000000001",
  careerPathId: "20000000-0000-0000-0000-000000000001",
  careerPathTitle: "Junior Web Developer",
  trackId: "t1",
  trackTitle: "Frontend",
  pathColor: "path-1",
  passedCount: 6,
  testedOutCount: 1,
  aiRationale:
    "You passed the HTML placement questions, so those modules are tested out. Since you want a company job, I recommend the Frontend track.",
  weeklyHours: 6,
  estimatedWeeks: 14,
  totalCount: 16,
  steps: [
    {
      type: "skill",
      id: "skill-html",
      skillId: "s-html",
      title: "HTML",
      layer: "core",
      modules: [
        module({
          id: "m-html-basics", moduleId: "mod-1", versionNo: 3, title: "HTML basics",
          kind: "core", status: "passed", score: 92, requires: [], estimatedHours: 4,
        }),
        module({
          id: "m-forms", moduleId: "mod-2", versionNo: 2, title: "Forms and semantics",
          kind: "core", status: "passed", score: 88, requires: ["mod-1"], estimatedHours: 5,
        }),
      ],
    },
    {
      type: "skill",
      id: "skill-css",
      skillId: "s-css",
      title: "CSS",
      layer: "core",
      modules: [
        module({
          id: "m-css-basics", moduleId: "mod-3", versionNo: 4, title: "CSS basics",
          kind: "core", status: "tested_out", requires: ["mod-1"], estimatedHours: 6,
        }),
        module({
          id: "m-css-layout", moduleId: "mod-4", versionNo: 2, title: "Layout with flex and grid",
          kind: "core", status: "passed", score: 81, requires: ["mod-3"], estimatedHours: 7,
          // §5.9: a newer version exists, and the learner keeps the one they took.
          hasUpdate: true,
        }),
        module({
          id: "m-css-challenge", moduleId: "mod-5", versionNo: 1,
          title: "Challenge: rebuild a layout from a screenshot",
          kind: "challenge", status: "available", requires: ["mod-4"], estimatedHours: 3,
          addedReason: "Offered after you scored 95 on the CSS basics quiz.",
        }),
      ],
    },
    {
      type: "skill",
      id: "skill-js",
      skillId: "s-js",
      title: "JavaScript",
      layer: "core",
      modules: [
        module({
          id: "m-js-basics", moduleId: "mod-6", versionNo: 5, title: "JavaScript basics",
          kind: "core", status: "passed", score: 90, requires: [], estimatedHours: 8,
        }),
        module({
          id: "m-functions", moduleId: "mod-7", versionNo: 3, title: "Functions",
          kind: "core", status: "passed", score: 76, requires: ["mod-6"], estimatedHours: 5,
        }),
        module({
          id: "m-arrays", moduleId: "mod-8", versionNo: 2, title: "Arrays and objects",
          kind: "core", status: "current", requires: ["mod-7"], estimatedHours: 5,
        }),
        module({
          id: "m-loops", moduleId: "mod-9", versionNo: 1, title: "Practice: loops",
          kind: "reinforcement", status: "available", requires: ["mod-7"], estimatedHours: 2,
          addedReason: "Added after two attempts on the arrays quiz.",
        }),
        module({
          id: "m-dom", moduleId: "mod-10", versionNo: 2, title: "DOM manipulation",
          kind: "core", status: "locked", requires: ["mod-8"], estimatedHours: 6,
        }),
      ],
    },
    {
      type: "skill",
      id: "skill-git",
      skillId: "s-git",
      title: "Git",
      layer: "core",
      modules: [
        module({
          id: "m-git-basics", moduleId: "mod-11", versionNo: 2, title: "Git basics",
          kind: "core", status: "available", requires: [], estimatedHours: 4,
          // §6 rule 7: progress belongs to the learner. Passing this counts on
          // every roadmap that includes it.
          sharedWithPaths: [DATA_ANALYST],
        }),
        module({
          id: "m-git-branching", moduleId: "mod-12", versionNo: 1, title: "Branching and merging",
          kind: "core", status: "locked", requires: ["mod-11"], estimatedHours: 4,
        }),
      ],
    },
    {
      type: "decision",
      id: "decision-framework",
      title: "Choose your framework",
      options: [
        { id: "opt-react", name: "React", requires: [] },
        { id: "opt-vue", name: "Vue", requires: [] },
      ],
      recommendedOptionId: "opt-react",
    },
    {
      type: "skill",
      id: "skill-components",
      skillId: "s-components",
      title: "Components",
      layer: "concept",
      modules: [
        module({
          id: "m-what-components", moduleId: "mod-13", versionNo: 1,
          title: "What are components", kind: "concept", status: "locked",
          requires: ["mod-10"], estimatedHours: 3,
        }),
        module({
          id: "m-components-in", moduleId: "mod-14", versionNo: 1,
          title: "Components in your framework", kind: "technology", status: "locked",
          requires: ["mod-13"], estimatedHours: 6,
        }),
        module({
          id: "m-state-props", moduleId: "mod-15", versionNo: 1, title: "State and props",
          kind: "technology", status: "locked", requires: ["mod-14"], estimatedHours: 6,
        }),
        module({
          id: "m-archived", moduleId: "mod-16", versionNo: 1, title: "Class components",
          kind: "technology", status: "archived", requires: ["mod-14"], estimatedHours: 4,
        }),
      ],
    },
    {
      type: "certificate",
      id: "milestone-certificate",
      title: "Certificate of Completion",
      status: "locked",
    },
    {
      type: "capstone",
      id: "milestone-capstone",
      title: "Capstone project",
      status: "locked",
      completedMilestones: 0,
      totalMilestones: 5,
    },
    {
      type: "project_certificate",
      id: "milestone-project-certificate",
      title: "Project Certificate",
      status: "locked",
    },
  ],
};
