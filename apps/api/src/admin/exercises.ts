import { Router } from "express";
import { z } from "zod";
import type { Pool } from "pg";
import { HttpError } from "../middleware/errors.js";
import { requireAdmin, requireAuth, sessionUser } from "../middleware/session.js";

/**
 * The exercise editor (design.md §6.3's Test cases and Rubric tabs).
 *
 * **Saving an exercise un-verifies it**, always. §6.3 blocks publishing when the
 * reference solution fails its tests, and the only way that check can mean
 * anything is if an edit invalidates it: an exercise verified on Monday and
 * edited on Tuesday has not been checked. `last_verified_at` is cleared on
 * every write here, and only the worker ever sets it.
 *
 * That is also why there is no "mark as verified" endpoint. The API has no
 * sandbox — it lives in the worker, deliberately, because running submitted
 * code in the process holding `DATABASE_URL` is the thing the design prevents —
 * so this queues a job and waits to be told.
 *
 * **§6 rule 2 runs through the whole file.** Reference solutions, hidden test
 * cases and rubrics are three of the things on the never-send list. They are
 * returned here because an author cannot edit what they cannot see, which makes
 * this exactly the file where a copied query could leak one.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const id = (value: unknown): string => {
  if (typeof value !== "string" || !UUID.test(value)) throw new HttpError(404, "Not found");
  return value;
};

const File = z.object({
  path: z.string().min(1, "A file needs a path."),
  content: z.string(),
});

const Exercise = z.object({
  title: z.string().min(1, "Give the exercise a title."),
  instructions: z.string().default(""),
  passingScore: z.number().min(0).max(100),
  /** The five the platform has a harness for (AGENT.md §7, design.md §13.4). */
  runtime: z.enum(["javascript", "python", "jsdom", "react", "vue"]),
  starterFiles: z.array(File).min(1, "An exercise needs at least one starter file."),
  referenceSolution: z.array(File).min(1, "An exercise needs a reference solution."),
  testCases: z
    .array(
      z.object({
        name: z.string().min(1, "Every test case needs a name."),
        code: z.string().min(1, "A test case needs something to assert."),
        visible: z.boolean(),
      }),
    )
    .min(1, "An exercise needs at least one test case."),
  /** §6.3's Rubric tab. Admin-only forever (§6 rule 2). */
  rubric: z
    .array(z.object({ name: z.string().min(1), description: z.string().default("") }))
    .default([]),
});

export function adminExerciseRoutes(pool: Pool): Router {
  const router = Router();

  const base = "/admin/modules/:id/versions/:versionId/exercise";

  /** The exercise, its rubric, and whether it is currently verified. */
  router.get(base, requireAuth, requireAdmin, async (req, res) => {
    const moduleId = id(req.params.id);
    const versionId = id(req.params.versionId);

    const version = await pool.query<{ status: string }>(
      `select status from module_versions where id = $1 and module_id = $2`,
      [versionId, moduleId],
    );
    if (!version.rows[0]) throw new HttpError(404, "Not found");

    const assessment = await pool.query<{
      id: string;
      title: string;
      instructions: string;
      passing_score: string;
      runtime: string | null;
      starter_files: unknown;
    }>(
      `select id, title, instructions, passing_score, runtime, starter_files
         from assessments
        where module_version_id = $1 and type = 'code'`,
      [versionId],
    );

    if (!assessment.rows[0]) {
      res.json({ exercise: null, editable: version.rows[0].status === "draft" });
      return;
    }

    const assessmentId = assessment.rows[0].id;

    const [cases, solution, rubric, job] = await Promise.all([
      pool.query(
        `select name, test_code, is_visible from test_cases
          where assessment_id = $1 order by sort_order`,
        [assessmentId],
      ),
      pool.query<{ files: unknown; last_verified_at: Date | null }>(
        `select files, last_verified_at from reference_solutions where assessment_id = $1`,
        [assessmentId],
      ),
      pool.query<{ criteria: unknown }>(
        `select criteria from rubrics where assessment_id = $1`,
        [assessmentId],
      ),
      /** The most recent verification, so the screen can show what it said. */
      pool.query<{ status: string; result: unknown; error: string | null; created_at: Date }>(
        `select status, result, error, created_at from ai_jobs
          where type = 'exercise_validation' and source_id = $1
          order by created_at desc limit 1`,
        [assessmentId],
      ),
    ]);

    res.json({
      editable: version.rows[0].status === "draft",
      exercise: {
        id: assessmentId,
        title: assessment.rows[0].title,
        instructions: assessment.rows[0].instructions,
        passingScore: Number(assessment.rows[0].passing_score),
        runtime: assessment.rows[0].runtime,
        starterFiles: assessment.rows[0].starter_files ?? [],
        referenceSolution: solution.rows[0]?.files ?? [],
        testCases: cases.rows.map((row) => ({
          name: row.name,
          code: row.test_code,
          visible: row.is_visible,
        })),
        rubric: rubric.rows[0]?.criteria ?? [],
        /** §6.3's publish gate, as a fact the screen can show. */
        verifiedAt: solution.rows[0]?.last_verified_at ?? null,
      },
      lastRun: job.rows[0]
        ? {
            status: job.rows[0].status,
            result: job.rows[0].result,
            error: job.rows[0].error,
            at: job.rows[0].created_at,
          }
        : null,
    });
  });

  /**
   * Replace the draft's exercise.
   *
   * Safe to delete and reinsert **only because this is a draft**: no
   * `code_submissions` row can reference it, since nobody can submit against an
   * unpublished version. On a published one the `on delete restrict` would
   * refuse anyway, and the status check turns that into a clear 404.
   */
  router.put(base, requireAuth, requireAdmin, async (req, res) => {
    const moduleId = id(req.params.id);
    const versionId = id(req.params.versionId);

    const parsed = Exercise.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, parsed.error.issues[0]?.message ?? "Check the exercise.");
    }

    const client = await pool.connect();
    try {
      await client.query("begin");

      const version = await client.query<{ id: string }>(
        `select id from module_versions
          where id = $1 and module_id = $2 and status = 'draft'
            for update`,
        [versionId, moduleId],
      );
      if (!version.rows[0]) {
        await client.query("rollback");
        throw new HttpError(404, "Not found");
      }

      const existing = await client.query<{ id: string }>(
        `select id from assessments where module_version_id = $1 and type = 'code'`,
        [versionId],
      );

      let assessmentId: string;
      if (existing.rows[0]) {
        assessmentId = existing.rows[0].id;
        await client.query(
          `update assessments
              set title = $2, instructions = $3, passing_score = $4,
                  runtime = $5, starter_files = $6
            where id = $1`,
          [
            assessmentId,
            parsed.data.title,
            parsed.data.instructions,
            parsed.data.passingScore,
            parsed.data.runtime,
            JSON.stringify(parsed.data.starterFiles),
          ],
        );
        await client.query(`delete from test_cases where assessment_id = $1`, [assessmentId]);
      } else {
        const created = await client.query<{ id: string }>(
          `insert into assessments
             (module_version_id, type, title, instructions, passing_score, runtime, starter_files)
           values ($1, 'code', $2, $3, $4, $5, $6)
           returning id`,
          [
            versionId,
            parsed.data.title,
            parsed.data.instructions,
            parsed.data.passingScore,
            parsed.data.runtime,
            JSON.stringify(parsed.data.starterFiles),
          ],
        );
        assessmentId = created.rows[0].id;
      }

      for (const [index, test] of parsed.data.testCases.entries()) {
        await client.query(
          `insert into test_cases (assessment_id, sort_order, name, test_code, is_visible)
           values ($1, $2, $3, $4, $5)`,
          [assessmentId, index, test.name, test.code, test.visible],
        );
      }

      /*
       * **`last_verified_at` is null on every write.** An exercise verified on
       * Monday and edited on Tuesday has not been checked, and a stale stamp is
       * exactly how a broken exercise reaches a learner through a publish gate
       * that looks like it ran. Only the worker ever sets this column.
       */
      await client.query(
        `insert into reference_solutions (assessment_id, files, last_verified_at)
         values ($1, $2, null)
         on conflict (assessment_id)
         do update set files = excluded.files, last_verified_at = null`,
        [assessmentId, JSON.stringify(parsed.data.referenceSolution)],
      );

      await client.query(
        `insert into rubrics (assessment_id, criteria) values ($1, $2)
         on conflict (assessment_id) do update set criteria = excluded.criteria`,
        [assessmentId, JSON.stringify(parsed.data.rubric)],
      );

      await client.query("commit");
      res.json({ testCases: parsed.data.testCases.length, verified: false });
    } catch (err) {
      await client.query("rollback").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  });

  /**
   * Ask the worker to run the reference solution (§6.3).
   *
   * **This queues; it does not answer.** The sandbox is in the worker, so the
   * screen polls for the result. Queueing a second while one is outstanding
   * returns the one already waiting rather than stacking runs an author did not
   * ask for.
   */
  router.post(`${base}/verify`, requireAuth, requireAdmin, async (req, res) => {
    const admin = sessionUser(req);
    const moduleId = id(req.params.id);
    const versionId = id(req.params.versionId);

    const assessment = await pool.query<{ id: string }>(
      `select a.id
         from assessments a
         join module_versions v on v.id = a.module_version_id
        where a.module_version_id = $1 and a.type = 'code'
          and v.module_id = $2 and v.status = 'draft'`,
      [versionId, moduleId],
    );
    if (!assessment.rows[0]) throw new HttpError(404, "Not found");

    const waiting = await pool.query<{ id: string }>(
      `select id from ai_jobs
        where type = 'exercise_validation' and source_id = $1
          and status in ('queued', 'running')
        order by created_at desc limit 1`,
      [assessment.rows[0].id],
    );
    if (waiting.rows[0]) {
      res.json({ jobId: waiting.rows[0].id, queued: false });
      return;
    }

    const job = await pool.query<{ id: string }>(
      `insert into ai_jobs (type, user_id, source_id, payload)
       values ('exercise_validation', $1, $2, $3)
       returning id`,
      [admin.id, assessment.rows[0].id, JSON.stringify({ assessmentId: assessment.rows[0].id })],
    );

    res.status(202).json({ jobId: job.rows[0].id, queued: true });
  });

  return router;
}
