import { Router } from "express";
import { z } from "zod";
import type { Pool } from "pg";
import { config } from "../config.js";
import { HttpError } from "../middleware/errors.js";
import type { Mailer } from "../mail/index.js";
import { verificationEmail } from "../mail/index.js";
import { hashPassword } from "./passwords.js";
import { createSession } from "./sessions.js";
import { EMAIL_TOKEN_TTL_MS, expiresIn, generateToken, hashToken } from "./tokens.js";

/**
 * design.md §5.2 — sign up creates an account and does nothing else.
 *
 * The browser sends a name, an email, and a password. It sends no role, no
 * status, and no id: `users.role` defaults to 'learner' in the schema and
 * **no endpoint ever updates it** (AGENT.md §6, rule 8). The first admin is
 * made by running SQL.
 */
const SignUpBody = z.object({
  fullName: z.string().trim().min(1, "Enter the name you want on your certificates.").max(120),
  email: z.string().trim().toLowerCase().email("Enter an email address like you@example.com."),
  password: z.string().min(8, "Use at least 8 characters.").max(200),
});

export function signupRoutes(pool: Pool): Router {
  const router = Router();

  router.post("/auth/signup", async (req, res) => {
    const parsed = SignUpBody.safeParse(req.body);
    if (!parsed.success) {
      // design.md §9: errors explain and direct. One message, the first problem.
      throw new HttpError(400, parsed.error.issues[0].message);
    }
    const { fullName, email, password } = parsed.data;

    // Hash before opening the transaction: argon2id is deliberately slow and
    // should not be holding a connection.
    const passwordHash = await hashPassword(password);
    const verifyToken = generateToken();

    const client = await pool.connect();
    let userId: string;
    try {
      await client.query("begin");

      const inserted = await client.query<{ id: string }>(
        `insert into users (email, password_hash, full_name)
         values ($1, $2, $3)
         on conflict do nothing
         returning id`,
        [email, passwordHash, fullName],
      );

      if (inserted.rowCount === 0) {
        // Sign up cannot hide that an address is taken — the learner has to be
        // told why they cannot proceed. §6.3's non-leaking rule covers log in
        // and password reset, where the caller has not proven anything.
        throw new HttpError(409, "That email is already registered. Log in instead.");
      }
      userId = inserted.rows[0].id;

      await client.query(`insert into learner_profiles (user_id) values ($1)`, [userId]);

      await client.query(
        `insert into email_verification_tokens (user_id, token_hash, expires_at)
         values ($1, $2, $3)`,
        [userId, hashToken(verifyToken), expiresIn(EMAIL_TOKEN_TTL_MS)],
      );

      await client.query("commit");
    } catch (err) {
      await client.query("rollback").catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    await createSession(pool, req, res, userId);

    /**
     * Mail failure does not fail sign up. The account exists either way, and
     * the learner can ask for another link — telling them to start over would
     * be wrong, and there is nothing to roll back to.
     */
    const mailer = req.app.locals.mailer as Mailer;
    const verifyUrl = `${config.appOrigin}/verify-email?token=${verifyToken}`;
    try {
      await mailer.send(verificationEmail(email, verifyUrl));
    } catch (err) {
      console.error(`[signup] verification mail failed for ${userId}:`, (err as Error).message);
    }

    res.status(201).json({
      user: { id: userId, fullName, email, role: "learner", emailVerified: false },
      // design.md §5.2: on success the learner lands on the first onboarding page.
      next: "/onboarding/about",
    });
  });

  return router;
}
