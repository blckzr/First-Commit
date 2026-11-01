import { Router } from "express";
import type { Pool } from "pg";
import { HttpError } from "../middleware/errors.js";
import { requireAuth, sessionUser } from "../middleware/session.js";

/**
 * Notifications (design.md §5.17).
 *
 * **Everything here is filtered by the session user**, and the two writes check
 * ownership of the id in the URL (§6.1 steps 3 and 4). A notification names what
 * a learner earned, failed or had withdrawn, so another learner's list is
 * exactly the kind of thing the API fails open on if a filter is forgotten.
 *
 * Nothing creates a notification here. They are written by the server code that
 * caused them, in the same transaction, through `notify()`.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** §5.17 groups by Today, This week and Earlier; the client does the grouping. */
const PAGE = 50;

export function notificationRoutes(pool: Pool): Router {
  const router = Router();

  router.get("/notifications", requireAuth, async (req, res) => {
    const user = sessionUser(req);

    const { rows } = await pool.query(
      `select id, type, title, body, link, data, read_at, created_at
         from notifications
        where user_id = $1
        order by created_at desc, id desc
        limit $2`,
      [user.id, PAGE],
    );

    /*
     * The unread count is its own query rather than a count of the page above:
     * the page is capped at 50, so a learner with 60 unread would be shown "50"
     * and the badge would quietly stop counting. The index
     * `notifications_user_unread` is partial on `read_at is null`, so this is
     * the query it exists for.
     */
    const unread = await pool.query<{ count: string }>(
      `select count(*) as count from notifications
        where user_id = $1 and read_at is null`,
      [user.id],
    );

    res.json({
      notifications: rows.map((row) => ({
        id: row.id,
        type: row.type,
        title: row.title,
        body: row.body,
        link: row.link,
        data: row.data,
        readAt: row.read_at,
        createdAt: row.created_at,
      })),
      unreadCount: Number(unread.rows[0].count),
    });
  });

  /**
   * Mark one read.
   *
   * **Filtered by the session user, not just by id** (§6.1 step 4). Without the
   * `user_id` clause this would mark any learner's notification read given its
   * id — not a data leak, but a write to somebody else's row, and the kind of
   * thing that is only ever caught by a test.
   */
  router.patch("/notifications/:id/read", requireAuth, async (req, res) => {
    const user = sessionUser(req);
    const id = req.params.id;
    if (typeof id !== "string" || !UUID.test(id)) throw new HttpError(404, "Not found");

    const { rowCount } = await pool.query(
      `update notifications set read_at = now()
        where id = $1 and user_id = $2 and read_at is null`,
      [id, user.id],
    );

    /*
     * Already read is not an error. §5.17 lets a learner mark read from the list
     * and by opening the item, so the same notification can be marked twice by
     * one person in one sitting. A 404 here would be the screen's problem, not
     * the learner's. A notification that is not theirs is a 404, and this cannot
     * tell the two apart — which is the right way round: it does not confirm
     * that somebody else's id exists.
     */
    res.json({ readAt: rowCount === 0 ? null : new Date().toISOString() });
  });

  /** §5.17's "mark all as read". */
  router.post("/notifications/read-all", requireAuth, async (req, res) => {
    const user = sessionUser(req);

    const { rowCount } = await pool.query(
      `update notifications set read_at = now()
        where user_id = $1 and read_at is null`,
      [user.id],
    );

    res.json({ marked: rowCount ?? 0 });
  });

  return router;
}
