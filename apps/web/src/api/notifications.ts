import { z } from "zod";
import { apiRequest } from "./client.js";

/**
 * Notifications (design.md §5.17).
 *
 * **Nothing here creates one.** They are written by the server code that caused
 * them — a certificate issued, a project rejected — so the browser can only read
 * its own and mark them read.
 */

const Notification = z.object({
  id: z.string(),
  /**
   * Not an enum. §5.17 names six kinds and three of them have no writer yet
   * (versioning and roadmap adaptation are not built), so a `z.enum` would fail
   * the whole list the day one of those ships from the API before this file is
   * updated. The screen falls back to a neutral icon for a kind it does not know.
   */
  type: z.string(),
  title: z.string(),
  body: z.string(),
  link: z.string().nullable(),
  data: z.record(z.string(), z.unknown()),
  readAt: z.string().nullable(),
  createdAt: z.string(),
});
export type Notification = z.infer<typeof Notification>;

const NotificationList = z.object({
  notifications: z.array(Notification),
  unreadCount: z.number(),
});

export const notificationsKey = ["notifications"];

export const notificationsApi = {
  list: (signal?: AbortSignal) =>
    apiRequest("/notifications", { schema: NotificationList, signal }),

  markRead: (id: string) =>
    apiRequest(`/notifications/${id}/read`, {
      method: "PATCH",
      body: {},
      schema: z.object({ readAt: z.string().nullable() }),
    }),

  markAllRead: () =>
    apiRequest("/notifications/read-all", {
      method: "POST",
      body: {},
      schema: z.object({ marked: z.number() }),
    }),
};
