import { z } from "zod";
import { apiRequest } from "./client.js";

/**
 * The module editor (design.md §6.3) and its impact preview (§6.4).
 *
 * **Nothing here can touch a learner's progress.** The API has no endpoint that
 * does — §6 rule 6 lives in the absence of one — so the worst a mistake in this
 * file can do is show the wrong version to an admin.
 */

/** §13.3's `LessonBlock`, mirrored so the editor can be exhaustive over it. */
export const LessonBlock = z.discriminatedUnion("type", [
  z.object({ type: z.literal("paragraph"), text: z.string() }),
  z.object({ type: z.literal("heading"), text: z.string() }),
  z.object({ type: z.literal("list"), ordered: z.boolean().optional(), items: z.array(z.string()) }),
  z.object({
    type: z.literal("code"),
    language: z.string(),
    code: z.string(),
    caption: z.string().optional(),
  }),
  z.object({ type: z.literal("callout"), tone: z.enum(["info", "notice"]), text: z.string() }),
]);
export type LessonBlock = z.infer<typeof LessonBlock>;
export type BlockType = LessonBlock["type"];

const Lesson = z.object({
  id: z.string().optional(),
  sortOrder: z.number().optional(),
  title: z.string(),
  blocks: z.array(LessonBlock),
});
export type Lesson = z.infer<typeof Lesson>;

const Version = z.object({
  id: z.string(),
  versionNo: z.number(),
  title: z.string(),
  description: z.string(),
  estimatedHours: z.number(),
  status: z.enum(["draft", "published", "superseded", "archived"]),
  changeSummary: z.string(),
  publishedAt: z.string().nullable(),
  createdAt: z.string(),
  lessons: z.array(Lesson),
});
export type Version = z.infer<typeof Version>;

const ModuleRow = z.object({
  id: z.string(),
  slug: z.string(),
  kind: z.string(),
  status: z.string(),
  skillName: z.string(),
  technologyName: z.string().nullable(),
  published: z.object({ id: z.string(), versionNo: z.number(), title: z.string() }).nullable(),
  draft: z.object({ id: z.string(), versionNo: z.number(), title: z.string() }).nullable(),
});
export type ModuleRow = z.infer<typeof ModuleRow>;

const ModuleDetail = z.object({
  module: z.object({
    id: z.string(),
    slug: z.string(),
    kind: z.string(),
    status: z.string(),
    skillName: z.string(),
    technologyName: z.string().nullable(),
  }),
  versions: z.array(Version),
});
export type ModuleDetail = z.infer<typeof ModuleDetail>;

const Impact = z.object({
  versionNo: z.number(),
  title: z.string(),
  currentVersionNo: z.number().nullable(),
  activeRoadmaps: z.number(),
  takingCurrent: z.number(),
  passed: z.number(),
});
export type Impact = z.infer<typeof Impact>;

export const adminModulesKey = (search: string) => ["admin", "modules", search];
export const adminModuleKey = (id: string) => ["admin", "modules", "detail", id];
export const impactKey = (id: string, versionId: string) => ["admin", "impact", id, versionId];

export const adminModulesApi = {
  list: (search: string, signal?: AbortSignal) =>
    apiRequest(`/admin/modules${search ? `?q=${encodeURIComponent(search)}` : ""}`, {
      schema: z.object({ modules: z.array(ModuleRow) }),
      signal,
    }),

  detail: (id: string, signal?: AbortSignal) =>
    apiRequest(`/admin/modules/${id}`, { schema: ModuleDetail, signal }),

  startDraft: (id: string) =>
    apiRequest(`/admin/modules/${id}/versions`, {
      method: "POST",
      body: {},
      schema: z.object({ versionId: z.string(), versionNo: z.number(), reused: z.boolean() }),
    }),

  saveVersion: (id: string, versionId: string, body: Record<string, unknown>) =>
    apiRequest(`/admin/modules/${id}/versions/${versionId}`, {
      method: "PATCH",
      body,
      schema: z.object({ ok: z.boolean() }),
    }),

  saveLessons: (id: string, versionId: string, lessons: Lesson[]) =>
    apiRequest(`/admin/modules/${id}/versions/${versionId}/lessons`, {
      method: "PUT",
      // The server stores the list it is given, so only what it reads is sent.
      body: { lessons: lessons.map((l) => ({ title: l.title, blocks: l.blocks })) },
      schema: z.object({ lessons: z.number() }),
    }),

  impact: (id: string, versionId: string, signal?: AbortSignal) =>
    apiRequest(`/admin/modules/${id}/versions/${versionId}/impact`, { schema: Impact, signal }),

  publish: (id: string, versionId: string) =>
    apiRequest(`/admin/modules/${id}/versions/${versionId}/publish`, {
      method: "POST",
      body: {},
      schema: z.object({
        versionNo: z.number(),
        title: z.string(),
        supersededVersionNo: z.number().nullable(),
      }),
    }),

  discard: (id: string, versionId: string) =>
    apiRequest(`/admin/modules/${id}/versions/${versionId}`, {
      method: "DELETE",
      schema: z.object({ discarded: z.number() }),
    }),
};
