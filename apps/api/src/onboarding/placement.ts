import type { PoolClient } from "pg";

/**
 * Placement grading (design.md §5.4).
 *
 * A learner rates what they already know; anything rated "comfortable" is
 * checked before the platform believes it. **A rating on its own can never
 * clear a module** — every module on the path is required for the certificate,
 * so leaving one out would make the certificate unreachable. Passing the
 * skill's check writes `module_completions` with `method = 'tested_out'`, which
 * is real evidence and counts exactly as testing out of a single module does.
 *
 * This is the second place the platform writes evidence, so AGENT.md §6 rule 1
 * applies in full: the only thing that crosses the wire is
 * `{ questionId: optionId }`. The score is computed here from
 * `quiz_answer_keys`, and no learner endpoint may select from that table.
 *
 * Everything runs inside the caller's transaction, so a set of completions and
 * the placement result recording them are never half-written.
 */

/** The ratings a learner can give. Only `comfortable` triggers a check. */
export const RATINGS = ["new", "seen", "with_help", "comfortable"] as const;
export type Rating = (typeof RATINGS)[number];

export interface SkillCheckResult {
  skillId: string;
  slug: string;
  name: string;
  /** Null when the learner did not rate this skill "comfortable". */
  score: number | null;
  passed: boolean;
  /** Modules cleared. Empty unless `passed`. */
  clearedModuleIds: string[];
}

interface QuestionRow {
  id: string;
  assessment_id: string;
  correct_option_id: string;
}

/**
 * Grades every skill the learner claimed, and clears what they earned.
 *
 * `answers` is whatever the browser sent. Anything in it that is not a question
 * on a check for a skill *this learner rated comfortable on this path* is
 * ignored rather than trusted — the set of questions that counts is built here
 * from the database, not from the request.
 */
export async function gradePlacement(
  client: PoolClient,
  opts: {
    userId: string;
    careerPathId: string;
    ratings: Record<string, Rating>;
    answers: Record<string, string>;
  },
): Promise<SkillCheckResult[]> {
  const { userId, careerPathId, ratings, answers } = opts;

  /**
   * The skills on this path that have a check, with the core modules a pass
   * would clear. Built from the path, so a rating naming a skill that is not
   * on it clears nothing.
   */
  const skills = await client.query<{
    skill_id: string;
    slug: string;
    name: string;
    assessment_id: string;
    passing_score: string;
  }>(
    `select s.id as skill_id, s.slug, s.name, a.id as assessment_id, a.passing_score
       from path_skills ps
       join skills s on s.id = ps.skill_id
       join assessments a on a.skill_id = s.id
      where ps.career_path_id = $1
      order by ps.sort_order`,
    [careerPathId],
  );

  const results: SkillCheckResult[] = [];

  for (const skill of skills.rows) {
    const claimed = ratings[skill.slug] === "comfortable";
    if (!claimed) {
      results.push({
        skillId: skill.skill_id,
        slug: skill.slug,
        name: skill.name,
        score: null,
        passed: false,
        clearedModuleIds: [],
      });
      continue;
    }

    // The answer key, read here and never sent anywhere.
    const questions = await client.query<QuestionRow>(
      `select q.id, q.assessment_id, k.correct_option_id
         from quiz_questions q
         join quiz_answer_keys k on k.question_id = q.id
        where q.assessment_id = $1
        order by q.sort_order`,
      [skill.assessment_id],
    );

    if (questions.rows.length === 0) {
      results.push({
        skillId: skill.skill_id,
        slug: skill.slug,
        name: skill.name,
        score: null,
        passed: false,
        clearedModuleIds: [],
      });
      continue;
    }

    let correct = 0;
    for (const q of questions.rows) {
      if (answers[q.id] && answers[q.id] === q.correct_option_id) correct += 1;
    }
    const score = Math.round((correct / questions.rows.length) * 100);
    const passed = score >= Number(skill.passing_score);

    const clearedModuleIds: string[] = [];

    if (passed) {
      /**
       * The core modules for this skill on this path, with their published
       * version — `module_completions.module_version_id` records exactly what
       * was cleared (§6 rule 6).
       */
      const modules = await client.query<{ id: string; version_id: string }>(
        `select m.id, v.id as version_id
           from modules m
           join module_versions v on v.module_id = m.id and v.status = 'published'
           join path_skill_modules psm on psm.module_id = m.id
           join path_skills ps on ps.id = psm.path_skill_id
          where ps.career_path_id = $1
            and m.skill_id = $2
            and m.kind = 'core'
            and m.status = 'published'`,
        [careerPathId, skill.skill_id],
      );

      for (const module of modules.rows) {
        /**
         * `do nothing` on conflict, deliberately. A learner who already passed
         * a module keeps that completion — a placement check must never
         * overwrite a real pass with a weaker one, and re-running placement
         * must not move anybody's `completed_at`.
         */
        const written = await client.query(
          `insert into module_completions (user_id, module_id, module_version_id, method, score)
           values ($1, $2, $3, 'tested_out', $4)
           on conflict (user_id, module_id) do nothing
           returning module_id`,
          [userId, module.id, module.version_id, score],
        );
        if (written.rowCount) clearedModuleIds.push(module.id);
      }
    }

    results.push({
      skillId: skill.skill_id,
      slug: skill.slug,
      name: skill.name,
      score,
      passed,
      clearedModuleIds,
    });
  }

  return results;
}
