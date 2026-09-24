/**
 * The roadmap types, from design.md §13.3.
 *
 * **One `Roadmap` object drives both views.** The chart on `md`/`lg` and the
 * stacked list on `sm` read the same object, so they cannot show different
 * data — §11.3 promises the roadmap is recognisable at every width, and this is
 * what makes that true rather than merely intended.
 *
 * `RoadmapStep` is a discriminated union so every node renders through an
 * exhaustive `switch` on `type`. Adding a step type without handling it is a
 * compile error, not a blank space on someone's roadmap.
 */

export type ModuleStatus =
  | "passed"
  | "tested_out"
  | "current"
  | "available"
  | "locked"
  | "archived";

export type ModuleKind =
  | "core"
  | "concept"
  | "technology"
  | "reinforcement"
  | "challenge";

export interface TechnologyOption {
  id: string;
  name: string;
  /** Option ids this one depends on — Next.js requires React. */
  requires: string[];
}

export interface RoadmapModuleNode {
  id: string;
  moduleId: string;
  /** The exact version taken. Progress points at a version, never at "latest". */
  versionNo: number;
  title: string;
  kind: ModuleKind;
  technologyOptionId?: string;
  status: ModuleStatus;
  /** Present when passed. Comes from server-side grading, never from the browser. */
  score?: number;
  requires: string[];
  /** Career path ids, for the "Also in" tag. */
  sharedWithPaths: string[];
  /** Why the Roadmap AI added a reinforcement or challenge module. */
  addedReason?: string;
  hasUpdate: boolean;
  estimatedHours: number;
}

export interface SkillStep {
  type: "skill";
  id: string;
  skillId: string;
  title: string;
  layer: "core" | "concept";
  modules: RoadmapModuleNode[];
}

export interface DecisionStep {
  type: "decision";
  id: string;
  title: string;
  options: TechnologyOption[];
  chosenOptionId?: string;
  recommendedOptionId?: string;
}

export interface MilestoneStep {
  type: "certificate" | "capstone" | "project_certificate";
  id: string;
  title: string;
  status: "locked" | "in_progress" | "earned";
  certificateId?: string;
  completedMilestones?: number;
  totalMilestones?: number;
}

export type RoadmapStep = SkillStep | DecisionStep | MilestoneStep;

export interface Roadmap {
  id: string;
  careerPathId: string;
  careerPathTitle: string;
  trackId: string | null;
  trackTitle: string;
  pathColor: "path-1" | "path-2" | "path-3" | "path-4";
  /** Ordered along the main path, top to bottom. */
  steps: RoadmapStep[];
  passedCount: number;
  /** Of `passedCount`, the ones cleared without working through the module. */
  testedOutCount: number;
  totalCount: number;
  /** §5.5's AI panel — the Roadmap AI's reason for this plan. */
  aiRationale: string | null;
  weeklyHours: number | null;
  /** §5.5: "about 14 weeks at 6 hours a week". Null without the hours. */
  estimatedWeeks: number | null;
}

/** Anything the side panel can open: a step, or a module inside a skill step. */
export type RoadmapSelection =
  | { kind: "step"; step: RoadmapStep }
  | { kind: "module"; module: RoadmapModuleNode; skill: SkillStep };

/**
 * Narrows a step, and fails to compile if a new `type` is added without a case.
 * Every exhaustive `switch` in the roadmap ends with `assertNever(step)`.
 */
export function assertNever(value: never): never {
  throw new Error(`Unhandled roadmap step: ${JSON.stringify(value)}`);
}

/** Passed and tested out both count as done; §8 shows them with different words. */
export function isDone(status: ModuleStatus): boolean {
  return status === "passed" || status === "tested_out";
}

/** Every module on the roadmap, in main-path order. */
export function allModules(roadmap: Roadmap): RoadmapModuleNode[] {
  return roadmap.steps.flatMap((step) => (step.type === "skill" ? step.modules : []));
}

/** Finds a module or step by id, whichever the id belongs to. */
export function findSelection(roadmap: Roadmap, id: string): RoadmapSelection | null {
  for (const step of roadmap.steps) {
    if (step.id === id) return { kind: "step", step };
    if (step.type === "skill") {
      const module = step.modules.find((m) => m.id === id);
      if (module) return { kind: "module", module, skill: step };
    }
  }
  return null;
}
