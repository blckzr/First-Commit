import { Router } from "express";
import { z } from "zod";
import type { Pool } from "pg";
import { HttpError } from "../middleware/errors.js";
import { requireAdmin, requireAuth } from "../middleware/session.js";

/**
 * The quiz editor (design.md §6.3's Assessment tab).
 *
 * **Only ever a draft's quiz.** A published quiz is what learners are being
 * tested on right now, and `assessment_attempts` references it with
 * `on delete restrict` — so editing one is neither allowed nor, in the case of
 * replacing its questions, possible. A draft's quiz has no attempts by
 * definition: nobody can take an unpublished version.
 *
 * That single fact is what makes the write here a **whole-quiz replace** rather
 * than a pile of per-question endpoints. `quiz_questions` is keyed by
 * `(assessment_id, sort_order)`, so reordering by individual updates collides
 * with itself halfway through; and an author who moved two questions made one
 * edit, not two.
 *
 * **§6 rule 2 is the thing to keep in view**: `quiz_answer_keys` is on the
 * never-send list. This file returns answer keys because it is admin-only and
 * an editor cannot work without them — which makes it exactly the file where a
 * copied query could leak one, so the learner-facing shape is asserted
 * separately in `security.test.ts`.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const id = (value: unknown): string => {
  if (typeof value !== "string" || !UUID.test(value)) throw new HttpError(404, "Not found");
  return value;
};

const Question = z
  .object({
    prompt: z.string().min(1, "Every question needs a prompt."),
    explanation: z.string().default(""),
    options: z
      .array(z.string().min(1, "An option cannot be blank."))
      .min(2, "A question needs at least two options.")
      .max(6),
    /** Index into `options`. An id would be a lie: these do not exist yet. */
    correctIndex: z.number().int().min(0),
  })
  .refine((q) => q.correctIndex < q.options.length, {
    message: "The correct answer must be one of the options.",
    path: ["correctIndex"],
  });

const Quiz = z.object({
  title: z.string().min(1, "Give the quiz a title."),
  instructions: z.string().default(""),
  passingScore: z.number().min(0).max(100),
  questions: z.array(Question).max(50),
});

export function adminQuizRoutes(pool: Pool): Router {
  const router = Router();

  const base = "/admin/modules/:id/versions/:versionId/quiz";

  /** The quiz as it stands, answer keys included (§6.3's Assessment tab). */
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
    }>(
      `select id, title, instructions, passing_score
         from assessments
        where module_version_id = $1 and type = 'quiz'`,
      [versionId],
    );

    if (!assessment.rows[0]) {
      res.json({ quiz: null, editable: version.rows[0].status === "draft" });
      return;
    }

    const questions = await pool.query(
      `select q.id, q.sort_order, q.prompt, q.explanation, k.correct_option_id
         from quiz_questions q
         left join quiz_answer_keys k on k.question_id = q.id
        where q.assessment_id = $1
        order by q.sort_order`,
      [assessment.rows[0].id],
    );

    const options = await pool.query(
      `select o.id, o.question_id, o.sort_order, o.text
         from quiz_options o
         join quiz_questions q on q.id = o.question_id
        where q.assessment_id = $1
        order by o.question_id, o.sort_order`,
      [assessment.rows[0].id],
    );

    res.json({
      editable: version.rows[0].status === "draft",
      quiz: {
        id: assessment.rows[0].id,
        title: assessment.rows[0].title,
        instructions: assessment.rows[0].instructions,
        passingScore: Number(assessment.rows[0].passing_score),
        questions: questions.rows.map((question) => {
          const mine = options.rows.filter((o) => o.question_id === question.id);
          return {
            prompt: question.prompt,
            explanation: question.explanation,
            options: mine.map((o) => o.text),
            /**
             * An index, not an id. The editor rewrites the whole quiz, so the
             * ids it was given would not survive the round trip — handing them
             * back would invite a client to send one that no longer exists.
             */
            correctIndex: Math.max(
              0,
              mine.findIndex((o) => o.id === question.correct_option_id),
            ),
          };
        }),
      },
    });
  });

  /**
   * Replace the draft's quiz.
   *
   * Deleting and reinserting is safe **only because this is a draft**: no
   * `assessment_attempts` row can reference it, since nobody can take an
   * unpublished version. On a published quiz the `on delete restrict` on
   * `assessment_attempts.assessment_id` would refuse anyway — the schema is the
   * backstop, and the `status = 'draft'` check is what turns that into a clear
   * 404 instead of a foreign-key error.
   */
  router.put(base, requireAuth, requireAdmin, async (req, res) => {
    const moduleId = id(req.params.id);
    const versionId = id(req.params.versionId);

    const parsed = Quiz.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, parsed.error.issues[0]?.message ?? "Check the quiz.");
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
        `select id from assessments where module_version_id = $1 and type = 'quiz'`,
        [versionId],
      );

      let assessmentId: string;
      if (existing.rows[0]) {
        assessmentId = existing.rows[0].id;
        await client.query(
          `update assessments set title = $2, instructions = $3, passing_score = $4
            where id = $1`,
          [assessmentId, parsed.data.title, parsed.data.instructions, parsed.data.passingScore],
        );
        /*
         * Questions cascade to options and answer keys, so one delete clears
         * the whole tree. The assessment row itself stays: an exercise and a
         * rubric may hang off this version too, and recreating it would churn
         * ids nothing asked to change.
         */
        await client.query(`delete from quiz_questions where assessment_id = $1`, [assessmentId]);
      } else {
        const created = await client.query<{ id: string }>(
          `insert into assessments (module_version_id, type, title, instructions, passing_score)
           values ($1, 'quiz', $2, $3, $4)
           returning id`,
          [versionId, parsed.data.title, parsed.data.instructions, parsed.data.passingScore],
        );
        assessmentId = created.rows[0].id;
      }

      for (const [index, question] of parsed.data.questions.entries()) {
        const created = await client.query<{ id: string }>(
          `insert into quiz_questions (assessment_id, sort_order, prompt, explanation)
           values ($1, $2, $3, $4)
           returning id`,
          [assessmentId, index, question.prompt, question.explanation],
        );
        const questionId = created.rows[0].id;

        const optionIds: string[] = [];
        for (const [optionIndex, text] of question.options.entries()) {
          const option = await client.query<{ id: string }>(
            `insert into quiz_options (question_id, sort_order, text)
             values ($1, $2, $3)
             returning id`,
            [questionId, optionIndex, text],
          );
          optionIds.push(option.rows[0].id);
        }

        await client.query(
          `insert into quiz_answer_keys (question_id, correct_option_id) values ($1, $2)`,
          [questionId, optionIds[question.correctIndex]],
        );
      }

      await client.query("commit");
      res.json({ questions: parsed.data.questions.length });
    } catch (err) {
      await client.query("rollback").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  });

  return router;
}
