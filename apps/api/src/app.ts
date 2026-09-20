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

  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());

  // §6.1 step 1 runs on every request. Steps 2 and 5 are requireAuth and
  // requireAdmin, applied per route; steps 3, 4 and 6 are the handler's job.
  app.use(attachSession(pool));

  app.use(health);
  app.use(signupRoutes(pool));

  /** The session the browser currently has. Drives useSession in the web app. */
  app.get("/auth/me", requireAuth, (req, res) => {
    const user = sessionUser(req);
    res.json({
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        emailVerified: user.emailVerifiedAt !== null,
      },
    });
  });

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
