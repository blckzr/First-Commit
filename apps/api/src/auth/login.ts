import { Router } from "express";
import { z } from "zod";
import type { Pool } from "pg";
import { HttpError } from "../middleware/errors.js";
import { hashPassword, verifyPassword } from "./passwords.js";
import { SESSION_COOKIE, createSession, destroySession } from "./sessions.js";
import { enforceLimit, recordAttempt } from "./rate-limit.js";

/**
 * design.md §5.3 — log in and log out.
 *
 * §6.3: "Messages must not leak accounts." A wrong password and an address
 * that was never registered get the same answer, so this endpoint cannot be
 * used to find out who has an account.
 */
const LoginBody = z.object({
  email: z.string().trim().toLowerCase().email("Enter an email address like you@example.com."),
  password: z.string().min(1, "Enter your password."),
});

/** The one message both failure paths use. */
const WRONG = "Email or password is incorrect.";

/**
 * A hash to check against when no account matched.
 *
 * Without it, an unknown address returns before argon2id runs and a known one
 * returns after — a timing difference big enough to enumerate accounts with.
 * Verifying against a throwaway hash makes both paths cost the same.
 */
let decoyHash: string | null = null;
async function decoy(): Promise<string> {
  decoyHash ??= await hashPassword("a password nobody has");
  return decoyHash;
}

interface LoginRow {
  id: string;
  email: string;
  full_name: string;
  password_hash: string;
  role: "learner" | "admin";
  status: "active" | "suspended";
  email_verified_at: Date | null;
  onboarding_step: string | null;
}

/**
 * Where the browser goes next (design.md §5.3).
 *
 * The frontend overrides this when the learner was sent to log in from a
 * protected page; that case belongs to the router, not here.
 */
function nextFor(row: LoginRow): string {
  if (row.role === "admin") return "/admin";
  if (row.onboarding_step && row.onboarding_step !== "done") {
    return `/onboarding/${row.onboarding_step}`;
  }
  return "/app";
}

export function loginRoutes(pool: Pool): Router {
  const router = Router();

  router.post("/auth/login", async (req, res) => {
    const parsed = LoginBody.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0].message);
    const { email, password } = parsed.data;

    // Before the argon2id verify below, so an attacker cannot spend the
    // endpoint's own cost against it.
    await enforceLimit(pool, "login", req, email);

    // Explicit columns (§6.1 step 6). password_hash is read here and never
    // leaves this function.
    const { rows } = await pool.query<LoginRow>(
      `select u.id, u.email, u.full_name, u.password_hash, u.role, u.status,
              u.email_verified_at, p.onboarding_step
         from users u
         left join learner_profiles p on p.user_id = u.id
        where lower(u.email) = lower($1)`,
      [email],
    );

    const user = rows[0];
    const ok = user
      ? await verifyPassword(user.password_hash, password)
      : await verifyPassword(await decoy(), password);

    if (!user || !ok) {
      // Recorded for an unknown address too — see rate-limit.ts on why.
      await recordAttempt(pool, "login", req, email, false);
      throw new HttpError(401, WRONG);
    }

    /**
     * Suspension is reported only after the password checked out. Saying so
     * earlier would confirm the account exists to someone who had not proven
     * anything; saying it here tells them nothing they did not already know.
     */
    if (user.status === "suspended") {
      await recordAttempt(pool, "login", req, email, false);
      throw new HttpError(403, "This account is suspended. Contact an administrator.");
    }

    await recordAttempt(pool, "login", req, email, true);
    await createSession(pool, req, res, user.id);
    await pool.query(`update users set last_login_at = now() where id = $1`, [user.id]);

    res.json({
      user: {
        id: user.id,
        fullName: user.full_name,
        email: user.email,
        role: user.role,
        emailVerified: user.email_verified_at !== null,
      },
      next: nextFor(user),
    });
  });

  /**
   * Always answers 204, whether or not there was a session to end. Log out is
   * not a place to tell someone whether their cookie was real.
   */
  router.post("/auth/logout", async (req, res) => {
    const token: unknown = req.cookies?.[SESSION_COOKIE];
    if (typeof token === "string" && token) {
      await destroySession(pool, res, token);
    }
    res.status(204).end();
  });

  return router;
}
