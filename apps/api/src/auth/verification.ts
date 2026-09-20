import { Router } from "express";
import { z } from "zod";
import type { Pool } from "pg";
import { config } from "../config.js";
import { HttpError } from "../middleware/errors.js";
import { requireAuth, sessionUser } from "../middleware/session.js";
import { verificationEmail, type Mailer } from "../mail/index.js";
import { issueToken, spendToken } from "./spend-token.js";

const TokenBody = z.object({
  token: z.string().min(1, "That verification link is missing its code."),
});

/**
 * Email verification (docs/database-schema.md §6.3, §8.1).
 *
 * The token itself is the proof, so spending it needs no session — a learner
 * who opens the link in a different browser must still be able to confirm.
 */
export function verificationRoutes(pool: Pool): Router {
  const router = Router();

  router.post("/auth/verify-email", async (req, res) => {
    const parsed = TokenBody.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0].message);

    const userId = await spendToken(pool, "email_verification_tokens", parsed.data.token);
    if (!userId) {
      // design.md §9: explain and direct. Expired, already used, and never
      // valid are one message on purpose — distinguishing them would tell a
      // stranger which links exist.
      throw new HttpError(
        400,
        "That link has expired or has already been used. Ask for a new one from your settings.",
      );
    }

    // `coalesce` so confirming twice does not move the recorded date. The
    // token is single use, but a replay against a *new* token should not
    // rewrite history either.
    await pool.query(
      `update users set email_verified_at = coalesce(email_verified_at, now()) where id = $1`,
      [userId],
    );

    res.json({ verified: true });
  });

  /**
   * Sends another link. Requires a session, so there is nothing to leak: the
   * caller has already proved who they are.
   */
  router.post("/auth/verification/resend", requireAuth, async (req, res) => {
    const user = sessionUser(req);

    if (user.emailVerifiedAt) {
      res.json({ sent: false, reason: "already-verified" });
      return;
    }

    const token = await issueToken(pool, "email_verification_tokens", user.id);
    const mailer = req.app.locals.mailer as Mailer;

    /**
     * Unlike sign up, a failure here is surfaced. The caller explicitly asked
     * for an email; answering "sent" when nothing was sent would leave them
     * waiting on a message that is never coming.
     */
    try {
      await mailer.send(
        verificationEmail(user.email, `${config.appOrigin}/verify-email?token=${token}`),
      );
    } catch (err) {
      console.error(`[verification] resend failed for ${user.id}:`, (err as Error).message);
      throw new HttpError(
        502,
        "We couldn't send that email just now. Try again in a minute.",
      );
    }

    res.json({ sent: true });
  });

  return router;
}
