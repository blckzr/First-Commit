import { z } from "zod";
import { apiRequest } from "./client.js";

/**
 * Analytics (design.md §6.9).
 *
 * **A rate is nullable throughout, and that is load-bearing.** Below the API's
 * threshold there is no rate, because one learner is not a trend — the screen
 * shows "too few to say" and the counts. A schema with `z.number()` here would
 * have forced the API to send 0, which reads as "nobody passed".
 */

const Path = z.object({ id: z.string(), title: z.string(), status: z.string() });

const Paths = z.object({ paths: z.array(Path) });

const Funnel = z.object({
  pathId: z.string(),
  requiredCoreModules: z.number(),
  stages: z.array(z.object({ key: z.string(), label: z.string(), learners: z.number() })),
  roadmaps: z.number(),
});
export type Funnel = z.infer<typeof Funnel>;

const ModuleRow = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  kind: z.string(),
  technology: z.string().nullable(),
  attempted: z.number(),
  passed: z.number(),
  passRate: z.number().nullable(),
  started: z.number(),
  completed: z.number(),
  droppedOff: z.number(),
  dropOffRate: z.number().nullable(),
});
export type ModuleRow = z.infer<typeof ModuleRow>;

const Modules = z.object({
  modules: z.array(ModuleRow),
  technologies: z.array(z.object({ id: z.string(), name: z.string() })),
  enoughLearners: z.number(),
});

const Milestones = z.object({
  milestones: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      sortOrder: z.number(),
      briefTitle: z.string(),
      attempted: z.number(),
      complete: z.number(),
      stuck: z.number(),
      stuckRate: z.number().nullable(),
      failedAttempts: z.number(),
    }),
  ),
  enoughLearners: z.number(),
});

const Technologies = z.object({
  decisions: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      trackTitle: z.string(),
      undecided: z.number(),
      options: z.array(
        z.object({
          technology: z.string(),
          learners: z.number(),
          recommendedTo: z.number(),
        }),
      ),
    }),
  ),
  /**
   * **False, always, and the screen prints the reason.** A technology choice is
   * stored once per roadmap and decision, so switching overwrites the previous
   * answer. `switches: 0` would read as "nobody switches", which the platform
   * cannot know.
   */
  switchesRecorded: z.boolean(),
  switchesReason: z.string(),
});

const AiQuality = z.object({
  sources: z.array(
    z.object({
      source: z.string(),
      outputs: z.number(),
      flags: z.number(),
      flagRate: z.number().nullable(),
      open: z.number(),
      confirmedWrong: z.number(),
      confirmedCorrect: z.number(),
      /** Of the flags an admin has ruled on. Null while none have been. */
      wrongShare: z.number().nullable(),
    }),
  ),
  enoughLearners: z.number(),
});

const CertificatesOverTime = z.object({
  months: z.array(
    z.object({
      month: z.string(),
      type: z.enum(["completion", "project"]),
      issued: z.number(),
      revoked: z.number(),
    }),
  ),
});

export const adminAnalyticsKeys = {
  paths: ["admin", "analytics", "paths"],
  funnel: (pathId: string) => ["admin", "analytics", "funnel", pathId],
  modules: (technology: string) => ["admin", "analytics", "modules", technology],
  milestones: ["admin", "analytics", "milestones"],
  technologies: ["admin", "analytics", "technologies"],
  ai: ["admin", "analytics", "ai"],
  certificates: ["admin", "analytics", "certificates"],
};

export const adminAnalyticsApi = {
  paths: (signal?: AbortSignal) =>
    apiRequest("/admin/analytics/paths", { schema: Paths, signal }),
  funnel: (pathId: string, signal?: AbortSignal) =>
    apiRequest(`/admin/analytics/funnel?path=${pathId}`, { schema: Funnel, signal }),
  modules: (technology: string, signal?: AbortSignal) =>
    apiRequest(
      `/admin/analytics/modules${technology ? `?technology=${technology}` : ""}`,
      { schema: Modules, signal },
    ),
  milestones: (signal?: AbortSignal) =>
    apiRequest("/admin/analytics/milestones", { schema: Milestones, signal }),
  technologies: (signal?: AbortSignal) =>
    apiRequest("/admin/analytics/technologies", { schema: Technologies, signal }),
  ai: (signal?: AbortSignal) => apiRequest("/admin/analytics/ai", { schema: AiQuality, signal }),
  certificates: (signal?: AbortSignal) =>
    apiRequest("/admin/analytics/certificates", { schema: CertificatesOverTime, signal }),
};
