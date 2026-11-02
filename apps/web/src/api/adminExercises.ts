import { z } from "zod";
import { apiRequest } from "./client.js";

/**
 * The exercise editor (design.md §6.3's Test cases and Rubric tabs).
 *
 * **There is no "mark verified" call, and there never will be.** The sandbox is
 * in the worker, so the screen asks for a run and waits to be told. Nothing a
 * browser sends can claim a reference solution passed.
 */

const File = z.object({ path: z.string(), content: z.string() });
export type File = z.infer<typeof File>;

const TestCase = z.object({ name: z.string(), code: z.string(), visible: z.boolean() });
export type TestCase = z.infer<typeof TestCase>;

const Criterion = z.object({ name: z.string(), description: z.string() });
export type Criterion = z.infer<typeof Criterion>;

const Exercise = z.object({
  id: z.string(),
  title: z.string(),
  instructions: z.string(),
  passingScore: z.number(),
  runtime: z.string().nullable(),
  starterFiles: z.array(File),
  referenceSolution: z.array(File),
  testCases: z.array(TestCase),
  rubric: z.array(Criterion),
  verifiedAt: z.string().nullable(),
});
export type Exercise = z.infer<typeof Exercise>;

const Outcome = z.object({
  name: z.string(),
  passed: z.boolean(),
  expected: z.string().optional(),
  actual: z.string().optional(),
});

const Response = z.object({
  editable: z.boolean(),
  exercise: Exercise.nullable(),
  lastRun: z
    .object({
      status: z.string(),
      result: z
        .object({
          verified: z.boolean(),
          outcomes: z.array(Outcome),
          error: z.string().optional(),
        })
        .nullable(),
      error: z.string().nullable(),
      at: z.string(),
    })
    .nullable(),
});

export const RUNTIMES = ["javascript", "python", "jsdom", "react", "vue"] as const;

export const exerciseKey = (moduleId: string, versionId: string) =>
  ["admin", "exercise", moduleId, versionId];

export const adminExercisesApi = {
  get: (moduleId: string, versionId: string, signal?: AbortSignal) =>
    apiRequest(`/admin/modules/${moduleId}/versions/${versionId}/exercise`, {
      schema: Response,
      signal,
    }),

  save: (moduleId: string, versionId: string, body: Record<string, unknown>) =>
    apiRequest(`/admin/modules/${moduleId}/versions/${versionId}/exercise`, {
      method: "PUT",
      body,
      schema: z.object({ testCases: z.number(), verified: z.boolean() }),
    }),

  verify: (moduleId: string, versionId: string) =>
    apiRequest(`/admin/modules/${moduleId}/versions/${versionId}/exercise/verify`, {
      method: "POST",
      body: {},
      schema: z.object({ jobId: z.string(), queued: z.boolean() }),
    }),
};
