import { Router } from "express";
import { z } from "zod";
import type { Pool } from "pg";
import { HttpError } from "../middleware/errors.js";
import { requireAuth, sessionUser } from "../middleware/session.js";

/**
 * Coding exercises (design.md §5.11).
 *
 * Three things live behind these endpoints that a learner must never receive
 * (AGENT.md §6 rule 2): **hidden test cases, reference solutions, and
 * rubrics**. None of the queries below selects from `reference_solutions` or
 * `rubrics` at all, and the test-case query filters `is_visible = true` — the
 * one place that filter has to be right.
 *
 * **Submitting accepts files and nothing else** (§6 rule 4). The browser's own
 * "Run tests" is practice; it produces no evidence, because a result the
 * browser computed is a result the browser could have invented. A submission
 * queues work for the server, which is the only thing whose results count.
 */

const id = (value: unknown): string => {
  if (typeof value !== "string" || !/^[0-9a-f-]{36}$/i.test(value)) {
    throw new HttpError(404, "Not found");
  }
  return value;
};

/**
 * §6 rule 4: "Submission endpoints accept files, nothing else."
 *
 * `.strict()` so a body carrying `passed`, `testResults` or a score is
 * **refused** rather than ignored — a client that tries is told, not quietly
 * disbelieved.
 */
const SubmissionBody = z
  .object({
    files: z
      .array(
        z.object({
          path: z.string().min(1).max(200),
          content: z.string().max(100_000),
        }),
      )
      .min(1, "Send at least one file.")
      .max(20, "That is more files than an exercise has."),
  })
  .strict();

/**
 * The parts of a `code_feedback` output a learner may read.
 *
 * **`rubric` is left behind.** §6 rule 2 names rubrics among the things that
 * never reach a learner, and §5.11's screen shows a summary, the issues, and a
 * closing line — so sending the model's criterion-by-criterion scoring would be
 * payload nothing renders, on a field the rule says to keep back.
 */
function readable(content: unknown): {
  summary: string;
  issues: { line: number | null; problem: string; hint: string }[];
  encouragement: string;
} {
  const c = (content ?? {}) as Record<string, unknown>;
  return {
    summary: typeof c.summary === "string" ? c.summary : "",
    issues: Array.isArray(c.issues)
      ? (c.issues as Record<string, unknown>[]).map((i) => ({
          line: typeof i.line === "number" ? i.line : null,
          problem: typeof i.problem === "string" ? i.problem : "",
          hint: typeof i.hint === "string" ? i.hint : "",
        }))
      : [],
    encouragement: typeof c.encouragement === "string" ? c.encouragement : "",
  };
}

export function exerciseRoutes(pool: Pool): Router {
  const router = Router();

  /** The exercise, as a learner may see it. */
  router.get("/exercises/:id", requireAuth, async (req, res) => {
    const user = sessionUser(req);
    const assessmentId = id(req.params.id);

    const found = await pool.query<{
      id: string;
      title: string;
      instructions: string;
      runtime: string | null;
      starter_files: { path: string; content: string }[];
      module_id: string;
      module_title: string;
    }>(
      `select a.id, a.title, a.instructions, a.runtime, a.starter_files,
              m.id as module_id, v.title as module_title
         from assessments a
         join module_versions v on v.id = a.module_version_id
         join modules m on m.id = v.module_id
        where a.id = $1 and a.type = 'code'
          and v.status = 'published' and m.status = 'published'`,
      [assessmentId],
    );
    const exercise = found.rows[0];
    if (!exercise) throw new HttpError(404, "Not found");

    /**
     * **Visible cases only, and only their names.**
     *
     * `is_visible = false` is the whole defence against a solution that
     * special-cases the inputs it can see, so a hidden case must not appear in
     * any shape — not its name, not its code, not its count.
     *
     * `test_code` is left out even for visible ones. §5.11's screen shows a
     * name and an expected-versus-actual, never the assertion, so sending the
     * code would be payload nothing renders — and payload nothing renders is
     * payload that leaks into a screenshot for no benefit.
     */
    const cases = await pool.query<{ id: string; name: string }>(
      `select id, name from test_cases
        where assessment_id = $1 and is_visible = true
        order by sort_order`,
      [assessmentId],
    );

    /** Their own last attempt, so the editor reopens where they left it. */
    const last = await pool.query<{
      id: string;
      files: { path: string; content: string }[];
      status: string;
      test_results: unknown;
      passed: boolean | null;
      submitted_at: Date;
    }>(
      `select id, files, status, test_results, passed, submitted_at
         from code_submissions
        where user_id = $1 and assessment_id = $2
        order by submitted_at desc limit 1`,
      [user.id, assessmentId],
    );

    res.json({
      exercise: {
        id: exercise.id,
        title: exercise.title,
        instructions: exercise.instructions,
        runtime: exercise.runtime,
        moduleId: exercise.module_id,
        moduleTitle: exercise.module_title,
        starterFiles: exercise.starter_files,
        visibleTests: cases.rows.map((c) => ({ id: c.id, name: c.name })),
        lastSubmission: last.rows[0]
          ? {
              id: last.rows[0].id,
              files: last.rows[0].files,
              status: last.rows[0].status,
              testResults: last.rows[0].test_results,
              passed: last.rows[0].passed,
              submittedAt: last.rows[0].submitted_at,
            }
          : null,
      },
    });
  });

  /**
   * §5.11's "Submit". Records the files and queues the run.
   *
   * Nothing here decides whether it passed — `status` starts `queued` and
   * `passed` stays null until the worker has run the tests itself. A
   * submission is a request to be graded, not a claim to have passed.
   */
  router.post("/exercises/:id/submissions", requireAuth, async (req, res) => {
    const user = sessionUser(req);
    const assessmentId = id(req.params.id);

    const parsed = SubmissionBody.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0].message);

    const exists = await pool.query<{ id: string }>(
      `select a.id from assessments a
         join module_versions v on v.id = a.module_version_id
         join modules m on m.id = v.module_id
        where a.id = $1 and a.type = 'code'
          and v.status = 'published' and m.status = 'published'`,
      [assessmentId],
    );
    if (!exists.rows[0]) throw new HttpError(404, "Not found");

    const created = await pool.query<{ id: string; submitted_at: Date }>(
      `insert into code_submissions (user_id, assessment_id, files, status)
       values ($1, $2, $3, 'queued')
       returning id, submitted_at`,
      [user.id, assessmentId, JSON.stringify(parsed.data.files)],
    );

    res.status(201).json({
      submission: {
        id: created.rows[0].id,
        status: "queued",
        submittedAt: created.rows[0].submitted_at,
        testResults: null,
        passed: null,
      },
    });
  });

  /**
   * One submission's state, for the screen to poll while the worker runs.
   *
   * §6.1 step 4: the id comes from the browser, so ownership is confirmed by
   * the same `where` that reads the row — somebody else's submission is a 404,
   * not a 403, because saying "exists, but not yours" confirms it exists.
   */
  router.get("/submissions/:id", requireAuth, async (req, res) => {
    const user = sessionUser(req);
    const submissionId = id(req.params.id);

    const found = await pool.query<{
      id: string;
      assessment_id: string;
      status: string;
      test_results: unknown;
      passed: boolean | null;
      submitted_at: Date;
      completed_at: Date | null;
    }>(
      `select id, assessment_id, status, test_results, passed, submitted_at, completed_at
         from code_submissions
        where id = $1 and user_id = $2`,
      [submissionId, user.id],
    );
    if (!found.rows[0]) throw new HttpError(404, "Not found");
    const row = found.rows[0];

    /**
     * §5.11's AI feedback panel, and the two states it shows before there is
     * any: "Writing feedback on your test results…" while the job runs, and
     * "Feedback is queued." before it starts.
     *
     * Both queries are filtered by the session user as well as the submission
     * — the submission is already known to be theirs, but §6.1 step 3 says to
     * filter by the session's id rather than trust a chain of ids.
     */
    const output = await pool.query<{ id: string; content: unknown; flagged: boolean }>(
      `select o.id, o.content, (f.id is not null) as flagged
         from ai_outputs o
         left join ai_feedback_flags f
                on f.ai_output_id = o.id and f.user_id = $2
        where o.source_id = $1 and o.user_id = $2 and o.source_type = 'code_feedback'
        order by o.created_at desc
        limit 1`,
      [submissionId, user.id],
    );

    const job = await pool.query<{ status: string }>(
      `select status from ai_jobs
        where source_id = $1 and user_id = $2 and type = 'code_feedback'
        order by created_at desc
        limit 1`,
      [submissionId, user.id],
    );

    res.json({
      submission: {
        id: row.id,
        assessmentId: row.assessment_id,
        status: row.status,
        /**
         * Written by the worker from its own run. Whatever is in here, the
         * hidden cases are reported by name and outcome only — the learner
         * finds out that one failed, never what it checked.
         */
        testResults: row.test_results,
        passed: row.passed,
        submittedAt: row.submitted_at,
        completedAt: row.completed_at,
        /**
         * `none` when no feedback was asked for — a passing submission gets
         * none, because §7's hints are for a run that failed.
         */
        feedbackStatus: job.rows[0]?.status ?? "none",
        feedback: output.rows[0]
          ? {
              aiOutputId: output.rows[0].id,
              flagged: output.rows[0].flagged,
              ...readable(output.rows[0].content),
            }
          : null,
      },
    });
  });

  return router;
}
