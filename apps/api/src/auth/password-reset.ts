import { Router } from "express";
import { z } from "zod";
import type { Pool } from "pg";
import { config } from "../config.js";
import { HttpError } from "../middleware/errors.js";
import { passwordResetEmail, type Mailer } from "../mail/index.js";
import { hashPassword } from "./passwords.js";
import { destroyAllSessions } from "./sessions.js";
import { issueToken, spendToken } from "./spend-token.js";
import { enforceLimit, recordAttempt } from "./rate-limit.js";

const ForgotBody = z.object({
  email: z.string().trim().toLowerCase().email("Enter an email address like you@example.com."),
});

const ResetBody = z.object({
  token: z.string().min(1, "That reset link is missing its code."),
  password: z.string().min(8, "Use at least 8 characters.").max(200),
});

/**
 * §6.3: "If that email has an account, a reset link is on its way."
 *
 * The same answer whether or not the address is registered. This endpoint is
 * open to anyone, so any difference — status, wording, or an obviously shorter
 * response time — turns it into a way to find out who has an account.
 */
const ALWAYS = "If that email has an account, a reset link is on its way.";

export function passwordResetRoutes(pool: Pool): Router {
  const router = Router();

  router.post("/auth/password/forgot", async (req, res) => {
    const parsed = ForgotBody.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0].message);

    await enforceLimit(pool, "reset_request", req, parsed.data.email);

    const { rows } = await pool.query<{ id: string; email: string }>(
      `select id, email from users where lower(email) = lower($1) and status = 'active'`,
      [parsed.data.email],
    );
    const user = rows[0];

    if (user) {
      const token = await issueToken(pool, "password_reset_tokens", user.id);
      const mailer = req.app.locals.mailer as Mailer;
      try {
        await mailer.send(
          passwordResetEmail(user.email, `${config.appOrigin}/reset-password?token=${token}`),
        );
      } catch (err) {
        // Logged, never surfaced: a 502 here would mean "this address exists".
        console.error(`[reset] mail failed for ${user.id}:`, (err as Error).message);
      }
    }

    // Recorded whether or not an account matched: counting only real accounts
    // would make a 429 mean "this address exists".
    await recordAttempt(pool, "reset_request", req, parsed.data.email, Boolean(user));

    res.json({ message: ALWAYS });
  });

  router.post("/auth/password/reset", async (req, res) => {
    const parsed = ResetBody.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0].message);
    const { token, password } = parsed.data;

    // Hash outside the transaction: argon2id is deliberately slow and should
    // not hold a connection while it runs.
    const passwordHash = await hashPassword(password);

    const client = await pool.connect();
    try {
      await client.query("begin");

      const userId = await spendToken(client, "password_reset_tokens", token);
      if (!userId) {
        await client.query("rollback");
        throw new HttpError(
          400,
          "That link has expired or has already been used. Ask for a new one.",
        );
      }

      await client.query(
        `update users
            set password_hash = $1,
                updated_at = now(),
                -- Following an emailed link proves control of the inbox, which
                -- is the same thing verification asks for. Making them click a
                -- second link would be ceremony.
                email_verified_at = coalesce(email_verified_at, now())
          where id = $2`,
        [passwordHash, userId],
      );

      /**
       * §6.3: sessions are cleared on password change. Whoever prompted the
       * reset — including an attacker holding a stolen cookie — is signed out
       * by it. The learner logs in again with the new password.
       */
      await destroyAllSessions(client, userId);

      await client.query("commit");
    } catch (err) {
      await client.query("rollback").catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    res.json({ reset: true, next: "/login" });
  });

  return router;
}
