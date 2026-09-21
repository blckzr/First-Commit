import type { Pool } from "pg";

/**
 * Everything the module page needs (design.md §5.9).
 *
 * **What is absent matters more than what is present.** No answer key, no
 * reference solution, no hidden test case, no rubric — those live in their own
 * tables and no query here touches them (AGENT.md §6 rule 2). The assessment is
 * described by title, type and passing score, which is all a learner needs to
 * decide whether to take it.
 */

export interface LessonSummary {
  id: string;
  sortOrder: number;
  title: string;
  /** design.md §13.3 `LessonContent`. Null when the lesson has not been written. */
  content: { blocks: unknown[] } | null;
  completed: boolean;
}

export interface AssessmentSummary {
  id: string;
  type: "quiz" | "code";
  title: string;
  instructions: string;
  passingScore: number;
  questionCount: number;
  /** The learner's best attempt so far, if they have made one. */
  bestScore: number | null;
  attempts: number;
  passed: boolean;
}

export interface ModulePage {
  moduleId: string;
  slug: string;
  kind: string;
  skillTitle: string;
  technologyName: string | null;
  /** The version the learner is taking, which is not always the published one. */
  versionId: string;
  versionNo: number;
  title: string;
  description: string;
  estimatedHours: number;
  lessons: LessonSummary[];
  assessments: AssessmentSummary[];
  enrolled: boolean;
  currentLessonId: string | null;
  completion: { method: string; score: number | null } | null;
  /** §5.9's two version notices need to tell these apart. */
  newerVersion: { versionNo: number; changeSummary: string } | null;
}

export async function buildModulePage(
  pool: Pool,
  moduleId: string,
  userId: string,
): Promise<ModulePage | null> {
  /**
   * The learner's own enrollment decides which version they see — §6 rule 6:
   * in-progress learners finish their version. Only someone who has never
   * started gets the currently published one.
   */
  const head = await pool.query<{
    module_id: string;
    slug: string;
    kind: string;
    skill_title: string;
    technology_name: string | null;
    version_id: string;
    version_no: number;
    title: string;
    description: string;
    estimated_hours: string;
    enrolled_version_id: string | null;
    current_lesson_id: string | null;
  }>(
    `select m.id            as module_id,
            m.slug,
            m.kind,
            s.name          as skill_title,
            tech.name       as technology_name,
            coalesce(e.module_version_id, pub.id)                 as version_id,
            coalesce(ev.version_no, pub.version_no)               as version_no,
            coalesce(ev.title, pub.title)                         as title,
            coalesce(ev.description, pub.description)             as description,
            coalesce(ev.estimated_hours, pub.estimated_hours)     as estimated_hours,
            e.module_version_id                                   as enrolled_version_id,
            e.current_lesson_id
       from modules m
       join skills s                on s.id = m.skill_id
       left join technologies tech  on tech.id = m.technology_id
       left join module_versions pub on pub.module_id = m.id and pub.status = 'published'
       left join module_enrollments e on e.module_id = m.id and e.user_id = $2
       left join module_versions ev  on ev.id = e.module_version_id
      where m.id = $1 and m.status <> 'draft'`,
    [moduleId, userId],
  );
  if (!head.rows[0] || !head.rows[0].version_id) return null;
  const row = head.rows[0];

  const lessons = await pool.query<{
    id: string;
    sort_order: number;
    title: string;
    content: { blocks: unknown[] } | null;
    completed_at: Date | null;
  }>(
    `select l.id, l.sort_order, l.title, l.content, lp.completed_at
       from lessons l
       left join lesson_progress lp on lp.lesson_id = l.id and lp.user_id = $2
      where l.module_version_id = $1
      order by l.sort_order`,
    [row.version_id, userId],
  );

  /**
   * Assessments, then their counts separately.
   *
   * The counts were correlated subqueries in the select list, which reads well
   * but is one of the places pg-mem and PostgreSQL disagree — so the tests
   * could not cover it at all. Three plain queries merged here run on both.
   *
   * `questionCount` is a count, not the questions. The quiz screen fetches
   * those separately, so a learner reading the module page never receives a
   * question list they could diff against an answer key.
   */
  const assessments = await pool.query<{
    id: string;
    type: "quiz" | "code";
    title: string;
    instructions: string;
    passing_score: string;
  }>(
    `select id, type, title, instructions, passing_score
       from assessments
      where module_version_id = $1
      order by sort_order`,
    [row.version_id],
  );

  const questionCounts = await pool.query<{ assessment_id: string; n: string }>(
    `select q.assessment_id, count(*) as n
       from quiz_questions q
       join assessments a on a.id = q.assessment_id
      where a.module_version_id = $1
      group by q.assessment_id`,
    [row.version_id],
  );

  const attemptStats = await pool.query<{
    assessment_id: string;
    best: string | null;
    n: string;
    passed: boolean | null;
  }>(
    `select at.assessment_id,
            max(at.score)   as best,
            count(*)        as n,
            bool_or(at.passed) as passed
       from assessment_attempts at
       join assessments a on a.id = at.assessment_id
      where a.module_version_id = $1 and at.user_id = $2
      group by at.assessment_id`,
    [row.version_id, userId],
  );

  const countOf = new Map(questionCounts.rows.map((r) => [r.assessment_id, Number(r.n)]));
  const statsOf = new Map(attemptStats.rows.map((r) => [r.assessment_id, r]));

  const completion = await pool.query<{ method: string; score: string | null }>(
    `select method, score from module_completions where user_id = $1 and module_id = $2`,
    [userId, moduleId],
  );

  /**
   * A newer published version than the one the learner holds. §5.9 has two
   * notices for this — one for a learner mid-module, one for a learner who
   * already passed — and both need the change summary.
   */
  const newer = await pool.query<{ version_no: number; change_summary: string }>(
    `select v.version_no, v.change_summary
       from module_versions v
      where v.module_id = $1 and v.status = 'published' and v.id <> $2`,
    [moduleId, row.version_id],
  );

  return {
    moduleId: row.module_id,
    slug: row.slug,
    kind: row.kind,
    skillTitle: row.skill_title,
    technologyName: row.technology_name,
    versionId: row.version_id,
    versionNo: row.version_no,
    title: row.title,
    description: row.description,
    estimatedHours: Number(row.estimated_hours),
    lessons: lessons.rows.map((l) => ({
      id: l.id,
      sortOrder: l.sort_order,
      title: l.title,
      content: l.content,
      completed: l.completed_at !== null,
    })),
    assessments: assessments.rows.map((a) => {
      const stats = statsOf.get(a.id);
      return {
        id: a.id,
        type: a.type,
        title: a.title,
        instructions: a.instructions,
        passingScore: Number(a.passing_score),
        questionCount: countOf.get(a.id) ?? 0,
        bestScore: stats?.best == null ? null : Number(stats.best),
        attempts: stats ? Number(stats.n) : 0,
        passed: stats?.passed === true,
      };
    }),
    enrolled: row.enrolled_version_id !== null,
    currentLessonId: row.current_lesson_id,
    completion: completion.rows[0]
      ? {
          method: completion.rows[0].method,
          score: completion.rows[0].score === null ? null : Number(completion.rows[0].score),
        }
      : null,
    newerVersion: newer.rows[0]
      ? { versionNo: newer.rows[0].version_no, changeSummary: newer.rows[0].change_summary }
      : null,
  };
}
