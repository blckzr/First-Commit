import type { Pool, PoolClient } from "pg";

/**
 * Writing a notification (design.md §5.17).
 *
 * **One function, and it takes a `db` rather than owning one.** Every caller so
 * far writes a notification *because* something else happened — a certificate
 * was issued, a project was rejected — and that something is already inside a
 * transaction. Taking `Pool | PoolClient` lets the notification join it, so a
 * failure after the fact cannot leave a learner told about a certificate that
 * was never issued, or silent about a rejection that went through.
 *
 * **A failed notification must never fail the thing it describes.** That is the
 * caller's decision rather than this function's, because the two cases differ:
 * inside a transaction, letting it throw is right (the whole thing unwinds and
 * is retried); outside one, swallowing is right. `notifyQuietly` below is for
 * the second, so a caller has to pick deliberately instead of by accident.
 */

/**
 * The event kinds §5.17 lists. A union rather than a string, so a typo is a
 * compile error instead of a notification nobody can render an icon for.
 *
 * `module_updated`, `module_added` and `reinforcement_added` are specified but
 * have no writer yet — versioning and roadmap adaptation are not built. They are
 * listed because the type is the specification of what the screen must handle,
 * not a record of what happens to exist today.
 */
export type NotificationType =
  | "certificate_earned"
  | "project_rejected"
  | "milestone_reviewed"
  | "module_updated"
  | "module_added"
  | "reinforcement_added"
  | "account_notice";

export interface NotificationInput {
  userId: string;
  type: NotificationType;
  /** One line, sentence case, says what happened (§9). */
  title: string;
  /** Optional detail. Never a reason an admin wrote for internal use. */
  body?: string;
  /** Where "Open" goes. A path on the app, never an absolute URL. */
  link?: string;
  data?: Record<string, unknown>;
}

export async function notify(
  db: Pool | PoolClient,
  input: NotificationInput,
): Promise<{ id: string }> {
  const { rows } = await db.query<{ id: string }>(
    `insert into notifications (user_id, type, title, body, link, data)
     values ($1, $2, $3, $4, $5, $6)
     returning id`,
    [
      input.userId,
      input.type,
      input.title,
      input.body ?? "",
      input.link ?? null,
      JSON.stringify(input.data ?? {}),
    ],
  );

  return { id: rows[0].id };
}

/**
 * The same write, for a caller that is **not** in a transaction and must not
 * fail because of this.
 *
 * Reaching for this inside a transaction would be a mistake: the swallowed error
 * leaves the transaction aborted, so the caller's own commit fails anyway with a
 * far less obvious message.
 */
export async function notifyQuietly(
  db: Pool | PoolClient,
  input: NotificationInput,
): Promise<void> {
  try {
    await notify(db, input);
  } catch {
    // A missing notification is a missed nudge. The thing it describes already
    // happened and is readable on its own screen.
  }
}
