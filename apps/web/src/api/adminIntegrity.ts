import { z } from "zod";
import { apiRequest } from "./client.js";

/**
 * Flagged capstone projects (design.md §6.6).
 *
 * **A flag is a question, not a verdict.** The screen has to read that way: the
 * learner's name sits beside the evidence, not a conclusion, and every outcome —
 * including clearing it — needs a reason.
 */

const Flag = z.object({
  id: z.string(),
  type: z.enum(["single_commit", "similarity", "weak_explanation", "other"]),
  status: z.enum(["open", "cleared", "explanation_requested", "redo_requested", "rejected"]),
  details: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
  decidedAt: z.string().nullable(),
  decisionReason: z.string().nullable(),
  project: z.object({
    id: z.string(),
    briefTitle: z.string(),
    repoFullName: z.string().nullable(),
    demoUrl: z.string().nullable(),
  }),
  learner: z.object({ id: z.string(), name: z.string() }),
});
export type Flag = z.infer<typeof Flag>;

const FlagList = z.object({ flags: z.array(Flag) });

const FlagDetail = z.object({
  flag: z.object({
    id: z.string(),
    type: z.string(),
    status: z.string(),
    details: z.record(z.string(), z.unknown()),
  }),
  project: z.object({
    briefTitle: z.string(),
    repoFullName: z.string().nullable(),
    learnerName: z.string(),
  }),
  commits: z.array(
    z.object({
      sha: z.string(),
      message: z.string(),
      authorLogin: z.string().nullable(),
      pushedAt: z.string(),
    }),
  ),
  /**
   * §5.14 stores these "for admin review if the project is flagged". This is the
   * only place in the whole app they are read.
   */
  explanations: z.array(
    z.object({
      title: z.string(),
      question: z.string().nullable(),
      answer: z.string().nullable(),
    }),
  ),
});
export type FlagDetail = z.infer<typeof FlagDetail>;

export type Ruling = "cleared" | "explanation_requested" | "redo_requested" | "rejected";

export const integrityKey = ["admin", "integrity"];
export const integrityDetailKey = (id: string) => ["admin", "integrity", id];

export const adminIntegrityApi = {
  list: (status: string | null, signal?: AbortSignal) =>
    apiRequest(`/admin/integrity${status ? `?status=${status}` : ""}`, {
      schema: FlagList,
      signal,
    }),

  detail: (id: string, signal?: AbortSignal) =>
    apiRequest(`/admin/integrity/${id}`, { schema: FlagDetail, signal }),

  /**
   * A reason is required — by this call, by the endpoint, and by the schema's
   * own check constraint. §6 rule 10: an admin's correction is a logged
   * override with a reason, never a silent change.
   */
  rule: (id: string, status: Ruling, reason: string) =>
    apiRequest(`/admin/integrity/${id}`, {
      method: "PATCH",
      body: { status, reason },
      schema: z.object({ status: z.string() }),
    }),
};
