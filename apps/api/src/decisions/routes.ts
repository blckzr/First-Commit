import { Router } from "express";
import { z } from "zod";
import type { Pool } from "pg";
import { HttpError } from "../middleware/errors.js";
import { requireAuth, sessionUser } from "../middleware/session.js";
import { buildDecision, chooseTechnology } from "./build.js";

/**
 * The technology decision (design.md §5.8).
 *
 * Nested under the roadmap because that is where the answer lives: the same
 * decision on two of a learner's roadmaps is two separate choices
 * (`roadmap_technology_choices` is keyed on both). Nesting also means both ids
 * are in the URL and both are checked against the session on every call.
 *
 * §4.3 has no route for this screen; `/app/roadmap/:id/technology/:decisionId`
 * is the shape chosen here, recorded in docs/task-tracker.md.
 */

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function id(value: unknown): string {
  if (typeof value !== "string" || !uuid.test(value)) throw new HttpError(404, "Not found");
  return value;
}

/**
 * The learner sends which option they picked. Strict, so a body trying to carry
 * anything else — a module list, a completion — is a 400 rather than something
 * quietly dropped (AGENT.md §6 rule 1).
 */
const ChoiceBody = z.object({ technologyId: z.string() }).strict();

export function decisionRoutes(pool: Pool): Router {
  const router = Router();

  router.get(
    "/roadmaps/:roadmapId/decisions/:decisionId",
    requireAuth,
    async (req, res) => {
      const user = sessionUser(req);
      const decision = await buildDecision(
        pool,
        id(req.params.roadmapId),
        id(req.params.decisionId),
        user.id,
      );
      if (!decision) throw new HttpError(404, "Not found");
      res.json({ decision });
    },
  );

  router.post(
    "/roadmaps/:roadmapId/decisions/:decisionId",
    requireAuth,
    async (req, res) => {
      const user = sessionUser(req);
      const parsed = ChoiceBody.safeParse(req.body);
      if (!parsed.success) throw new HttpError(400, "Choose one of the options.");

      const result = await chooseTechnology(pool, {
        roadmapId: id(req.params.roadmapId),
        decisionId: id(req.params.decisionId),
        technologyId: parsed.data.technologyId,
        userId: user.id,
      });

      // Null covers both "not yours" and "not an option of this decision".
      // Neither is worth telling apart to the caller.
      if (!result) throw new HttpError(404, "Not found");
      res.json({ result });
    },
  );

  return router;
}
