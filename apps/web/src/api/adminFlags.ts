import { z } from "zod";
import { apiRequest } from "./client.js";

/**
 * Flagged AI feedback, for the admin area (design.md §6.8).
 *
 * Kept in its own module rather than added to `api/flags.ts`, which the learner
 * screens import. §4.3 keeps the two areas in separate code, and the admin area
 * is lazy-loaded — a learner's bundle should not carry the shape of an admin
 * response, even as dead types.
 */

const AdminFlag = z.object({
  id: z.string(),
  /** The learner's own words. */
  reason: z.string(),
  status: z.enum(["open", "confirmed_wrong", "confirmed_correct"]),
  createdAt: z.string(),
  adminNotes: z.string().nullable(),
  reviewedAt: z.string().nullable(),
  reviewedBy: z.string().nullable(),
  source: z.string(),
  sourceId: z.string(),
  /** The output as the model wrote it, including what learners never see. */
  output: z.unknown(),
  learner: z.object({ id: z.string(), fullName: z.string() }),
});
export type AdminFlag = z.infer<typeof AdminFlag>;

const FlagList = z.object({
  flags: z.array(AdminFlag),
  /** Every flag by status, so §6.9's "share confirmed wrong" is computable. */
  counts: z.record(z.string(), z.number()),
});
export type FlagList = z.infer<typeof FlagList>;

const FlagResponse = z.object({ flag: AdminFlag });

export interface FlagFilter {
  source?: string | null;
  status?: string | null;
}

export const adminFlagsApi = {
  list: (filter: FlagFilter = {}, signal?: AbortSignal) => {
    const params = new URLSearchParams();
    if (filter.source) params.set("source", filter.source);
    if (filter.status) params.set("status", filter.status);
    const query = params.toString();
    return apiRequest(`/admin/flags${query ? `?${query}` : ""}`, {
      schema: FlagList,
      signal,
    });
  },

  /**
   * §6.8: mark "Feedback was correct" or "Feedback was wrong" with notes.
   *
   * There is no way to send `open` — reopening a ruling would leave
   * `admin_activity_log` saying a decision was made that the row no longer
   * reflects, and the API refuses it.
   */
  rule: (id: string, status: "confirmed_wrong" | "confirmed_correct", notes?: string) =>
    apiRequest(`/admin/flags/${id}`, {
      method: "PATCH",
      body: notes ? { status, notes } : { status },
      schema: FlagResponse,
    }).then((r) => r.flag),
};
