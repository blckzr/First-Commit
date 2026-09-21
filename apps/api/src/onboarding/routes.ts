import { Router } from "express";
import { z } from "zod";
import type { Pool } from "pg";
import { HttpError } from "../middleware/errors.js";
import { requireAuth, sessionUser } from "../middleware/session.js";

/**
 * Onboarding (design.md §5.4).
 *
 * Four steps, each its own page and its own address. "Answers are saved when
 * the learner continues, so closing the browser and returning later resumes at
 * the same step rather than starting over."
 *
 * Every write is scoped to `req.user.id` from the session (§6.1 step 3). The
 * browser never says whose profile it is updating.
 */

/** The order the steps run in. `done` is the terminal state. */
const STEPS = ["about", "target", "placement", "generating", "done"] as const;
type Step = (typeof STEPS)[number];

function indexOf(step: string): number {
  const i = (STEPS as readonly string[]).indexOf(step);
  return i < 0 ? 0 : i;
}

/**
 * A learner may redo a step they have passed, but not skip ahead — §5.4: "a
 * learner cannot open /onboarding/placement before finishing the earlier steps
 * and is sent back to the first unfinished step."
 *
 * The guard in the browser is for the experience; this is the one that counts.
 */
function assertReached(current: string, step: Step): void {
  if (indexOf(current) < indexOf(step)) {
    throw new HttpError(409, "Finish the earlier steps first.");
  }
}

/** Only moves forward, so redoing an earlier step does not undo later progress. */
function advance(current: string, to: Step): string {
  return indexOf(to) > indexOf(current) ? to : current;
}

const AboutBody = z.object({
  experienceLevel: z.enum(["none", "some", "comfortable"]),
  goal: z.enum(["company_job", "freelance", "undecided"]),
  weeklyHours: z
    .number()
    .int("Enter weekly hours as a whole number between 1 and 40.")
    .min(1, "Enter weekly hours as a number between 1 and 40.")
    .max(40, "Enter weekly hours as a number between 1 and 40."),
});

const TargetBody = z.object({
  careerPathId: z.string().uuid("Choose a career path."),
});

/**
 * Placement answers, keyed by skill.
 *
 * **The schema has no placement question table** — `placement_results.results`
 * is free-form jsonb, and nothing defines where the questions come from. Until
 * that is settled, this accepts whatever the browser collected and records it
 * as-is. See AGENT.md §11.
 */
const PlacementBody = z.object({
  careerPathId: z.string().uuid(),
  results: z.record(z.string(), z.unknown()).default({}),
});

interface ProfileRow {
  experience_level: string | null;
  goal: string | null;
  weekly_hours: number | null;
  survey_answers: Record<string, unknown>;
  onboarding_step: string;
}

export function onboardingRoutes(pool: Pool): Router {
  const router = Router();

  /** Published career paths, for the target step. Drafts are admin-only (§6.2). */
  router.get("/career-paths", requireAuth, async (_req, res) => {
    const { rows } = await pool.query(
      `select id, slug, title, description
         from career_paths
        where status = 'published'
        order by title`,
    );
    res.json({ careerPaths: rows });
  });

  /** The current step and everything already answered, so Back refills. */
  router.get("/onboarding", requireAuth, async (req, res) => {
    const user = sessionUser(req);

    const { rows } = await pool.query<ProfileRow>(
      `select experience_level, goal, weekly_hours, survey_answers, onboarding_step
         from learner_profiles where user_id = $1`,
      [user.id],
    );
    const profile = rows[0];
    if (!profile) throw new HttpError(404, "Not found");

    const placement = await pool.query<{ career_path_id: string }>(
      `select career_path_id from placement_results
        where user_id = $1 order by taken_at desc limit 1`,
      [user.id],
    );

    res.json({
      step: profile.onboarding_step,
      about:
        profile.experience_level || profile.goal || profile.weekly_hours
          ? {
              experienceLevel: profile.experience_level,
              goal: profile.goal,
              weeklyHours: profile.weekly_hours,
            }
          : null,
      careerPathId:
        (profile.survey_answers.careerPathId as string | undefined) ??
        placement.rows[0]?.career_path_id ??
        null,
    });
  });

  router.put("/onboarding/about", requireAuth, async (req, res) => {
    const user = sessionUser(req);
    const parsed = AboutBody.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0].message);

    const { rows } = await pool.query<{ onboarding_step: string }>(
      `select onboarding_step from learner_profiles where user_id = $1`,
      [user.id],
    );
    if (!rows[0]) throw new HttpError(404, "Not found");

    const next = advance(rows[0].onboarding_step, "target");
    await pool.query(
      `update learner_profiles
          set experience_level = $1, goal = $2, weekly_hours = $3,
              onboarding_step = $4, updated_at = now()
        where user_id = $5`,
      [parsed.data.experienceLevel, parsed.data.goal, parsed.data.weeklyHours, next, user.id],
    );

    res.json({ step: next, next: "/onboarding/target" });
  });

  router.put("/onboarding/target", requireAuth, async (req, res) => {
    const user = sessionUser(req);
    const parsed = TargetBody.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0].message);

    const { rows } = await pool.query<{
      onboarding_step: string;
      survey_answers: Record<string, unknown>;
    }>(
      `select onboarding_step, survey_answers from learner_profiles where user_id = $1`,
      [user.id],
    );
    if (!rows[0]) throw new HttpError(404, "Not found");
    assertReached(rows[0].onboarding_step, "target");

    // The path must exist and be published — a draft is not a learner's to pick.
    const path = await pool.query(
      `select 1 from career_paths where id = $1 and status = 'published'`,
      [parsed.data.careerPathId],
    );
    if (!path.rowCount) throw new HttpError(400, "That career path isn't available.");

    const next = advance(rows[0].onboarding_step, "placement");
    const answers = { ...rows[0].survey_answers, careerPathId: parsed.data.careerPathId };
    await pool.query(
      `update learner_profiles
          set survey_answers = $1, onboarding_step = $2, updated_at = now()
        where user_id = $3`,
      [JSON.stringify(answers), next, user.id],
    );

    res.json({ step: next, next: "/onboarding/placement" });
  });

  router.post("/onboarding/placement", requireAuth, async (req, res) => {
    const user = sessionUser(req);
    const parsed = PlacementBody.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0].message);

    const { rows } = await pool.query<{ onboarding_step: string; weekly_hours: number | null }>(
      `select onboarding_step, weekly_hours from learner_profiles where user_id = $1`,
      [user.id],
    );
    if (!rows[0]) throw new HttpError(404, "Not found");
    assertReached(rows[0].onboarding_step, "placement");

    const client = await pool.connect();
    try {
      await client.query("begin");

      await client.query(
        `insert into placement_results (user_id, career_path_id, results)
         values ($1, $2, $3)`,
        [user.id, parsed.data.careerPathId, JSON.stringify(parsed.data.results)],
      );

      /**
       * The roadmap row is created here, empty, and the worker fills it in.
       *
       * The API owns business rules (AGENT.md §2), so whose roadmap this is and
       * which path it is for is decided here from the session — not by the
       * worker, and not from anything the browser sent. It also gives the job a
       * real `source_id`: `ai_jobs.source_id` is documented as the roadmap id,
       * and the worker refuses to run without one it can verify belongs to this
       * learner.
       */
      const roadmap = await client.query<{ id: string }>(
        `insert into roadmaps (user_id, career_path_id, weekly_hours, status)
         values ($1, $2, $3, 'active')
         returning id`,
        [user.id, parsed.data.careerPathId, rows[0].weekly_hours],
      );

      const next = advance(rows[0].onboarding_step, "generating");
      await client.query(
        `update learner_profiles set onboarding_step = $1, updated_at = now()
          where user_id = $2`,
        [next, user.id],
      );

      /**
       * The Roadmap AI job. The worker claims it, checks its output against the
       * published catalogue, writes `roadmap_items`, and moves the learner's
       * step to `done` — which is what the generating screen is waiting for.
       */
      await client.query(
        `insert into ai_jobs (type, user_id, source_id, payload)
         values ('roadmap_generation', $1, $2, $3)`,
        [user.id, roadmap.rows[0].id, JSON.stringify({ careerPathId: parsed.data.careerPathId })],
      );

      await client.query("commit");
      res.json({ step: next, next: "/onboarding/generating", roadmapId: roadmap.rows[0].id });
    } catch (err) {
      await client.query("rollback").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  });

  return router;
}
