import { z } from "zod";
import { apiRequest } from "./client.js";

/**
 * Platform settings (design.md §6.11).
 *
 * Three sections, one of which writes. The AI and GitHub sections carry
 * `editable: false` and the reason with them, so the screen explains itself
 * from the response rather than from copy that could drift out of step with
 * what the API will accept.
 */

const Prompt = z.object({
  component: z.string(),
  versionNo: z.number(),
  content: z.string(),
  createdAt: z.string(),
  /** From `ai_jobs.model` — what ran, not what the worker was configured with. */
  model: z.string().nullable(),
  lastRunAt: z.string().nullable(),
  runs: z.number(),
});
export type ActivePrompt = z.infer<typeof Prompt>;

const Ai = z.object({
  prompts: z.array(Prompt),
  editable: z.literal(false),
  editableReason: z.string(),
  notBuilt: z.array(z.object({ what: z.string(), why: z.string() })),
});
export type AiSettings = z.infer<typeof Ai>;

const GitHub = z.object({
  configured: z.boolean(),
  implementation: z.string(),
  byType: z.array(
    z.object({
      eventType: z.string(),
      received: z.number(),
      processed: z.number(),
      failed: z.number(),
      lastReceivedAt: z.string().nullable(),
    }),
  ),
  recent: z.array(
    z.object({
      deliveryId: z.string(),
      eventType: z.string(),
      receivedAt: z.string(),
      processedAt: z.string().nullable(),
      error: z.string().nullable(),
    }),
  ),
  editable: z.literal(false),
  editableReason: z.string(),
});
export type GitHubSettings = z.infer<typeof GitHub>;

const Rule = z.object({
  key: z.string(),
  label: z.string(),
  /** §6.11: "shows what it affects". */
  affects: z.string(),
  /** False means storing the value is all that happens today. */
  enforced: z.boolean(),
  min: z.number(),
  max: z.number(),
  unit: z.string(),
  value: z.number(),
  /** False when the value shown is the declared default, not a chosen one. */
  stored: z.boolean(),
  updatedAt: z.string().nullable(),
});
export type LearningRule = z.infer<typeof Rule>;

const Learning = z.object({ rules: z.array(Rule) });
export type LearningSettings = z.infer<typeof Learning>;

export const adminSettingsKeys = {
  ai: ["admin", "settings", "ai"],
  github: ["admin", "settings", "github"],
  learning: ["admin", "settings", "learning"],
};

export const adminSettingsApi = {
  ai: (signal?: AbortSignal) => apiRequest("/admin/settings/ai", { schema: Ai, signal }),
  github: (signal?: AbortSignal) =>
    apiRequest("/admin/settings/github", { schema: GitHub, signal }),
  learning: (signal?: AbortSignal) =>
    apiRequest("/admin/settings/learning", { schema: Learning, signal }),
  setRule: (key: string, value: number) =>
    apiRequest(`/admin/settings/learning/${key}`, {
      method: "PUT",
      body: { value },
      schema: Learning,
    }),
};
