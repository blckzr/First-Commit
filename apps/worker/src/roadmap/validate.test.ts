import { describe, expect, it } from "vitest";
import { eligibleModules, type Catalogue, type CatalogueModule } from "./catalogue.js";
import { estimateWeeks, validateRoadmapPlan } from "./validate.js";
import type { RoadmapPlan } from "../schemas.js";

/**
 * The model is the part that cannot be tested deterministically, so the part
 * that decides whether to trust it must be.
 *
 * Every rule AGENT.md §7 names has a test that builds a plan breaking it —
 * "validated against real module IDs, prerequisite order, and full core
 * coverage before anything is saved."
 */

const FRONTEND = "track-frontend";
const BACKEND = "track-backend";

function module(over: Partial<CatalogueModule> & { id: string; title: string }): CatalogueModule {
  return {
    slug: over.id,
    description: "",
    kind: "core",
    technologyId: null,
    technologyName: null,
    skillId: "skill",
    skillName: "Skill",
    layer: "core",
    trackId: null,
    estimatedHours: 4,
    requiredForCertificate: true,
    sortOrder: 0,
    requires: [],
    ...over,
  };
}

/** A small path: two core modules, one concept module per track, one technology module. */
function catalogue(over: Partial<Catalogue> = {}): Catalogue {
  return {
    careerPathId: "path",
    careerPathTitle: "Junior Web Developer",
    tracks: [
      { id: FRONTEND, title: "Frontend", description: "", audience: "", decisions: [] },
      { id: BACKEND, title: "Backend", description: "", audience: "", decisions: [] },
    ],
    modules: [
      module({ id: "html", title: "HTML basics", sortOrder: 0 }),
      module({ id: "css", title: "CSS basics", sortOrder: 1, requires: ["html"] }),
      module({
        id: "components", title: "What are components", layer: "concept",
        trackId: FRONTEND, kind: "concept", sortOrder: 0, requires: ["css"],
      }),
      module({
        id: "http", title: "How the web talks", layer: "concept",
        trackId: BACKEND, kind: "concept", sortOrder: 0, requires: ["html"],
      }),
      module({
        id: "react-components", title: "Components in React", layer: "concept",
        trackId: FRONTEND, kind: "technology", technologyId: "react",
        sortOrder: 1, requires: ["components"],
      }),
      module({ id: "extra", title: "Optional extra", requiredForCertificate: false, sortOrder: 2 }),
    ],
    learner: {
      userId: "learner",
      experienceLevel: "none",
      goal: "company_job",
      weeklyHours: 6,
      placement: {},
      completedModuleIds: [],
    },
    ...over,
  };
}

const EXPLANATION =
  "I put you on the Frontend track because you want a job at a company and you see results fastest there. You will choose React or Vue after the core skills.";

function plan(over: Partial<RoadmapPlan> = {}): RoadmapPlan {
  return {
    recommendedTrackId: FRONTEND,
    skipModuleIds: [],
    orderedModuleIds: ["html", "css", "extra", "components"],
    explanation: EXPLANATION,
    ...over,
  };
}

const check = (p: RoadmapPlan, c: Catalogue = catalogue()) =>
  validateRoadmapPlan(p, { catalogue: c, eligible: eligibleModules(c, p.recommendedTrackId) });

describe("a valid plan", () => {
  it("is accepted", () => {
    expect(check(plan())).toBeNull();
  });

  it("accepts the other track with its own modules", () => {
    expect(
      check(plan({ recommendedTrackId: BACKEND, orderedModuleIds: ["html", "css", "extra", "http"] })),
    ).toBeNull();
  });
});

describe("real module ids", () => {
  it("rejects a module that does not exist", () => {
    const error = check(plan({ orderedModuleIds: ["html", "css", "extra", "components", "invented"] }));
    expect(error).toMatch(/"invented" does not exist/);
  });

  it("rejects a track that does not exist", () => {
    const error = check(plan({ recommendedTrackId: "track-nope" }));
    expect(error).toMatch(/not one of the available tracks/);
    // The message has to tell the model what it may choose, since it is fed back.
    expect(error).toMatch(/Frontend/);
    expect(error).toMatch(/Backend/);
  });

  /** design.md §2.1: nodes after the decision stay locked until the learner chooses. */
  it("rejects a technology module", () => {
    const error = check(plan({ orderedModuleIds: ["html", "css", "extra", "components", "react-components"] }));
    expect(error).toMatch(/technology module/i);
  });

  it("rejects a module from the other track", () => {
    const error = check(plan({ orderedModuleIds: ["html", "css", "extra", "components", "http"] }));
    expect(error).toMatch(/different track/i);
  });

  it("rejects the same module twice", () => {
    const error = check(plan({ orderedModuleIds: ["html", "css", "extra", "components", "css"] }));
    expect(error).toMatch(/appears twice/i);
  });
});

describe("full core coverage", () => {
  it("rejects a plan missing a core module", () => {
    const error = check(plan({ orderedModuleIds: ["html", "extra", "components"] }));
    expect(error).toMatch(/Core module "CSS basics" is missing/);
  });

  it("rejects a plan missing one of the track's own modules", () => {
    const error = check(plan({ orderedModuleIds: ["html", "css", "extra"] }));
    expect(error).toMatch(/"What are components".*missing/i);
  });

  /** §6 rule 7: passing it once counts everywhere, so it need not be planned again. */
  it("allows a module the learner already passed to be left out", () => {
    const c = catalogue();
    c.learner.completedModuleIds = ["css"];
    expect(check(plan({ orderedModuleIds: ["html", "extra", "components"] }), c)).toBeNull();
  });
});

describe("prerequisite order", () => {
  it("rejects a module placed before something it requires", () => {
    const error = check(plan({ orderedModuleIds: ["css", "html", "extra", "components"] }));
    expect(error).toMatch(/"CSS basics" comes before "HTML basics"/);
  });

  /**
   * The subtler failure: the prerequisite is not out of order, it is absent.
   * The module could then never unlock, and the learner would sit in front of a
   * roadmap with a dead end in it.
   */
  it("rejects a module whose prerequisite is not on the roadmap at all", () => {
    const c = catalogue();
    // "extra" is optional, so it can legitimately be skipped — and "components"
    // still requires "css", which is now nowhere.
    c.modules = c.modules.map((m) => (m.id === "css" ? { ...m, requiredForCertificate: false } : m));
    const error = check(
      plan({ orderedModuleIds: ["html", "extra", "components"], skipModuleIds: ["css"] }),
      c,
    );
    expect(error).toMatch(/requires "CSS basics", which was skipped/);
    expect(error).toMatch(/skipping is not passing/);
  });

  it("accepts a prerequisite the learner has already passed", () => {
    const c = catalogue();
    c.learner.completedModuleIds = ["html"];
    expect(check(plan({ orderedModuleIds: ["css", "extra", "components"] }), c)).toBeNull();
  });
});

describe("skipping", () => {
  /**
   * The rule that keeps §6 rule 1 intact. Skipping is not passing — no
   * `module_completions` row is ever written from a model's opinion — so a
   * skipped module required for the certificate would quietly put the
   * certificate out of reach.
   */
  it("refuses to skip a module required for the certificate", () => {
    const error = check(plan({ orderedModuleIds: ["css", "extra", "components"], skipModuleIds: ["html"] }));
    expect(error).toMatch(/required for the certificate, so it cannot be skipped/);
  });

  /**
   * Between the certificate rule and the prerequisite rule, a module can only
   * be skipped if it is optional *and* nothing needs it. That is the honest
   * size of the door: the only thing that really skips a module is testing out
   * of it, which produces evidence.
   */
  it("allows skipping an optional module nothing else requires", () => {
    expect(check(plan({ orderedModuleIds: ["html", "css", "components"], skipModuleIds: ["extra"] }))).toBeNull();
  });

  it("rejects a module that is both skipped and planned", () => {
    const error = check(plan({ skipModuleIds: ["css"] }));
    expect(error).toMatch(/both skipped and in orderedModuleIds/);
  });

  it("rejects a skip of something that is not a module", () => {
    const error = check(plan({ skipModuleIds: ["nonsense"] }));
    expect(error).toMatch(/not a module id/);
  });
});

describe("the explanation", () => {
  it("rejects an explanation too short to be worth showing", () => {
    expect(check(plan({ explanation: "Frontend." }))).toMatch(/too short/i);
  });
});

describe("eligibleModules", () => {
  it("leaves out technology modules and the other track's modules", () => {
    const ids = eligibleModules(catalogue(), FRONTEND).map((m) => m.id);
    expect(ids).toContain("components");
    expect(ids).not.toContain("react-components");
    expect(ids).not.toContain("http");
  });

  /**
   * The order handed to the model must itself be valid, or the prompt is
   * telling it to produce something the validator will reject.
   */
  it("returns an order that already satisfies every prerequisite", () => {
    for (const trackId of [FRONTEND, BACKEND]) {
      const ordered = eligibleModules(catalogue(), trackId);
      const position = new Map(ordered.map((m, i) => [m.id, i]));
      for (const [i, m] of ordered.entries()) {
        for (const req of m.requires) {
          const at = position.get(req);
          if (at !== undefined) expect(at, `${m.id} after ${req}`).toBeLessThan(i);
        }
      }
    }
  });

  /** Which is worth stating as one assertion: the catalogue's own order validates. */
  it("produces a plan the validator accepts unchanged", () => {
    const c = catalogue();
    const ordered = eligibleModules(c, FRONTEND);
    expect(
      check(plan({ orderedModuleIds: ordered.map((m) => m.id) }), c),
    ).toBeNull();
  });
});

describe("estimateWeeks", () => {
  /** design.md §5.5: "16 modules, about 14 weeks at 6 hours a week." */
  it("divides total hours by the weekly budget, rounding up", () => {
    const c = catalogue();
    // html 4 + css 4 + extra 4 + components 4 = 16 hours at 6 a week.
    expect(estimateWeeks(["html", "css", "extra", "components"], c, 6)).toBe(3);
  });

  it("is null when the learner never said how many hours they have", () => {
    expect(estimateWeeks(["html"], catalogue(), null)).toBeNull();
  });

  it("never reports zero weeks", () => {
    expect(estimateWeeks(["html"], catalogue(), 40)).toBe(1);
  });
});
