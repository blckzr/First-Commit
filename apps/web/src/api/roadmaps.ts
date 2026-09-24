import { z } from "zod";
import { apiRequest } from "./client.js";

/**
 * The roadmap, validated at the boundary (AGENT.md §8).
 *
 * These schemas mirror `design.md` §13.3 and are the runtime half of the types
 * in `features/roadmap/types.ts` — the type says what the code expects, this
 * says what actually arrived. A field the API renames fails here, loudly, at
 * the one place it entered the app, rather than as `undefined` somewhere deep
 * in the chart.
 */

const ModuleStatus = z.enum([
  "passed",
  "tested_out",
  "current",
  "available",
  "locked",
  "archived",
]);

const ModuleKind = z.enum(["core", "concept", "technology", "reinforcement", "challenge"]);

const RoadmapModuleNode = z.object({
  id: z.string(),
  moduleId: z.string(),
  versionNo: z.number(),
  title: z.string(),
  kind: ModuleKind,
  technologyOptionId: z.string().optional(),
  status: ModuleStatus,
  score: z.number().optional(),
  requires: z.array(z.string()),
  sharedWithPaths: z.array(z.string()),
  addedReason: z.string().optional(),
  hasUpdate: z.boolean(),
  estimatedHours: z.number(),
});

const SkillStep = z.object({
  type: z.literal("skill"),
  id: z.string(),
  skillId: z.string(),
  title: z.string(),
  layer: z.enum(["core", "concept"]),
  modules: z.array(RoadmapModuleNode),
});

const DecisionStep = z.object({
  type: z.literal("decision"),
  id: z.string(),
  title: z.string(),
  options: z.array(z.object({ id: z.string(), name: z.string(), requires: z.array(z.string()) })),
  chosenOptionId: z.string().optional(),
  recommendedOptionId: z.string().optional(),
});

const MilestoneStep = z.object({
  type: z.enum(["certificate", "capstone", "project_certificate"]),
  id: z.string(),
  title: z.string(),
  status: z.enum(["locked", "in_progress", "earned"]),
  certificateId: z.string().optional(),
  completedMilestones: z.number().optional(),
  totalMilestones: z.number().optional(),
});

/**
 * Discriminated on `type`, exactly as §13.3 requires — so a step type the API
 * adds before the browser knows about it is a parse failure, not a node that
 * silently renders nothing.
 */
const RoadmapStep = z.discriminatedUnion("type", [SkillStep, DecisionStep, MilestoneStep]);

export const RoadmapSchema = z.object({
  id: z.string(),
  careerPathId: z.string(),
  careerPathTitle: z.string(),
  trackId: z.string().nullable().default(null),
  trackTitle: z.string(),
  pathColor: z.enum(["path-1", "path-2", "path-3", "path-4"]),
  steps: z.array(RoadmapStep),
  passedCount: z.number(),
  testedOutCount: z.number().default(0),
  totalCount: z.number(),
  aiRationale: z.string().nullable().default(null),
  weeklyHours: z.number().nullable().default(null),
  estimatedWeeks: z.number().nullable().default(null),
});

const RoadmapResponse = z.object({ roadmap: RoadmapSchema });

export const RoadmapSummary = z.object({
  id: z.string(),
  careerPathId: z.string(),
  careerPathTitle: z.string(),
  trackTitle: z.string().nullable(),
  status: z.string(),
  weeklyHours: z.number().nullable(),
});
export type RoadmapSummary = z.infer<typeof RoadmapSummary>;

const RoadmapList = z.object({ roadmaps: z.array(RoadmapSummary) });

export const roadmapsApi = {
  list: (signal?: AbortSignal) =>
    apiRequest("/roadmaps", { schema: RoadmapList, signal }).then((r) => r.roadmaps),

  get: (id: string, signal?: AbortSignal) =>
    apiRequest(`/roadmaps/${id}`, { schema: RoadmapResponse, signal }).then((r) => r.roadmap),

  /**
   * §5.5: "Adjust weekly hours". Hours are the learner's own statement about
   * their life, not evidence — which is why this is the only thing about a
   * roadmap the browser can change.
   */
  setWeeklyHours: (id: string, weeklyHours: number) =>
    apiRequest(`/roadmaps/${id}`, {
      method: "PATCH",
      body: { weeklyHours },
      schema: RoadmapResponse,
    }).then((r) => r.roadmap),
};
