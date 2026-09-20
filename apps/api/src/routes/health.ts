import { Router } from "express";
import { checkDb } from "../db.js";

export const health = Router();

/**
 * Liveness. Render points its health check here (docs/database-schema.md §9.3
 * step 4), so it must be cheap and must not depend on the database — a check
 * that fails when the database blinks would have Render restart a healthy
 * process.
 */
health.get("/health", (_req, res) => {
  res.json({ ok: true, uptime: Math.round(process.uptime()) });
});

/** Readiness. Reports whether the database is actually reachable. */
health.get("/health/db", async (_req, res) => {
  const db = await checkDb();
  res.status(db.ok ? 200 : 503).json(db);
});
