import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { config } from "./config.js";
import { health } from "./routes/health.js";
import { errorHandler, notFound } from "./middleware/errors.js";
import { createMailer, type Mailer } from "./mail/index.js";
import { pool as defaultPool } from "./db.js";
import { attachSession, requireAuth, sessionUser } from "./middleware/session.js";
import { signupRoutes } from "./auth/signup.js";
import { loginRoutes } from "./auth/login.js";
import { verificationRoutes } from "./auth/verification.js";
import { passwordResetRoutes } from "./auth/password-reset.js";
import { onboardingRoutes } from "./onboarding/routes.js";
import { roadmapRoutes } from "./roadmaps/routes.js";
import { moduleRoutes } from "./modules/routes.js";
import { exerciseRoutes } from "./exercises/routes.js";
import { homeRoutes } from "./home/routes.js";
import { decisionRoutes } from "./decisions/routes.js";
import { capstoneRoutes } from "./capstone/routes.js";
import { githubRoutes } from "./github/routes.js";
import { createGitHub, type GitHubClient } from "./github/index.js";
import { githubWebhookRoutes } from "./github/webhook.js";
import { startCommitSweep } from "./capstone/sweep.js";
import { flagRoutes } from "./flags/routes.js";
import { adminFlagRoutes } from "./admin/flags.js";
import { adminIntegrityRoutes } from "./admin/integrity.js";
import { adminCertificateRoutes } from "./admin/certificates.js";
import { certificateRoutes } from "./certificates/routes.js";
import { resumeRoutes } from "./resume/routes.js";
import { pdfRoutes } from "./pdf/routes.js";
import { requireSameOrigin } from "./middleware/csrf.js";
import { EventHub } from "./events/hub.js";
import { eventRoutes, internalEventRoutes } from "./events/routes.js";
import type { Pool } from "pg";

/**
 * Builds the Express app.
 *
 * Kept separate from `index.ts` so tests can import it without binding a port.
 *
 * **This app is the only thing standing between an account and other people's
 * data** (AGENT.md §6). Unlike Row Level Security it fails open, so every
 * request-scoped rule from docs/database-schema.md §6.1 belongs in middleware
 * here, not repeated per handler.
 */
export interface AppDeps {
  /** Injected so tests can assert what would have been sent without sending it. */
  mailer?: Mailer;
  /** Injected so endpoint tests drive a fake instead of a live database. */
  pool?: Pool;
  /** Injected so a test can cover the unconfigured case. `null` closes the route. */
  workerSecret?: string | null;
  /** Injected so endpoint tests drive the connect flow without an App. */
  github?: GitHubClient;
  /** Injected so a test can cover the unconfigured case. `null` closes the webhook. */
  githubWebhookSecret?: string | null;
}

export function createApp(deps: AppDeps = {}) {
  const app = express();
  const pool = deps.pool ?? defaultPool;

  const mailer =
    deps.mailer ??
    createMailer({
      brevoApiKey: config.brevoApiKey,
      mailFrom: config.mailFrom,
      mailFromName: config.mailFromName,
    });

  // Handlers reach the mailer through the request, so no module imports a
  // singleton and every endpoint test can substitute its own.
  app.locals.mailer = mailer;

  /**
   * Unset GitHub settings mean the development client, the same way an unset
   * `BREVO_API_KEY` means the console mailer — the capstone's connect flow is
   * built and tested without an App existing.
   */
  const github =
    deps.github ??
    createGitHub({
      appId: config.githubAppId,
      appSlug: config.githubAppSlug,
      clientId: config.githubClientId,
      clientSecret: config.githubClientSecret,
      privateKey: config.githubPrivateKey,
    });

  // Render terminates TLS at its proxy. Without this, `secure` cookies are
  // never set and req.ip is the proxy's address, which would break the
  // per-IP rate limiting in §6.3.
  app.set("trust proxy", 1);

  // The API never renders HTML, so there is nothing to advertise.
  app.disable("x-powered-by");

  // The app and the API are on different origins, so cookies require an
  // explicit origin — a wildcard is not allowed with credentials.
  app.use(
    cors({
      origin: config.appOrigin,
      credentials: true,
    }),
  );

  /**
   * The raw body is kept alongside the parsed one.
   *
   * GitHub signs the **bytes it sent**, so a webhook signature cannot be checked
   * against a re-serialised object: `JSON.stringify(req.body)` differs from the
   * original in key order, spacing and unicode escaping, and the HMAC would
   * never match. `verify` runs before parsing and is the only place those bytes
   * still exist.
   */
  app.use(
    express.json({
      limit: "1mb",
      verify: (req, _res, buffer) => {
        (req as express.Request & { rawBody?: Buffer }).rawBody = buffer;
      },
    }),
  );
  app.use(cookieParser());

  // §6.1 step 1 runs on every request. Steps 2 and 5 are requireAuth and
  // requireAdmin, applied per route; steps 3, 4 and 6 are the handler's job.
  app.use(attachSession(pool));

  app.use(health);

  const hub = new EventHub(pool);
  app.locals.hub = hub;

  /**
   * §6.2's commit backstop, for a push that arrived while this instance was
   * asleep. In the API rather than the worker because the App's private key is
   * the API's alone — see `capstone/sweep.ts`.
   *
   * Not started under test: a timer firing between assertions would make the
   * suite depend on wall-clock timing, and `sweepCommits()` is exported so it
   * can be driven directly.
   */
  if (!deps.pool) app.locals.stopCommitSweep = startCommitSweep(pool, github);

  // Mounted BEFORE the CSRF guard: the worker is not a browser, sends no
  // Origin, and authenticates with WORKER_SECRET instead.
  app.use(internalEventRoutes(hub, deps.workerSecret === undefined ? config.workerSecret : deps.workerSecret));

  /**
   * Mounted **before `requireSameOrigin`**, like `/internal/events`. A webhook
   * carries no Origin header, so the CSRF guard would refuse every delivery.
   * Its signature is what authenticates it instead.
   */
  app.use(githubWebhookRoutes(pool, deps.githubWebhookSecret));

  // Every state-changing browser route sits behind the CSRF guard. Routes
  // authenticated by a shared secret rather than a cookie are mounted before
  // it, since a non-browser caller sends no Origin.
  app.use(requireSameOrigin);

  app.use(signupRoutes(pool));
  app.use(loginRoutes(pool));
  app.use(verificationRoutes(pool));
  app.use(passwordResetRoutes(pool));
  app.use(onboardingRoutes(pool));
  app.use(roadmapRoutes(pool));
  app.use(moduleRoutes(pool));
  app.use(exerciseRoutes(pool));
  app.use(homeRoutes(pool));
  app.use(decisionRoutes(pool));
  app.use(capstoneRoutes(pool, github));
  app.use(githubRoutes(pool, github));
  app.use(flagRoutes(pool));
  app.use(adminFlagRoutes(pool));
  app.use(adminIntegrityRoutes(pool));
  app.use(adminCertificateRoutes(pool));
  app.use(certificateRoutes(pool));
  app.use(resumeRoutes(pool));
  app.use(pdfRoutes(pool));
  app.use(eventRoutes(hub));

  /** The session the browser currently has. Drives useSession in the web app. */
  app.get("/auth/me", requireAuth, async (req, res) => {
    const user = sessionUser(req);

    /**
     * Where this learner belongs right now.
     *
     * **The server decides, and the guards obey.** An earlier version had the
     * generating screen navigating while a guard redirected somewhere else,
     * and the two fought until the browser throttled navigation. The fix then
     * was "one place decides where a learner goes"; this is that place.
     *
     * §5.4: onboarding ends at the roadmap review (§5.5). A learner who has a
     * roadmap and has not opened a module yet is sent there; once they have
     * started, the review stops being their destination and `/app` is.
     */
    let next = "/app";
    if (user.role === "admin") {
      next = "/admin";
    } else if (user.onboardingStep) {
      next = `/onboarding/${user.onboardingStep}`;
    } else {
      const review = await pool.query<{ id: string }>(
        `select r.id from roadmaps r
          where r.user_id = $1 and r.status = 'active'
            and not exists (select 1 from module_enrollments e where e.user_id = $1)
          order by r.created_at desc limit 1`,
        [user.id],
      );
      if (review.rows[0]) next = `/app/roadmap/${review.rows[0].id}/review`;
    }

    res.json({
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        emailVerified: user.emailVerifiedAt !== null,
      },
      // design.md §4.3: the guards need this on every request, not only in a
      // log-in reply.
      onboardingStep: user.onboardingStep,
      next,
    });
  });

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
