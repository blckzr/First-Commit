import { z } from "zod";
import { apiRequest } from "./client.js";

/**
 * The career path editor (design.md §6.2).
 *
 * This is the structure the Roadmap AI selects from, so the two things §6.2
 * validates are not polish: a circular prerequisite makes a module unreachable,
 * and a technology option with no module for a concept skill leaves one group
 * of learners with a gap nothing else notices.
 */

const Module = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  kind: z.string(),
  technologyId: z.string().nullable(),
  technologyName: z.string().nullable(),
  requiredForCertificate: z.boolean(),
  requires: z.array(z.string()),
});
export type Module = z.infer<typeof Module>;

const Skill = z.object({
  pathSkillId: z.string(),
  trackId: z.string().nullable(),
  layer: z.enum(["core", "concept"]),
  skillId: z.string(),
  slug: z.string(),
  name: z.string(),
  modules: z.array(Module),
});
export type Skill = z.infer<typeof Skill>;

const PathDetail = z.object({
  path: z.object({ id: z.string(), slug: z.string(), title: z.string(), status: z.string() }),
  tracks: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      description: z.string(),
      audience: z.string(),
      status: z.string(),
    }),
  ),
  skills: z.array(Skill),
  warnings: z.array(
    z.object({ trackId: z.string(), technology: z.string(), skill: z.string() }),
  ),
});
export type PathDetail = z.infer<typeof PathDetail>;

export const pathsKey = ["admin", "paths"];
export const pathKey = (id: string) => ["admin", "paths", id];

export const adminPathsApi = {
  list: (signal?: AbortSignal) =>
    apiRequest("/admin/paths", {
      schema: z.object({
        paths: z.array(
          z.object({
            id: z.string(),
            slug: z.string(),
            title: z.string(),
            status: z.string(),
            tracks: z.number(),
            skills: z.number(),
          }),
        ),
      }),
      signal,
    }),

  detail: (id: string, signal?: AbortSignal) =>
    apiRequest(`/admin/paths/${id}`, { schema: PathDetail, signal }),

  setPrerequisites: (pathId: string, moduleId: string, requires: string[]) =>
    apiRequest(`/admin/paths/${pathId}/modules/${moduleId}/prerequisites`, {
      method: "PUT",
      body: { requires },
      schema: z.object({ requires: z.number() }),
    }),

  setRequired: (pathId: string, pathSkillId: string, moduleId: string, required: boolean) =>
    apiRequest(`/admin/paths/${pathId}/skills/${pathSkillId}/modules/${moduleId}`, {
      method: "PATCH",
      body: { requiredForCertificate: required },
      schema: z.object({ requiredForCertificate: z.boolean() }),
    }),
};
