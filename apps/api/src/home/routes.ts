import { Router } from "express";
import type { Pool } from "pg";
import { requireAuth, sessionUser } from "../middleware/session.js";
import { buildHome } from "./build.js";

/**
 * Home (design.md §5.6).
 *
 * There is no id in the URL: everything is scoped to the session user, which is
 * docs/database-schema.md §6.1 step 3 in its simplest form. Read-only — Home
 * shows progress, it never records any.
 */
export function homeRoutes(pool: Pool): Router {
  const router = Router();

  router.get("/home", requireAuth, async (req, res) => {
    const user = sessionUser(req);
    res.json({ home: await buildHome(pool, user.id) });
  });

  return router;
}
