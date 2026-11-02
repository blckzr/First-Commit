import { Router } from "express";
import { z } from "zod";
import type { Pool } from "pg";
import { config } from "../config.js";
import { HttpError } from "../middleware/errors.js";
import { requireAuth, sessionUser } from "../middleware/session.js";
import { verificationEmail, type Mailer } from "../mail/index.js";
import { hashPassword, verifyPassword } from "../auth/passwords.js";
import { createSession, destroyAllSessions, SESSION_COOKIE, sessionCookieOptions } from "../auth/sessions.js";
import { issueToken } from "../auth/spend-token.js";
import { enforceLimit, recordAttempt } from "../auth/rate-limit.js";
import { buildExport } from "./export.js";

/**
 * The account (design.md §5.18).
 *
 * This is the learner's own record, so every handler filters on
 * `sessionUser(req).id` and **not one of them takes a user id** (§6.1 step 3).
 * There is no `:id` in any path here on purpose: an account screen that can
 * name an account is an account screen that can name somebody else's.
 *
 * **Nothing here can change a role or a status.** §6 rule 8 forbids the first
 * and `/admin/users` owns the second; a learner editing their own name must not
 * be the request that quietly carries `role`, so the body schemas are
 * `.strict()` and the update statements name their columns.
 *
 * §5.18 lists five sections. Four are here; the fifth — choosing which
 * notifications arrive by **email** — is deliberately not built, and
 * `design.md` §5.18 records why: nothing in the platform sends a notification
 * by email. `mail/templates.ts` has two templates, verification and reset, and
 * the only `notifications` writer inserts an in-app row. A preference stored
 * now would control nothing, which is the state §6.11's two unenforced rules
 * are already in (AGENT.md open question 19) and not one worth entering twice.
 */

const ProfileBody = z
  .object({
    fullName: z
      .string({ error: "Enter the name you want on your certificates." })
      .trim()
      .min(1, "Enter the name you want on your certificates.")
      .max(120, "Keep your name under 120 characters."),
    email: z
      .string({ error: "Enter an email address like you@example.com." })
      .trim()
      .toLowerCase()
      .email("Enter an email address like you@example.com."),
  })
  .strict();

const PasswordBody = z
  .object({
    currentPassword: z
      .string({ error: "Enter your current password." })
      .min(1, "Enter your current password."),
    newPassword: z
      .string({ error: "Use at least 8 characters." })
      .min(8, "Use at least 8 characters.")
      .max(200, "Keep your password under 200 characters."),
  })
  .strict();

export function accountRoutes(pool: Pool): Router {
  const router = Router();

  /** What the Settings screen shows. The session already knows most of it. */
  router.get("/account", requireAuth, async (req, res) => {
    const user = sessionUser(req);

    const { rows } = await pool.query<{ created_at: Date }>(
      `select created_at from users where id = $1`,
      [user.id],
    );

    res.json({
      fullName: user.fullName,
      email: user.email,
      emailVerified: user.emailVerifiedAt !== null,
      createdAt: rows[0]?.created_at ?? null,
      /**
       * Whether "Delete my account" can succeed, answered by the API rather
       * than guessed by the screen.
       *
       * An admin cannot be deleted: `check_overrides.admin_id` is
       * `on delete restrict`, and `admin_activity_log.admin_id` is
       * `on delete set null`, which `prevent_log_changes` blocks because a
       * set-null is an update and the log is append-only (AGENT.md open
       * question 17). Learners are unaffected — nothing gives them a row in
       * either table — but the screen should not offer a button the API will
       * refuse, and the browser must not be the thing that decides which.
       */
      canDelete: user.role !== "admin",
    });
  });

  /**
   * Name and email.
   *
   * **Changing the email un-verifies it.** `email_verified_at` means "somebody
   * proved they can read this address"; carrying it across to an address nobody
   * has proved makes the column a lie, and every later decision that trusts it
   * — a reset link, a certificate notice — inherits the lie. So the column is
   * cleared and a fresh link goes out in the same transaction.
   *
   * **The name is not retroactive, and §5.18 promises exactly that.**
   * `certificates.recipient_name` is a snapshot taken at issue, so an already
   * issued certificate keeps the name it was earned under. Nothing here
   * rewrites one; a certificate whose name can be edited afterwards is not
   * evidence.
   */
  router.put("/account/profile", requireAuth, async (req, res) => {
    const user = sessionUser(req);
    const parsed = ProfileBody.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0].message);
    const { fullName, email } = parsed.data;

    const emailChanged = email !== user.email.toLowerCase();

    const client = await pool.connect();
    let token: string | null = null;
    try {
      await client.query("begin");

      if (emailChanged) {
        /**
         * Case-insensitive, because the unique index is. Checked inside the
         * transaction so two tabs cannot both pass the check and one of them
         * hit a constraint error the learner cannot act on.
         */
        const taken = await client.query(
          `select 1 from users where lower(email) = lower($1) and id <> $2`,
          [email, user.id],
        );
        if (taken.rowCount && taken.rowCount > 0) {
          // Not a leak: the caller has already proved who they are, so this
          // tells them nothing about an address they could not already test by
          // trying to sign up. §6.3's non-leaking rule covers the open
          // endpoints, where nothing has been proved.
          throw new HttpError(409, "That email is already in use by another account.");
        }
      }

      await client.query(
        emailChanged
          ? `update users set full_name = $2, email = $3, email_verified_at = null,
                    updated_at = now()
              where id = $1`
          : `update users set full_name = $2, updated_at = now() where id = $1`,
        emailChanged ? [user.id, fullName, email] : [user.id, fullName],
      );

      if (emailChanged) token = await issueToken(client, "email_verification_tokens", user.id);

      await client.query("commit");
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }

    /**
     * Sent after the commit, so a mail outage cannot roll back a saved change.
     * The learner can ask again from the screen, which is why a failure here is
     * reported rather than thrown — the profile *did* save.
     */
    let verificationSent = false;
    if (token) {
      const mailer = req.app.locals.mailer as Mailer;
      try {
        await mailer.send(
          verificationEmail(email, `${config.appOrigin}/verify-email?token=${token}`),
        );
        verificationSent = true;
      } catch (err) {
        console.error(`[account] verification send failed for ${user.id}:`, (err as Error).message);
      }
    }

    res.json({ fullName, email, emailChanged, verificationSent });
  });

  /**
   * Change password.
   *
   * Three things happen together, and §6.3 asks for all three:
   *
   * 1. **The current password is required.** A session is not consent to
   *    replace the credential that created it — a borrowed laptop should not be
   *    able to lock its owner out.
   * 2. **Every existing session is destroyed.** "Clear sessions on password
   *    change" — a session obtained with the old password must not outlive it.
   * 3. **This browser is then given a new one**, so changing a password does
   *    not log you out of the device you are standing at. Note the order: the
   *    new session is created *after* the sweep, so it is not swept with the
   *    rest. Swapping those two lines silently logs the learner out.
   *
   * Rate limited on its own `auth_attempts` kind. A stolen session plus an
   * unlimited guess at the current password is a way to take the account over
   * permanently, and `login`'s bucket is deliberately not reused — filling it
   * would lock the real owner out of logging in, which turns a defence into the
   * attack.
   */
  router.put("/account/password", requireAuth, async (req, res) => {
    const user = sessionUser(req);
    const parsed = PasswordBody.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0].message);
    const { currentPassword, newPassword } = parsed.data;

    // Before the work, including before any hashing — the cost of argon2id must
    // not become the endpoint's own denial of service.
    await enforceLimit(pool, "password_change", req, user.email);

    const { rows } = await pool.query<{ password_hash: string }>(
      `select password_hash from users where id = $1`,
      [user.id],
    );
    if (!rows[0]) throw new HttpError(401, "You need to be signed in to do that.");

    if (!(await verifyPassword(rows[0].password_hash, currentPassword))) {
      await recordAttempt(pool, "password_change", req, user.email, false);
      throw new HttpError(400, "That current password isn't right.");
    }

    if (newPassword === currentPassword) {
      throw new HttpError(400, "That's the password you already have. Choose a different one.");
    }

    const passwordHash = await hashPassword(newPassword);

    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(
        `update users set password_hash = $2, updated_at = now() where id = $1`,
        [user.id, passwordHash],
      );
      await destroyAllSessions(client, user.id);
      await client.query("commit");
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }

    await recordAttempt(pool, "password_change", req, user.email, true);

    // Issued after the sweep, never before.
    await createSession(pool, req, res, user.id);

    res.json({ changed: true, otherSessionsEnded: true });
  });

  /**
   * "Download my data" (§5.18).
   *
   * An allowlist, built in `export.ts` — read its docblock before adding a
   * table. Sent as an attachment rather than as a JSON body so the browser
   * saves it; the filename carries the date and nothing the learner typed.
   */
  router.get("/account/export", requireAuth, async (req, res) => {
    const user = sessionUser(req);
    const data = await buildExport(pool, user.id);

    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.setHeader("content-disposition", `attachment; filename="first-commit-data-${stamp}.json"`);
    res.send(JSON.stringify(data, null, 2));
  });

  /**
   * "Delete my account" (§5.18).
   *
   * §6 rule 5 says nothing learners depend on is hard-deleted, and this is the
   * deliberate exception: the rule protects *content and evidence* from being
   * pulled out from under a learner, and here the learner is the one asking.
   * §5.18's dialog is explicit about the consequence — "your certificate
   * verification links will stop working" — and that is literally true, because
   * `certificates.user_id` cascades.
   *
   * **Why three statements when one would do.** Every learner-owned table
   * cascades from `users`, and on real PostgreSQL a single
   * `delete from users` is enough — measured by `npm run db:verify`, which
   * runs both forms against the live database. The ordering is kept for two
   * reasons, neither of which is a production bug:
   *
   * 1. **pg-mem refuses the single statement**, so without the ordering the
   *    most destructive endpoint in the learner API could not be tested in the
   *    suite that runs on every change. Three `on delete restrict` edges run
   *    *between* tables that both cascade from the user —
   *    `certificates.roadmap_id → roadmaps`, `certificates.project_id →
   *    capstone_projects`, `capstone_projects.roadmap_id → roadmaps` — and
   *    pg-mem evaluates the restrict against rows the same statement is about
   *    to remove. It is on `packages/test-db`'s divergence list.
   * 2. PostgreSQL does not *document* an order when one delete cascades into
   *    several tables, so the single statement works by observed behaviour
   *    rather than by promise. Naming the order states the intent and does not
   *    depend on that.
   *
   * If `db:verify` ever reports that the single statement has started failing
   * on the real engine, this ordering is the reason nothing broke.
   *
   * **An admin cannot be deleted**, and the refusal says why rather than
   * failing with a trigger's message (AGENT.md open question 17). Learners are
   * never affected: nothing writes `check_overrides` or `admin_activity_log`
   * for them. `/app/settings` is a learner area (§4.3), so this only fires for
   * an admin calling the endpoint directly — which is exactly the case the API
   * has to answer for, being the only boundary.
   */
  router.delete("/account", requireAuth, async (req, res) => {
    const user = sessionUser(req);

    if (user.role === "admin") {
      throw new HttpError(
        409,
        "An admin account can't be deleted here. It has entries in the activity log, " +
          "which is append-only by design, so removing the account would mean editing " +
          "the record of what it did. Ask another admin to suspend it instead.",
      );
    }

    const client = await pool.connect();
    try {
      await client.query("begin");
      // Order matters — see the docblock. Certificates reference both of the
      // others, so they go first.
      await client.query(`delete from certificates where user_id = $1`, [user.id]);
      await client.query(`delete from capstone_projects where user_id = $1`, [user.id]);
      await client.query(`delete from users where id = $1`, [user.id]);
      await client.query("commit");
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }

    // The session rows went with the user; this clears the cookie that pointed
    // at one of them, so the browser does not keep presenting a dead token.
    res.clearCookie(SESSION_COOKIE, { ...sessionCookieOptions(), maxAge: undefined });
    res.json({ deleted: true });
  });

  return router;
}
