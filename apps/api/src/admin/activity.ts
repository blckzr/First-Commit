import { Router } from "express";
import type { Pool } from "pg";
import { HttpError } from "../middleware/errors.js";
import { requireAdmin, requireAuth } from "../middleware/session.js";

/**
 * The activity log (design.md §6.12).
 *
 * **This module reads. It has no write path at all, and that is the feature.**
 * §6.12 promises "an unchangeable record of sensitive admin actions" and that
 * "no admin can edit or delete entries, including their own"; AGENT.md §6 rule
 * 9 says the same thing from the database's side, where a trigger raises on
 * update and delete. So there is deliberately no `PATCH /admin/log/:id` and no
 * `DELETE` here — not a guarded one, none — and `activity.test.ts` asserts both
 * answer 404, because an endpoint that exists and refuses is one `if` away from
 * an endpoint that does not.
 *
 * Rows are written by `logAdminAction()` from inside each action's own
 * transaction. Nothing in this file writes, so nothing in this file can
 * disagree with what actually happened.
 *
 * **A log of uuids is not a record of anything.** `admin_activity_log` stores
 * `target_type` and `target_id`, which is right for storage and useless on a
 * screen: "module_version / 3f2a8c91…" tells an admin nothing about what was
 * published. `resolveTargets()` turns each id into the name a person would use
 * (§9: name things the way learners do). A target since archived still
 * resolves; one that no longer exists comes back without a label and the screen
 * shows the raw type and id rather than inventing a name.
 *
 * **`select` lists columns** (§6.1 step 6). The target lookups touch `users`,
 * which holds a password hash.
 */

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One page. The log only grows, so the screen pages rather than scrolls. */
const PAGE = 50;

interface LogRow {
  id: string;
  action: string;
  target_type: string;
  target_id: string | null;
  reason: string | null;
  details: Record<string, unknown>;
  created_at: Date;
  admin_id: string | null;
  admin_name: string | null;
}

export function adminActivityRoutes(pool: Pool): Router {
  const router = Router();

  /**
   * §6.12's table, newest first, filterable by admin, action and date.
   *
   * Paged on `id`, not on `created_at`. The column is a `bigint generated
   * always as identity`, so descending id is descending time *and* unique —
   * and two rows sharing a timestamp is the normal case here, not an edge one:
   * ruling against an integrity flag revokes a certificate, which writes two
   * log rows in one transaction. Paging on the timestamp would show one of them
   * twice, or neither, across a page boundary.
   */
  router.get("/admin/log", requireAuth, requireAdmin, async (req, res) => {
    const adminId = optionalId(req.query.admin, "That isn't an admin id.");
    const action = optionalText(req.query.action);
    const from = optionalDate(req.query.from, "start");
    const to = optionalDate(req.query.to, "end");
    const before = optionalCursor(req.query.before);

    if (from && to && from > to) {
      throw new HttpError(400, "The start of the range is after its end.");
    }

    /*
     * **The `where` clause is built from the filters that were given**, rather
     * than written as `($1 is null or column = $1)` for each.
     *
     * Partly because the usual trick does not work here: pg-mem answers
     * "lookups on joins" — it will not evaluate an `or`-wrapped optional
     * predicate against a joined selection, and this query joins `users` for
     * the admin's name, so every test over it failed while production was
     * fine. (Now in `packages/test-db`'s divergence list.)
     *
     * But it is the better query regardless. `(:param is null or id = :param)`
     * is not usable as an index predicate, so filtering by admin on a log that
     * only grows would scan the table; a clause that is present only when it
     * has a value can use the index.
     */
    const conditions: string[] = [];
    const params: unknown[] = [];
    const where = (sql: string, value: unknown) => {
      params.push(value);
      conditions.push(sql.replace("$?", `$${params.length}`));
    };

    if (adminId) where("l.admin_id = $?::uuid", adminId);
    if (action) where("l.action = $?::text", action);
    if (from) where("l.created_at >= $?::timestamptz", from);
    if (to) where("l.created_at < $?::timestamptz", to);
    if (before) where("l.id < $?::bigint", before);

    /*
     * One row more than a page is asked for, so "is there another page?" is
     * answered by what came back rather than by a second `count(*)` over a
     * table that only grows.
     */
    const { rows } = await pool.query<LogRow>(
      `select l.id, l.action, l.target_type, l.target_id, l.reason, l.details, l.created_at,
              l.admin_id, u.full_name as admin_name
         from admin_activity_log l
         left join users u on u.id = l.admin_id
        ${conditions.length > 0 ? `where ${conditions.join(" and ")}` : ""}
        order by l.id desc
        limit ${PAGE + 1}`,
      params,
    );

    const page = rows.slice(0, PAGE);
    const labels = await resolveTargets(pool, page);

    res.json({
      entries: page.map((row) => ({
        id: String(row.id),
        action: row.action,
        at: row.created_at,
        /**
         * **Null when the account is gone, and the screen says "an account
         * since deleted" rather than hiding the row.** `admin_id` is `on delete
         * set null`, so a removed admin leaves the entry standing with no name,
         * which is the whole point of an append-only log. (It also cannot
         * happen today: `set null` is an update, the append-only trigger blocks
         * it, and deleting such an account fails — AGENT.md open question 17.)
         */
        admin: row.admin_id ? { id: row.admin_id, fullName: row.admin_name } : null,
        target: {
          type: row.target_type,
          id: row.target_id,
          label: labels.get(key(row.target_type, row.target_id)) ?? null,
        },
        /** §6 rule 10's required reason, where the action had one. */
        reason: row.reason,
        details: row.details,
      })),
      /** The id to pass back as `before` for the next page; null at the end. */
      nextBefore: rows.length > PAGE ? String(page[page.length - 1].id) : null,
    });
  });

  /**
   * What the filter can offer: the actions and admins actually in the log.
   *
   * Not a hardcoded list. A newly logged action would otherwise be invisible to
   * the filter until someone remembered to add it here, and a filter that
   * cannot name an action is a filter that hides it.
   */
  router.get("/admin/log/filters", requireAuth, requireAdmin, async (_req, res) => {
    const [actions, admins] = await Promise.all([
      pool.query<{ action: string; n: string }>(
        `select action, count(*) as n from admin_activity_log group by action order by action`,
      ),
      pool.query<{ id: string; full_name: string }>(
        `select distinct u.id, u.full_name
           from admin_activity_log l
           join users u on u.id = l.admin_id
          order by u.full_name`,
      ),
    ]);

    res.json({
      actions: actions.rows.map((r) => ({ action: r.action, count: Number(r.n) })),
      admins: admins.rows.map((r) => ({ id: r.id, fullName: r.full_name })),
    });
  });

  return router;
}

const key = (type: string, id: string | null) => `${type}:${id ?? ""}`;

/**
 * Turn `(target_type, target_id)` pairs into names.
 *
 * One query per type present on the page, not one per row — a page of fifty
 * publishes is a single lookup.
 *
 * **The ids are expanded into `in ($1, $2, …)` rather than passed as
 * `= any($1::uuid[])`.** pg-mem returns an *empty result* for `any` over an
 * array parameter instead of erroring, so every label would have come back null
 * in tests while production resolved them fine. A silently wrong answer, which
 * is the kind this repo has been bitten by most.
 */
async function resolveTargets(pool: Pool, rows: LogRow[]): Promise<Map<string, string>> {
  const byType = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!row.target_id) continue;
    const set = byType.get(row.target_type) ?? new Set<string>();
    set.add(row.target_id);
    byType.set(row.target_type, set);
  }

  const labels = new Map<string, string>();

  await Promise.all(
    [...byType].map(async ([type, ids]) => {
      const lookup = LOOKUPS[type];
      if (!lookup) return;

      const list = [...ids];
      const placeholders = list.map((_, i) => `$${i + 1}`).join(", ");
      const { rows: found } = await pool.query<{ id: string; label: string }>(
        lookup(placeholders),
        list,
      );
      for (const row of found) labels.set(key(type, row.id), row.label);
    }),
  );

  return labels;
}

/**
 * How each target type reads as a name.
 *
 * A type missing from here is not an error — the screen falls back to the raw
 * type and id, which is honest and still useful. A new logged action with a new
 * target type should add a line here, and `activity.test.ts` exercises the ones
 * that exist today, so a renamed column is a failing test rather than a page of
 * blank labels.
 *
 * **Every non-text column is cast before being concatenated.** PostgreSQL
 * resolves `text || integer` through `anynonarray`; pg-mem refuses it with
 * "operator does not exist: text || integer". The casts are explicit anyway,
 * which is the clearer SQL.
 */
const LOOKUPS: Record<string, (placeholders: string) => string> = {
  module_version: (p) =>
    `select v.id, v.title || ' (version ' || v.version_no::text || ')' as label
       from module_versions v where v.id in (${p})`,
  module: (p) => `select m.id, m.slug as label from modules m where m.id in (${p})`,
  capstone_brief_version: (p) =>
    `select bv.id, bv.title || ' (version ' || bv.version_no::text || ')' as label
       from capstone_brief_versions bv where bv.id in (${p})`,
  certificate: (p) =>
    `select c.id, u.full_name || ' — ' || c.public_code as label
       from certificates c join users u on u.id = c.user_id where c.id in (${p})`,
  ai_feedback_flag: (p) =>
    `select f.id, u.full_name || ' flagged ' || o.source_type::text as label
       from ai_feedback_flags f
       join users u on u.id = f.user_id
       join ai_outputs o on o.id = f.ai_output_id
      where f.id in (${p})`,
  integrity_flag: (p) =>
    `select f.id, u.full_name || ' — ' || f.type::text as label
       from integrity_flags f
       join capstone_projects pr on pr.id = f.project_id
       join users u on u.id = pr.user_id
      where f.id in (${p})`,
  /** §6.10's suspensions. The account, named — never its password hash. */
  user: (p) => `select u.id, u.full_name as label from users u where u.id in (${p})`,
  /*
   * §6.11's settings are deliberately absent. A setting is keyed by text, not
   * by uuid, so `target_id` is null and the key travels in `details`; there is
   * nothing here to look up, and the screen reads the key from the details for
   * that type.
   */
};

function optionalId(value: unknown, message: string): string | null {
  if (value === undefined || value === "") return null;
  if (typeof value !== "string" || !uuid.test(value)) throw new HttpError(400, message);
  return value;
}

function optionalText(value: unknown): string | null {
  if (value === undefined || value === "") return null;
  if (typeof value !== "string" || value.length > 100) {
    throw new HttpError(400, "That isn't an action.");
  }
  return value;
}

/**
 * A date from the query string.
 *
 * A plain `2026-11-02` is accepted as well as a full timestamp, because that is
 * what a date input sends. An unparseable value is refused rather than quietly
 * dropped: a filter that ignores its own input shows an admin the wrong rows
 * and tells them they are the right ones.
 */
function optionalDate(value: unknown, which: string): string | null {
  if (value === undefined || value === "") return null;
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new HttpError(400, `Enter the ${which} of the range as a date.`);
  }
  return value;
}

function optionalCursor(value: unknown): string | null {
  if (value === undefined || value === "") return null;
  if (typeof value !== "string" || !/^\d{1,19}$/.test(value)) {
    throw new HttpError(400, "That isn't a page marker.");
  }
  return value;
}
