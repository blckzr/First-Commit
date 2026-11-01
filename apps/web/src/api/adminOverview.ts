import { z } from "zod";
import { apiRequest } from "./client.js";

/**
 * The admin overview (design.md §6.1).
 *
 * **Every number is counted by the API, never estimated.** A page whose job is
 * to say what needs attention is worse than useless when its figures drift: an
 * admin learns not to trust them and stops acting on them. Where the schema
 * cannot answer something §6.1 asks, the field comes back empty and the screen
 * says so, rather than showing a plausible number.
 */

const Overview = z.object({
  // Needs review
  openAiFlags: z.number(),
  openProjectFlags: z.number(),

  // Content
  draftCount: z.number(),
  drafts: z.array(
    z.object({ title: z.string(), moduleSlug: z.string(), updatedAt: z.string() }),
  ),
  missingTemplates: z.array(z.object({ briefTitle: z.string(), technology: z.string() })),

  // Learners struggling
  strugglingModules: z.array(
    z.object({
      slug: z.string(),
      title: z.string(),
      learners: z.number(),
      passRate: z.number(),
    }),
  ),
  strugglingMilestones: z.array(
    z.object({
      title: z.string(),
      briefTitle: z.string(),
      attempted: z.number(),
      stuckRate: z.number(),
    }),
  ),

  // The footer line
  activeLearners: z.number(),
  activeWithinDays: z.number(),
  certificatesThisMonth: z.number(),
  revokedThisMonth: z.number(),
});
export type Overview = z.infer<typeof Overview>;

export const adminOverviewKey = ["admin", "overview"];

export const adminOverviewApi = {
  get: (signal?: AbortSignal) => apiRequest("/admin/overview", { schema: Overview, signal }),
};
