import type { DecisionPage } from "../api/decisions";

/** Typed against the API schema, so a change to either breaks here first. */
export const mockDecision: DecisionPage = {
  id: "d1",
  roadmapId: "r1",
  title: "Choose your framework",
  trackTitle: "Frontend",
  careerPathTitle: "Junior Web Developer",
  chosenTechnologyId: null,
  recommendation: null,
  options: [
    {
      technologyId: "tech-react",
      name: "React",
      description: "Build UIs from JavaScript components.",
      comparison: {
        learningCurve: "Moderate. More to learn before your first working screen.",
        jobDemand: "High — the majority of frontend postings name it.",
      },
      moduleCount: 2,
      passedCount: 0,
    },
    {
      technologyId: "tech-vue",
      name: "Vue",
      description: "Build UIs with templates close to HTML.",
      comparison: { learningCurve: "Gentler. You can build something real sooner." },
      moduleCount: 2,
      passedCount: 0,
    },
  ],
};

/** A learner who chose React and has passed some of it — §5.8's switch case. */
export const chosenDecision: DecisionPage = {
  ...mockDecision,
  chosenTechnologyId: "tech-react",
  options: [
    { ...mockDecision.options[0], passedCount: 3 },
    mockDecision.options[1],
  ],
};

export const recommendedDecision: DecisionPage = {
  ...mockDecision,
  recommendation: {
    technologyId: "tech-react",
    reason: "React is a good fit: it appears in more junior job postings, and you want a company job.",
  },
};
