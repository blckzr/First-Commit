import { Router } from "express";
import { z } from "zod";
import type { Pool } from "pg";
import { HttpError } from "../middleware/errors.js";
import { requireAuth, sessionUser } from "../middleware/session.js";
import { buildModulePage } from "./build.js";
import { gradeQuizAttempt } from "./grade.js";

/**
 * The module page, lesson progress, and quizzes (design.md §5.9, §5.10).
 *
 * Two rules shape every endpoint here:
 *
 * **Evidence is written only by server code** (AGENT.md §6 rule 1). The quiz
 * endpoint accepts chosen option ids and nothing else — no score, no `passed`,
 * no completion. A test asserts that sending them changes nothing.
 *
 * **Secrets never reach a learner response** (§6 rule 2). Answer keys live in
 * `quiz_answer_keys` and are read only inside grading; the question endpoint
 * does not join to them, and a wrong answer's correct option is withheld so a
 * retake still means something (§5.10).
 */

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A path parameter is untrusted. Reject it before it reaches a uuid column. */
function id(value: unknown): string {
  if (typeof value !== "string" || !uuid.test(value)) throw new HttpError(404, "Not found");
  return value;
}

/**
 * The only thing a learner may send. `.strict()` is the point: a body carrying
 * `score` or `passed` alongside the answers is rejected outright rather than
 * silently ignored, so the refusal is visible in a test and in a log.
 */
const AttemptBody = z
  .object({
    answers: z.record(z.string(), z.string()),
    testOut: z.boolean().optional(),
  })
  .strict();

export function moduleRoutes(pool: Pool): Router {
  const router = Router();

  router.get("/modules/:moduleId", requireAuth, async (req, res) => {
    const user = sessionUser(req);
    const page = await buildModulePage(pool, id(req.params.moduleId), user.id);
    if (!page) throw new HttpError(404, "Not found");
    res.json({ module: page });
  });

  /**
   * Starting a module. Idempotent, and it pins the learner to the version
   * published *now* — §6 rule 6: they finish the version they started, and a
   * later publish never repoints them.
   */
  router.post("/modules/:moduleId/start", requireAuth, async (req, res) => {
    const user = sessionUser(req);
    const moduleId = id(req.params.moduleId);

    const version = await pool.query<{ id: string }>(
      `select v.id
         from module_versions v
         join modules m on m.id = v.module_id
        where v.module_id = $1 and v.status = 'published' and m.status = 'published'`,
      [moduleId],
    );
    if (!version.rows[0]) throw new HttpError(404, "Not found");

    const firstLesson = await pool.query<{ id: string }>(
      `select id from lessons where module_version_id = $1 order by sort_order limit 1`,
      [version.rows[0].id],
    );

    await pool.query(
      `insert into module_enrollments (user_id, module_id, module_version_id, current_lesson_id)
       values ($1, $2, $3, $4)
       on conflict (user_id, module_id) do nothing`,
      [user.id, moduleId, version.rows[0].id, firstLesson.rows[0]?.id ?? null],
    );

    res.json({ started: true });
  });

  /**
   * Marking a lesson read.
   *
   * Lesson progress is not evidence — it does not appear on a certificate or a
   * resume, and a learner saying "I read this" is the only signal there is. It
   * still has to be **their** lesson: the ownership check is that the lesson
   * belongs to a version they are enrolled in.
   */
  router.post("/lessons/:lessonId/complete", requireAuth, async (req, res) => {
    const user = sessionUser(req);
    const lessonId = id(req.params.lessonId);

    const lesson = await pool.query<{ module_version_id: string; sort_order: number }>(
      `select l.module_version_id, l.sort_order
         from lessons l
         join module_enrollments e
           on e.module_version_id = l.module_version_id and e.user_id = $2
        where l.id = $1`,
      [lessonId, user.id],
    );
    if (!lesson.rows[0]) {
      throw new HttpError(404, "Not found");
    }

    await pool.query(
      `insert into lesson_progress (user_id, lesson_id) values ($1, $2)
       on conflict (user_id, lesson_id) do nothing`,
      [user.id, lessonId],
    );

    /**
     * Move the bookmark forward, never back: §5.9's lesson list shows where the
     * learner is, and re-reading lesson 1 should not undo reaching lesson 3.
     *
     * Read the current position, then update — rather than one `update … from`,
     * which pg-mem cannot run, so the tests could not cover it.
     */
    const next = await pool.query<{ id: string }>(
      `select id from lessons
        where module_version_id = $1 and sort_order > $2
        order by sort_order limit 1`,
      [lesson.rows[0].module_version_id, lesson.rows[0].sort_order],
    );
    if (next.rows[0]) {
      const bookmark = await pool.query<{ sort_order: number }>(
        `select l.sort_order
           from module_enrollments e
           join lessons l on l.id = e.current_lesson_id
          where e.user_id = $1 and e.module_version_id = $2`,
        [user.id, lesson.rows[0].module_version_id],
      );
      const behind = bookmark.rows[0] === undefined
        || bookmark.rows[0].sort_order <= lesson.rows[0].sort_order;

      if (behind) {
        await pool.query(
          `update module_enrollments set current_lesson_id = $1
            where user_id = $2 and module_version_id = $3`,
          [next.rows[0].id, user.id, lesson.rows[0].module_version_id],
        );
      }
    }

    res.json({ completed: true });
  });

  /** The questions, without their answers. */
  router.get("/assessments/:assessmentId", requireAuth, async (req, res) => {
    const user = sessionUser(req);
    const assessmentId = id(req.params.assessmentId);

    const assessment = await pool.query<{
      id: string;
      type: string;
      title: string;
      instructions: string;
      passing_score: string;
      module_id: string;
      module_title: string;
    }>(
      `select a.id, a.type, a.title, a.instructions, a.passing_score,
              m.id as module_id, v.title as module_title
         from assessments a
         join module_versions v on v.id = a.module_version_id
         join modules m on m.id = v.module_id
        where a.id = $1 and m.status <> 'draft'`,
      [assessmentId],
    );
    if (!assessment.rows[0]) throw new HttpError(404, "Not found");
    const row = assessment.rows[0];
    if (row.type !== "quiz") throw new HttpError(404, "Not found");

    /**
     * Note what is not selected: `quiz_answer_keys` is not joined, and
     * `quiz_questions.explanation` is withheld until an answer has been graded.
     * An explanation frequently states the answer.
     */
    const questions = await pool.query<{ id: string; sort_order: number; prompt: string }>(
      `select id, sort_order, prompt from quiz_questions
        where assessment_id = $1 order by sort_order`,
      [assessmentId],
    );

    const options = await pool.query<{
      id: string;
      question_id: string;
      sort_order: number;
      text: string;
    }>(
      `select o.id, o.question_id, o.sort_order, o.text
         from quiz_options o
         join quiz_questions q on q.id = o.question_id
        where q.assessment_id = $1
        order by q.sort_order, o.sort_order`,
      [assessmentId],
    );

    const attempts = await pool.query<{ n: string }>(
      `select count(*) as n from assessment_attempts where user_id = $1 and assessment_id = $2`,
      [user.id, assessmentId],
    );

    res.json({
      assessment: {
        id: row.id,
        title: row.title,
        instructions: row.instructions,
        passingScore: Number(row.passing_score),
        moduleId: row.module_id,
        moduleTitle: row.module_title,
        attempts: Number(attempts.rows[0].n),
        questions: questions.rows.map((q) => ({
          id: q.id,
          prompt: q.prompt,
          options: options.rows
            .filter((o) => o.question_id === q.id)
            .map((o) => ({ id: o.id, text: o.text })),
        })),
      },
    });
  });

  /**
   * Submitting a quiz.
   *
   * The whole of §6 rule 1 lives in this handler: the body carries chosen
   * option ids, grading reads the answer key server-side, and the score and the
   * completion are written from what grading computed.
   */
  router.post("/assessments/:assessmentId/attempts", requireAuth, async (req, res) => {
    const user = sessionUser(req);
    const assessmentId = id(req.params.assessmentId);

    const parsed = AttemptBody.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, "Answer the questions before submitting.");

    const assessment = await pool.query<{
      type: string;
      passing_score: string;
      module_id: string;
      module_version_id: string;
    }>(
      `select a.type, a.passing_score, m.id as module_id, v.id as module_version_id
         from assessments a
         join module_versions v on v.id = a.module_version_id
         join modules m on m.id = v.module_id
        where a.id = $1 and m.status = 'published'`,
      [assessmentId],
    );
    if (!assessment.rows[0] || assessment.rows[0].type !== "quiz") {
      throw new HttpError(404, "Not found");
    }
    const row = assessment.rows[0];

    const client = await pool.connect();
    try {
      await client.query("begin");

      const result = await gradeQuizAttempt(client, {
        assessmentId,
        userId: user.id,
        moduleId: row.module_id,
        moduleVersionId: row.module_version_id,
        passingScore: Number(row.passing_score),
        submitted: parsed.data.answers,
        isTestOut: parsed.data.testOut === true,
      });

      /**
       * Taking the quiz is starting the module. Recorded after grading so a
       * learner who tests out cold is still enrolled at the version they were
       * graded against — otherwise their completion would point at a version
       * they were never enrolled in.
       */
      await client.query(
        `insert into module_enrollments (user_id, module_id, module_version_id)
         values ($1, $2, $3)
         on conflict (user_id, module_id) do nothing`,
        [user.id, row.module_id, row.module_version_id],
      );

      await client.query("commit");
      res.json({ result });
    } catch (err) {
      await client.query("rollback").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  });

  return router;
}
