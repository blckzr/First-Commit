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

    /**
     * The state of the Roadmap AI job, so the generating screen can tell the
     * truth instead of saying "under a minute" forever.
     *
     * **The status only, never `ai_jobs.error`** (AGENT.md §6 rule 2). That
     * column holds whatever the worker threw — a model message, a connection
     * string in a driver error, a prompt fragment — and none of it belongs in
     * a learner response. The screen writes its own copy from the status.
     */
    const job = await pool.query<{ status: string }>(
      `select status from ai_jobs
        where user_id = $1 and type = 'roadmap_generation'
        order by created_at desc limit 1`,
      [user.id],
    );

    res.json({
      step: profile.onboarding_step,
      generation: job.rows[0]?.status ?? null,
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
      /**
       * **Reused, not inserted again.** This endpoint used to insert a roadmap
       * unconditionally, so every pass through placement — including the
       * generating screen's "Try again", which used to send the learner back
       * here — left another active roadmap behind. One test account ended up
       * with two, and because Home and the chart both read *the newest active
       * roadmap*, the older one was invisible but permanent: §6 rule 5 means
       * nothing is going to delete it.
       */
      const existing = await client.query<{ id: string }>(
        `select id from roadmaps
          where user_id = $1 and career_path_id = $2 and status = 'active'
          order by created_at desc limit 1`,
        [user.id, parsed.data.careerPathId],
      );

      const roadmap = existing.rows[0]
        ? existing
        : await client.query<{ id: string }>(
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
      const pending = await client.query<{ id: string; status: string }>(
        `select id, status from ai_jobs
          where user_id = $1 and type = 'roadmap_generation' and source_id = $2
          order by created_at desc limit 1`,
        [user.id, roadmap.rows[0].id],
      );
      const last = pending.rows[0];

      if (!last || last.status === "completed") {
        await client.query(
          `insert into ai_jobs (type, user_id, source_id, payload)
           values ('roadmap_generation', $1, $2, $3)`,
          [user.id, roadmap.rows[0].id, JSON.stringify({ careerPathId: parsed.data.careerPathId })],
        );
      } else if (last.status === "failed") {
        // Coming back here after a failure means "try again", so try again on
        // the job that already exists rather than leaving it behind.
        await client.query(
          `update ai_jobs set status = 'queued', attempts = 0, error = null, started_at = null
            where id = $1`,
          [last.id],
        );
      }
      // queued or running: it is already on its way, and a second job would
      // only race the first to write the same roadmap.

      await client.query("commit");
      res.json({ step: next, next: "/onboarding/generating", roadmapId: roadmap.rows[0].id });
    } catch (err) {
      await client.query("rollback").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  });

  /**
   * §5.4: "on failure, a Try again that does not lose the learner's answers."
   *
   * Puts *this learner's* failed roadmap job back on the queue. The worker gives
   * up after three attempts, and once it has, nothing in the system would ever
   * look at that job again — `claim_next_ai_job()` only reads `queued`. Without
   * this the learner waits on the generating screen forever, which is what
   * happened when Ollama was not running.
   *
   * Scoped to `user.id` from the session (§6.1 step 3), so the id of a job is
   * never something the browser supplies.
   */
  router.post("/onboarding/generating/retry", requireAuth, async (req, res) => {
    const user = sessionUser(req);

    const { rows } = await pool.query<{ id: string; status: string }>(
      `select id, status from ai_jobs
        where user_id = $1 and type = 'roadmap_generation'
        order by created_at desc limit 1`,
      [user.id],
    );
    const job = rows[0];

    if (!job) {
      throw new HttpError(409, "There is no roadmap to build yet. Start from your target job.");
    }
    if (job.status === "completed") {
      return res.json({ status: "completed" });
    }
    if (job.status !== "failed") {
      // Still queued or running — asking again would not make it faster.
      return res.json({ status: job.status });
    }

    /**
     * `and user_id = $2` is a backstop, not the check — the lookup above is.
     * Mutation-testing it confirms that: removing it breaks nothing, because
     * there is no way through this endpoint to hold a `job.id` that is not
     * yours. It stays because the day someone widens that lookup, this is what
     * stops the widening from becoming a cross-learner write.
     */
    await pool.query(
      `update ai_jobs set status = 'queued', attempts = 0, error = null, started_at = null
        where id = $1 and user_id = $2`,
      [job.id, user.id],
    );

    res.json({ status: "queued" });
  });

  return router;
}
