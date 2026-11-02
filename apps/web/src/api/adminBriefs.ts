import { z } from "zod";
import { apiRequest } from "./client.js";

/**
 * The capstone brief editor (design.md §6.5).
 *
 * Briefs version exactly as modules do, so this client is the module one's
 * shape. The field that is particular to a brief is `missingTemplates`: §6.5
 * blocks publishing for an option without a starter repository, because a
 * learner who picks it could not start at all.
 */

const Check = z.object({
  type: z.enum(["file_exists", "workflow_test", "deployment_url"]),
  name: z.string(),
  path: z.string().optional(),
  workflow: z.string().optional(),
  testName: z.string().optional(),
});
export type Check = z.infer<typeof Check>;

const Milestone = z.object({
  id: z.string().optional(),
  title: z.string(),
  acceptanceCriteria: z.array(z.string()),
  reviewChecklist: z.array(z.string()),
  explanationQuestion: z.string().nullable(),
  checks: z.array(Check),
});
export type Milestone = z.infer<typeof Milestone>;

const Template = z.object({
  technologyId: z.string(),
  technology: z.string(),
  repoFullName: z.string(),
});
export type Template = z.infer<typeof Template>;

const Version = z.object({
  id: z.string(),
  versionNo: z.number(),
  title: z.string(),
  description: z.string(),
  goals: z.string(),
  estimatedWeeks: z.number(),
  status: z.enum(["draft", "published", "superseded", "archived"]),
  publishedAt: z.string().nullable(),
  milestones: z.array(Milestone),
  templates: z.array(Template),
  missingTemplates: z.array(z.string()),
});
export type Version = z.infer<typeof Version>;

const BriefDetail = z.object({
  brief: z.object({ id: z.string(), slug: z.string(), status: z.string(), track_id: z.string() }),
  technologies: z.array(z.object({ id: z.string(), name: z.string() })),
  versions: z.array(Version),
});
export type BriefDetail = z.infer<typeof BriefDetail>;

export const briefsKey = ["admin", "briefs"];
export const briefKey = (id: string) => ["admin", "briefs", id];

export const adminBriefsApi = {
  list: (signal?: AbortSignal) =>
    apiRequest("/admin/briefs", {
      schema: z.object({
        briefs: z.array(
          z.object({
            id: z.string(),
            slug: z.string(),
            status: z.string(),
            trackTitle: z.string(),
            published: z.object({ id: z.string(), versionNo: z.number(), title: z.string() }).nullable(),
            draft: z.object({ id: z.string(), versionNo: z.number(), title: z.string() }).nullable(),
          }),
        ),
      }),
      signal,
    }),

  detail: (id: string, signal?: AbortSignal) =>
    apiRequest(`/admin/briefs/${id}`, { schema: BriefDetail, signal }),

  startDraft: (id: string) =>
    apiRequest(`/admin/briefs/${id}/versions`, {
      method: "POST",
      body: {},
      schema: z.object({ versionId: z.string(), reused: z.boolean() }),
    }),

  saveMilestones: (id: string, versionId: string, milestones: Milestone[]) =>
    apiRequest(`/admin/briefs/${id}/versions/${versionId}/milestones`, {
      method: "PUT",
      body: {
        milestones: milestones.map((m) => ({
          title: m.title,
          acceptanceCriteria: m.acceptanceCriteria,
          reviewChecklist: m.reviewChecklist,
          explanationQuestion: m.explanationQuestion,
          checks: m.checks,
        })),
      },
      schema: z.object({ milestones: z.number() }),
    }),

  saveTemplates: (
    id: string,
    versionId: string,
    templates: { technologyId: string; repoFullName: string }[],
  ) =>
    apiRequest(`/admin/briefs/${id}/versions/${versionId}/templates`, {
      method: "PUT",
      body: { templates },
      schema: z.object({ templates: z.number() }),
    }),

  publish: (id: string, versionId: string) =>
    apiRequest(`/admin/briefs/${id}/versions/${versionId}/publish`, {
      method: "POST",
      body: {},
      schema: z.object({
        versionNo: z.number(),
        title: z.string(),
        supersededVersionNo: z.number().nullable(),
      }),
    }),
};
