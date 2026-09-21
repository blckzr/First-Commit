import type { PoolClient } from "pg";

/**
 * Quiz grading.
 *
 * **This is the first place the platform writes evidence**, so it is where
 * AGENT.md §6 rule 1 is either kept or broken: "No endpoint accepts a
 * completion, a score, or a `passed` flag as input." The only thing that
 * crosses the wire is `{ questionId: optionId }`. The score is computed here
 * from `quiz_answer_keys`, which no learner endpoint may ever select from.
 *
 * Everything runs inside one transaction the caller owns, so an attempt and the
 * completion it earns are never half-written.
 */

export interface GradedAnswer {
  questionId: string;
  /** What the learner chose, or null if they left it blank. */
  chosenOptionId: string | null;
  correct: boolean;
  /**
   * §5.10: "Correct answers are shown only for questions answered correctly,
   * so retakes remain meaningful." Null on a wrong answer — the endpoint must
   * not hand back the key to a question the learner is about to retake.
   */
  correctOptionId: string | null;
  explanation: string | null;
  linkedLessonId: string | null;
}

export interface GradeResult {
  attemptNo: number;
  score: number;
  correctCount: number;
  questionCount: number;
  /** How many right answers the passing score works out to, for §5.10's copy. */
  needed: number;
  passed: boolean;
  answers: GradedAnswer[];
  /** True when this attempt is what completed the module. */
  completedModule: boolean;
}

interface QuestionRow {
  id: string;
  sort_order: number;
  explanation: string;
  linked_lesson_id: string | null;
  correct_option_id: string;
}

export async function gradeQuizAttempt(
  client: PoolClient,
  {
    assessmentId,
    userId,
    moduleId,
    moduleVersionId,
    passingScore,
    submitted,
    isTestOut,
  }: {
    assessmentId: string;
    userId: string;
    moduleId: string;
    moduleVersionId: string;
    passingScore: number;
    /** What the browser sent: question id to chosen option id. Nothing else. */
    submitted: Record<string, string>;
    isTestOut: boolean;
  },
): Promise<GradeResult> {
  const questions = await client.query<QuestionRow>(
    `select q.id, q.sort_order, q.explanation, q.linked_lesson_id, k.correct_option_id
       from quiz_questions q
       join quiz_answer_keys k on k.question_id = q.id
      where q.assessment_id = $1
      order by q.sort_order`,
    [assessmentId],
  );
  if (questions.rowCount === 0) {
    throw new Error(`Assessment ${assessmentId} has no questions to grade`);
  }

  /**
   * Every option id that belongs to this assessment. An answer naming an option
   * from a different question — or one that does not exist — is not an error to
   * report, it is simply not the correct option, so it grades as wrong. The
   * lookup exists so a stray id can never accidentally match.
   */
  const options = await client.query<{ id: string; question_id: string }>(
    `select o.id, o.question_id
       from quiz_options o
       join quiz_questions q on q.id = o.question_id
      where q.assessment_id = $1`,
    [assessmentId],
  );
  const optionBelongsTo = new Map(options.rows.map((o) => [o.id, o.question_id]));

  const answers: GradedAnswer[] = questions.rows.map((q) => {
    const chosen = submitted[q.id];
    // Only an option of *this* question counts as an answer at all.
    const chosenOptionId = chosen && optionBelongsTo.get(chosen) === q.id ? chosen : null;
    const correct = chosenOptionId === q.correct_option_id;

    return {
      questionId: q.id,
      chosenOptionId,
      correct,
      correctOptionId: correct ? q.correct_option_id : null,
      explanation: correct ? q.explanation : null,
      // The lesson to go back to is useful precisely when the answer was wrong.
      linkedLessonId: correct ? null : q.linked_lesson_id,
    };
  });

  const questionCount = questions.rows.length;
  const correctCount = answers.filter((a) => a.correct).length;
  const score = Math.round((correctCount / questionCount) * 10000) / 100;
  const needed = Math.ceil((passingScore / 100) * questionCount);
  const passed = score >= passingScore;

  const previous = await client.query<{ next: string }>(
    `select coalesce(max(attempt_no), 0) + 1 as next
       from assessment_attempts where user_id = $1 and assessment_id = $2`,
    [userId, assessmentId],
  );
  const attemptNo = Number(previous.rows[0].next);

  await client.query(
    `insert into assessment_attempts
       (user_id, assessment_id, attempt_no, answers, score, passed, is_test_out)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [
      userId,
      assessmentId,
      attemptNo,
      // Stored as the learner answered, for "Review answers" and for an admin
      // looking into a dispute. Not read back for grading.
      JSON.stringify(Object.fromEntries(answers.map((a) => [a.questionId, a.chosenOptionId]))),
      score,
      passed,
      isTestOut,
    ],
  );

  let completedModule = false;
  if (passed) {
    /**
     * The evidence row. `method` distinguishes working through the module from
     * testing out of it, and §8 shows them differently ("Passed, 88%" against
     * "Tested out").
     *
     * On a retake the better score wins and the method is left alone: how a
     * learner first completed a module is a fact, and a later review pass does
     * not turn a test-out into a normal pass. `greatest` ignores nulls, so a
     * scoreless test-out is not treated as zero.
     */
    const already = await client.query(
      `select 1 from module_completions where user_id = $1 and module_id = $2`,
      [userId, moduleId],
    );
    completedModule = already.rowCount === 0;

    await client.query(
      `insert into module_completions (user_id, module_id, module_version_id, method, score)
       values ($1, $2, $3, $4, $5)
       on conflict (user_id, module_id) do update
         set score = greatest(module_completions.score, excluded.score)`,
      [userId, moduleId, moduleVersionId, isTestOut ? "tested_out" : "passed", score],
    );
  }

  return { attemptNo, score, correctCount, questionCount, needed, passed, answers, completedModule };
}
