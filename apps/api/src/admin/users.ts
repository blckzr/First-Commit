import { Router } from "express";
import { z } from "zod";
import type { Pool } from "pg";
import { HttpError } from "../middleware/errors.js";
import { requireAdmin, requireAuth, sessionUser } from "../middleware/session.js";
import { logAdminAction } from "./log.js";

/**
 * Account administration (design.md §6.10).
 *
 * ### What this cannot do, by construction
 *
 * **`update users set role` appears nowhere in this file, and `users.test.ts`
 * asserts it.** §6 rule 8 says no endpoint updates `users.role`, and open
 * question 7 wants a database trigger *strengthening* that ban. §6.10 asked for
 * "invite… admin accounts", which is exactly an endpoint that sets the column;
 * that half of §6.10 was dropped rather than built, and the doc now names
 * `npm run db:accounts` and direct SQL as the only way an admin is made.
 * Rule 8 protects the whole admin surface, and an invite flow is the one hole
 * that would make it meaningless.
 *
 * **Nothing here writes evidence.** §6.10's own words: "No action on this page
 * can mark modules as passed or change scores." So this file never touches
 * `module_completions`, `assessment_attempts`, `code_submissions`,
 * `certificates` or `milestone_attempts` — it reads them to show a learner's
 * record and stops there. The tests check the row counts across a suspension.
 *
 * ### What it does
 *
 * Search accounts, read one learner's whole record, and **suspend or reactivate
 * with a required reason**. Suspension is the one write, it is the strongest
 * thing an admin can do to a learner — §6.1 step 2 rejects a suspended account
 * before anything else, so it is a lock-out — and it is therefore logged in the
 * same transaction as the change (§6.1 step 5, §6 rule 10).
 *
 * `requireAdmin` answers 404 rather than 403, because a 403 confirms the route
 * exists.
 *
 * **`select` lists columns throughout** (§6.1 step 6). Every query in this file
 * reads `users`, which holds `password_hash`; `select *` here would put it in a
 * response body.
 */

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * §6.10: "suspend or reactivate with a reason".
 *
 * Both directions need one. Letting an account back in is as much a decision as
 * locking it out, and §6.12 promises a record of what an admin decided *and
 * why* — a reactivation with no reason leaves a log that says the suspension
 * was undone by nobody, for nothing.
 *
 * `.strict()` so a body reaching for `role`, `status` as a free string, or
 * anything else is refused outright rather than ignored.
 */
const StatusBody = z
  .object({
    status: z.enum(["active", "suspended"]),
    /*
     * The message is on `z.string()` as well as on `.min(1)`: `.min` only fires
     * for a string that is present, so a body with no `reason` at all would
     * otherwise answer with Zod's "expected string, received undefined" —
     * which §9 would call vague, and which is the most likely shape of the
     * mistake.
     */
    reason: z
      .string({ error: "Say why this account's status is changing." })
      .trim()
      .min(1, "Say why this account's status is changing.")
      .max(500, "Keep the reason under 500 characters."),
  })
  .strict();

export function adminUserRoutes(pool: Pool): Router {
  const router = Router();

  /**
   * §6.10's learner and admin lists, searchable by name or email.
   *
   * `role` filters rather than two endpoints, because the two lists are the
   * same table and the same columns; §6.10 separates them on the screen, which
   * is a layout decision.
   */
  router.get("/admin/users", requireAuth, requireAdmin, async (req, res) => {
    const search = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const role = typeof req.query.role === "string" ? req.query.role : null;
    if (role !== null && role !== "learner" && role !== "admin") {
      throw new HttpError(400, "There are two roles: learner and admin.");
    }
    const status = typeof req.query.status === "string" ? req.query.status : null;
    if (status !== null && status !== "active" && status !== "suspended") {
      throw new HttpError(400, "An account is active or suspended.");
    }

    const { rows } = await pool.query<{
      id: string;
      email: string;
      full_name: string;
      role: string;
      status: string;
      email_verified_at: Date | null;
      last_login_at: Date | null;
      created_at: Date;
    }>(
      `select u.id, u.email, u.full_name, u.role, u.status,
              u.email_verified_at, u.last_login_at, u.created_at
         from users u
        where ($1 = '' or u.full_name ilike '%' || $1 || '%' or u.email ilike '%' || $1 || '%')
          and ($2::text is null or u.role::text = $2::text)
          and ($3::text is null or u.status::text = $3::text)
        order by u.created_at desc
        limit 100`,
      [search, role, status],
    );

    /**
     * How many admins can still get in.
     *
     * The screen needs it to explain why the last active admin cannot be
     * suspended, and an explanation that appears only *after* the refusal is a
     * worse screen than one that says so up front.
     */
    const admins = await pool.query<{ n: string }>(
      `select count(*) as n from users where role = 'admin' and status = 'active'`,
    );

    res.json({
      users: rows.map((row) => ({
        id: row.id,
        email: row.email,
        fullName: row.full_name,
        role: row.role,
        status: row.status,
        emailVerifiedAt: row.email_verified_at,
        lastLoginAt: row.last_login_at,
        createdAt: row.created_at,
      })),
      activeAdmins: Number(admins.rows[0].n),
    });
  });

  /**
   * §6.10: "view roadmaps, progress, projects, and certificates".
   *
   * All reads. The counts come from the same tables the certificate check
   * reads, so what an admin sees here is what the platform itself believes —
   * there is no separate admin view of a learner's progress that could drift
   * from the learner's own.
   */
  router.get("/admin/users/:id", requireAuth, requireAdmin, async (req, res) => {
    const userId = id(req.params.id);

    const account = await pool.query<{
      id: string;
      email: string;
      full_name: string;
      role: string;
      status: string;
      email_verified_at: Date | null;
      last_login_at: Date | null;
      created_at: Date;
    }>(
      `select id, email, full_name, role, status, email_verified_at, last_login_at, created_at
         from users where id = $1`,
      [userId],
    );
    if (!account.rows[0]) throw new HttpError(404, "Not found");

    const [roadmaps, completions, projects, certificates, suspensions] = await Promise.all([
      pool.query<{
        id: string;
        status: string;
        created_at: Date;
        path_title: string;
        track_title: string | null;
      }>(
        `select r.id, r.status, r.created_at, p.title as path_title, t.title as track_title
           from roadmaps r
           join career_paths p on p.id = r.career_path_id
           left join tracks t on t.id = r.track_id
          where r.user_id = $1
          order by r.created_at desc`,
        [userId],
      ),
      pool.query<{ method: string; n: string }>(
        `select method::text as method, count(*) as n
           from module_completions where user_id = $1 group by method`,
        [userId],
      ),
      pool.query<{
        id: string;
        status: string;
        repo_full_name: string | null;
        brief_title: string;
        started_at: Date;
      }>(
        `select pr.id, pr.status, pr.repo_full_name, bv.title as brief_title, pr.started_at
           from capstone_projects pr
           join capstone_brief_versions bv on bv.id = pr.brief_version_id
          where pr.user_id = $1
          order by pr.started_at desc`,
        [userId],
      ),
      pool.query<{
        id: string;
        public_code: string;
        type: string;
        title: string;
        status: string;
        issued_at: Date;
      }>(
        `select id, public_code, type, title, status, issued_at
           from certificates where user_id = $1 order by issued_at desc`,
        [userId],
      ),
      /**
       * The account's own history of being locked out, read back out of the
       * append-only log rather than from a column on `users`.
       *
       * `users.status` holds the current state and nothing else, so "why is
       * this suspended?" has no answer on the row. §6.12's log is the record,
       * and this is what makes it useful at the point of decision instead of
       * only on the log screen.
       */
      pool.query<{
        action: string;
        reason: string | null;
        created_at: Date;
        admin_name: string | null;
      }>(
        `select l.action, l.reason, l.created_at, u.full_name as admin_name
           from admin_activity_log l
           left join users u on u.id = l.admin_id
          where l.target_type = 'user' and l.target_id = $1
            and l.action in ('account.suspended', 'account.reactivated')
          order by l.id desc
          limit 20`,
        [userId],
      ),
    ]);

    const row = account.rows[0];
    res.json({
      user: {
        id: row.id,
        email: row.email,
        fullName: row.full_name,
        role: row.role,
        status: row.status,
        emailVerifiedAt: row.email_verified_at,
        lastLoginAt: row.last_login_at,
        createdAt: row.created_at,
      },
      roadmaps: roadmaps.rows.map((r) => ({
        id: r.id,
        status: r.status,
        createdAt: r.created_at,
        pathTitle: r.path_title,
        trackTitle: r.track_title,
      })),
      /**
       * Modules passed, split by how.
       *
       * **Split on purpose.** §6 rule 10 means an `override` is an admin's
       * correction, not the learner's work, and a screen that showed one total
       * would let a corrected record read as a clean one. `tested_out` is real
       * evidence (open question 3) and counts, but it is still worth seeing
       * separately from a module someone sat through.
       */
      completions: Object.fromEntries(
        completions.rows.map((c) => [c.method, Number(c.n)]),
      ),
      projects: projects.rows.map((p) => ({
        id: p.id,
        status: p.status,
        repoFullName: p.repo_full_name,
        briefTitle: p.brief_title,
        startedAt: p.started_at,
      })),
      certificates: certificates.rows.map((c) => ({
        id: c.id,
        publicCode: c.public_code,
        type: c.type,
        title: c.title,
        status: c.status,
        issuedAt: c.issued_at,
      })),
      statusHistory: suspensions.rows.map((s) => ({
        action: s.action,
        reason: s.reason,
        at: s.created_at,
        by: s.admin_name,
      })),
    });
  });

  /**
   * Suspend or reactivate an account.
   *
   * **The change and its log entry are one transaction** (§6.1 step 5). A
   * suspension that committed while its log entry failed would be a lock-out
   * nobody could account for — worse than one that did not happen, because the
   * learner is locked out either way and only the record is missing.
   *
   * **An admin cannot suspend their own account**, and that single refusal is
   * what keeps the admin surface open.
   *
   * It is worth spelling out why there is no separate "last active admin"
   * check, because writing one was the obvious move and it turned out to be
   * dead code. The caller of this route is, necessarily, an active admin —
   * `requireAdmin` saw the role and §6.1 step 2 rejected the request if the
   * account were suspended. So for any target other than the caller, at least
   * one active admin remains afterwards: the caller. A count of "other active
   * admins" can never reach zero here, and a guard on it would have been a
   * branch no test could reach, which looks like protection and proves
   * nothing.
   *
   * Refusing self-suspension therefore *is* the last-admin guard. It also
   * stands on its own: suspending yourself ends your own session on the next
   * request and reads as the platform breaking rather than as a deliberate
   * act. `activeAdmins` on the list response exists so the screen can say how
   * many people can still get in, which is the thing an admin actually wants
   * to know before suspending a colleague.
   */
  router.patch("/admin/users/:id/status", requireAuth, requireAdmin, async (req, res) => {
    const admin = sessionUser(req);
    const userId = id(req.params.id);

    const parsed = StatusBody.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, parsed.error.issues[0]?.message ?? "Choose a status and a reason.");
    }
    const { status, reason } = parsed.data;

    if (userId === admin.id) {
      throw new HttpError(
        400,
        "You can't change your own account's status. Ask another admin — and note that no endpoint can make a new admin, so an admin area with nobody in it can only be reopened with SQL.",
      );
    }

    const client = await pool.connect();
    try {
      await client.query("begin");

      const target = await client.query<{ role: string; status: string; full_name: string }>(
        `select role, status, full_name from users where id = $1 for update`,
        [userId],
      );
      if (!target.rows[0]) {
        await client.query("rollback");
        throw new HttpError(404, "Not found");
      }

      /*
       * Already in that state? Nothing to record.
       *
       * Not an error — the admin asked for a state and that is the state — but
       * writing a log row for a change that did not happen would put a
       * suspension in §6.12's record that never occurred, and the log is
       * append-only, so it could never be taken back out.
       */
      if (target.rows[0].status === status) {
        await client.query("rollback");
        res.json({ status, changed: false });
        return;
      }

      await client.query(`update users set status = $2 where id = $1`, [userId, status]);

      /**
       * **A suspension ends the account's sessions.**
       *
       * §6.1 step 2 already rejects a suspended account on every request, so
       * this is not what enforces the lock-out — it is `sessions` not holding
       * live rows for an account that cannot use them. Reactivating does not
       * restore them: logging in again is the right way back.
       */
      if (status === "suspended") {
        await client.query(`delete from sessions where user_id = $1`, [userId]);
      }

      await logAdminAction(client, {
        adminId: admin.id,
        action: status === "suspended" ? "account.suspended" : "account.reactivated",
        targetType: "user",
        targetId: userId,
        reason,
        details: { role: target.rows[0].role, fullName: target.rows[0].full_name },
      });

      await client.query("commit");
    } catch (err) {
      await client.query("rollback").catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    res.json({ status, changed: true });
  });

  return router;
}

function id(value: unknown): string {
  if (typeof value !== "string" || !uuid.test(value)) throw new HttpError(404, "Not found");
  return value;
}
