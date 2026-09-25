import type { Pool, PoolClient } from "pg";

/**
 * Writing to `admin_activity_log` (design.md §6.12, AGENT.md §6 rule 9).
 *
 * **One function, so every admin action is logged the same way.** §6.1 step 5
 * says an admin action that changes a learner's outcome writes a log row; the
 * risk is not that the rule is unknown but that the twentieth endpoint forgets
 * it. A single helper is what makes "did this route log?" a question with one
 * place to look.
 *
 * It takes a `PoolClient` as well as a `Pool` on purpose: a ruling and its log
 * entry belong to the same transaction, so a caller inside `begin`/`commit`
 * passes its client rather than reaching for the pool and landing outside it.
 *
 * **The table is append-only** — a trigger raises on update and delete — so
 * there is deliberately no `updateLogEntry` here. A correction is a new row.
 */

export interface AdminAction {
  adminId: string;
  /** Dotted and past tense: `ai_flag.confirmed_wrong`, `certificate.revoked`. */
  action: string;
  targetType: string;
  targetId: string | null;
  /**
   * Why. §6 rule 10 requires one on any correction to a learner's record; it is
   * optional here because not every logged action is a correction.
   */
  reason?: string | null;
  details?: Record<string, unknown>;
}

export async function logAdminAction(
  db: Pool | PoolClient,
  action: AdminAction,
): Promise<void> {
  await db.query(
    `insert into admin_activity_log (admin_id, action, target_type, target_id, reason, details)
     values ($1, $2, $3, $4, $5, $6)`,
    [
      action.adminId,
      action.action,
      action.targetType,
      action.targetId,
      action.reason ?? null,
      JSON.stringify(action.details ?? {}),
    ],
  );
}
