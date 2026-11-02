import { z } from "zod";
import { apiRequest } from "./client.js";

/**
 * Account administration (design.md §6.10).
 *
 * **There is no `invite` and no way to set a role.** §6 rule 8: no endpoint
 * updates `users.role`. §6.10 asked for an admin invite flow and it was
 * deliberately not built — an admin is made by `npm run db:accounts` or by SQL.
 * The only mutation here is suspend/reactivate, and it always carries a reason.
 */

const Account = z.object({
  id: z.string(),
  email: z.string(),
  fullName: z.string(),
  role: z.enum(["learner", "admin"]),
  status: z.enum(["active", "suspended"]),
  emailVerifiedAt: z.string().nullable(),
  lastLoginAt: z.string().nullable(),
  createdAt: z.string(),
});
export type Account = z.infer<typeof Account>;

const List = z.object({
  users: z.array(Account),
  /** So the screen can say how many people can still reach the admin area. */
  activeAdmins: z.number(),
});

const Detail = z.object({
  user: Account,
  roadmaps: z.array(
    z.object({
      id: z.string(),
      status: z.string(),
      createdAt: z.string(),
      pathTitle: z.string(),
      trackTitle: z.string().nullable(),
    }),
  ),
  /**
   * Modules passed, keyed by how. Split because §6 rule 10 makes an `override`
   * an admin's correction rather than the learner's work.
   */
  completions: z.record(z.string(), z.number()),
  projects: z.array(
    z.object({
      id: z.string(),
      status: z.string(),
      repoFullName: z.string().nullable(),
      briefTitle: z.string(),
      startedAt: z.string(),
    }),
  ),
  certificates: z.array(
    z.object({
      id: z.string(),
      publicCode: z.string(),
      type: z.enum(["completion", "project"]),
      title: z.string(),
      status: z.string(),
      issuedAt: z.string(),
    }),
  ),
  /** Read out of the append-only log — `users.status` holds no reason. */
  statusHistory: z.array(
    z.object({
      action: z.string(),
      reason: z.string().nullable(),
      at: z.string(),
      by: z.string().nullable(),
    }),
  ),
});
export type AccountDetail = z.infer<typeof Detail>;

const StatusResult = z.object({
  status: z.enum(["active", "suspended"]),
  /** False when the account was already in that state; nothing was logged. */
  changed: z.boolean(),
});

export interface UsersQuery {
  q?: string;
  role?: "learner" | "admin";
  status?: "active" | "suspended";
}

const query = (q: UsersQuery) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(q)) if (value) params.set(key, value);
  const string = params.toString();
  return string ? `?${string}` : "";
};

export const adminUsersKey = (q: UsersQuery) => ["admin", "users", q];
export const adminUserKey = (id: string) => ["admin", "users", id];

export const adminUsersApi = {
  list: (q: UsersQuery, signal?: AbortSignal) =>
    apiRequest(`/admin/users${query(q)}`, { schema: List, signal }),
  get: (id: string, signal?: AbortSignal) =>
    apiRequest(`/admin/users/${id}`, { schema: Detail, signal }),
  setStatus: (id: string, body: { status: "active" | "suspended"; reason: string }) =>
    apiRequest(`/admin/users/${id}/status`, {
      method: "PATCH",
      body,
      schema: StatusResult,
    }),
};
