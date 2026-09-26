import { describe, expect, it } from "vitest";
import { groundProjects, groundSkills } from "./index.js";
import { noInventedExperience } from "../prompts/resume.js";

/**
 * §7's grounding rule, on the component where breaking it does real damage.
 *
 * A roadmap that picks a wrong module wastes a week. A hint that leaks a
 * solution spoils one exercise. **A resume goes to an employer** — an invented
 * skill is a claim made on a real person's behalf to someone deciding whether
 * to hire them, and a made-up project is worse.
 *
 * Two mechanisms, and the split is deliberate:
 * - an unsupported **skill** is removed, because the resume without it is still
 *   correct;
 * - a claim of **experience** is rejected and retried, because deleting a word
 *   cannot repair a sentence that is wrong about what the learner is.
 */

const verified = [{ name: "HTML" }, { name: "CSS" }, { name: "JavaScript" }];

describe("groundSkills", () => {
  it("keeps what the evidence supports", () => {
    const { kept, removed } = groundSkills(["JavaScript", "HTML"], verified);
    expect(kept).toEqual(["JavaScript", "HTML"]);
    expect(removed).toEqual([]);
  });

  /** The whole point: the model may order and select, never extend. */
  it("removes a skill nobody earned", () => {
    const { kept, removed } = groundSkills(["JavaScript", "Kubernetes", "HTML"], verified);
    expect(kept).toEqual(["JavaScript", "HTML"]);
    expect(removed).toEqual(["Kubernetes"]);
  });

  it.each([
    ["javascript", "JavaScript"],
    ["JAVASCRIPT", "JavaScript"],
    ["  JavaScript  ", "JavaScript"],
    ["JavaScript.", "JavaScript"],
  ])("accepts %s and prints it as %s", (claim, printed) => {
    expect(groundSkills([claim], verified).kept).toEqual([printed]);
  });

  /**
   * **Not fuzzy.** A near-match that let this through would be the exact failure
   * the filter exists to prevent: React Native is a different thing from React,
   * and "JavaScript frameworks" is not a skill anybody proved.
   */
  it.each(["React Native", "JavaScript frameworks", "Advanced CSS", "HTML5 and CSS3", "Java"])(
    "removes %s, which is not what was proved",
    (claim) => {
      expect(groundSkills([claim], verified).removed).toEqual([claim]);
    },
  );

  it("does not repeat a skill the model listed twice", () => {
    expect(groundSkills(["HTML", "html", "HTML."], verified).kept).toEqual(["HTML"]);
  });

  it("keeps nothing when nothing is verified", () => {
    const { kept, removed } = groundSkills(["HTML", "CSS"], []);
    expect(kept).toEqual([]);
    expect(removed).toEqual(["HTML", "CSS"]);
  });
});

describe("groundProjects", () => {
  const projects = [{ id: "p1" }, { id: "p2" }];

  it("keeps a described project that exists", () => {
    const claimed = [{ projectId: "p1", description: "A task tracker." }];
    expect(groundProjects(claimed, projects).kept).toEqual(claimed);
  });

  /** A hallucinated portfolio entry is the worst output this platform could make. */
  it("removes a project the learner never finished", () => {
    const claimed = [
      { projectId: "p1", description: "Real." },
      { projectId: "invented", description: "An e-commerce platform." },
    ];
    const { kept, removed } = groundProjects(claimed, projects);

    expect(kept).toHaveLength(1);
    expect(removed[0].projectId).toBe("invented");
  });

  /** §7: "No capstone means no Projects section." */
  it("removes everything when no project is finished", () => {
    const claimed = [{ projectId: "p1", description: "Something." }];
    expect(groundProjects(claimed, []).kept).toEqual([]);
  });
});

describe("noInventedExperience", () => {
  const draft = (summary: string, projects: string[] = []) => ({
    summary,
    projects: projects.map((description) => ({ projectId: "p1", description })),
  });

  it("accepts a summary about what was learned", () => {
    expect(
      noInventedExperience(
        draft("Learning front-end development, with verified skills in HTML, CSS and JavaScript."),
        false,
      ),
    ).toBeNull();
  });

  /**
   * §7: "Module completion is a *skill*, never *experience*." These are the
   * sentences that turn a learning record into a fabricated work history.
   */
  it.each([
    "Three years of experience building web applications.",
    "Worked as a front-end developer on several projects.",
    "Professional experience with JavaScript and React.",
    "Delivered features for clients using modern tooling.",
    "Senior front-end engineer with a strong track record.",
    "Shipped to production at a fast-growing startup.",
  ])("rejects %s", (summary) => {
    const problem = noInventedExperience(draft(summary), false);
    expect(problem).toBeTruthy();
    expect(problem).toContain("skill, not experience");
  });

  /** With no capstone there is nothing the learner can be said to have built. */
  it.each(["Built a task tracker.", "Developed a REST API.", "Engineered a data pipeline."])(
    "rejects %s when no project is finished",
    (summary) => {
      expect(noInventedExperience(draft(summary), false)).toContain("finished no");
    },
  );

  /** With a real capstone, "built" is a true statement about a thing that exists. */
  it("accepts the same wording once a project is finished", () => {
    expect(noInventedExperience(draft("Built a task tracker."), true)).toBeNull();
  });

  it("checks the project descriptions too, not only the summary", () => {
    expect(
      noInventedExperience(draft("Learning web development.", ["Worked as a contractor on it."]), true),
    ).toBeTruthy();
  });

  it("returns a message the model can act on", () => {
    const problem = noInventedExperience(draft("Five years of experience."), false)!;
    expect(problem).toMatch(/never about jobs|skill, not experience/);
  });
});
