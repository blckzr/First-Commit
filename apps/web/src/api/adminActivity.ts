import { z } from "zod";
import { apiRequest } from "./client.js";

/**
 * The activity log (design.md §6.12).
 *
 * **Read-only, and there is no mutation here on purpose.** §6.12: "No admin can
 * edit or delete entries, including their own." The API has no endpoint for it
 * either, so this module having no `update` is not a gap to fill later.
 */

const Entry = z.object({
  id: z.string(),
  action: z.string(),
  at: z.string(),
  /**
   * Null when the admin's account no longer exists. The screen says "an account
   * since deleted" rather than hiding the row — an append-only log keeps the
   * entry whatever happens to the person.
   */
  admin: z.object({ id: z.string(), fullName: z.string().nullable() }).nullable(),
  target: z.object({
    type: z.string(),
    id: z.string().nullable(),
    /** Null for a target type the API does not resolve; the screen falls back. */
    label: z.string().nullable(),
  }),
  reason: z.string().nullable(),
  details: z.record(z.string(), z.unknown()),
});
export type ActivityEntry = z.infer<typeof Entry>;

const Page = z.object({
  entries: z.array(Entry),
  nextBefore: z.string().nullable(),
});

const Filters = z.object({
  actions: z.array(z.object({ action: z.string(), count: z.number() })),
  admins: z.array(z.object({ id: z.string(), fullName: z.string() })),
});
export type ActivityFilters = z.infer<typeof Filters>;

export interface ActivityQuery {
  admin?: string;
  action?: string;
  from?: string;
  to?: string;
  before?: string;
}

const query = (q: ActivityQuery) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(q)) if (value) params.set(key, value);
  const string = params.toString();
  return string ? `?${string}` : "";
};

export const adminActivityKey = (q: ActivityQuery) => ["admin", "log", q];
export const adminActivityFiltersKey = ["admin", "log", "filters"];

export const adminActivityApi = {
  list: (q: ActivityQuery, signal?: AbortSignal) =>
    apiRequest(`/admin/log${query(q)}`, { schema: Page, signal }),
  filters: (signal?: AbortSignal) =>
    apiRequest("/admin/log/filters", { schema: Filters, signal }),
};
