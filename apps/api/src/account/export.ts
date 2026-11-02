import type { Pool } from "pg";

/**
 * "Download my data" (design.md §5.18).
 *
 * **This is the one endpoint where §6 rule 2 and the learner's own rights pull
 * in opposite directions**, so the shape of this file is the design: it is an
 * *allowlist*, table by table and column by column, not a sweep of everything
 * whose `user_id` matches.
 *
 * A sweep is the obvious implementation and it leaks. The learner owns rows in
 * twenty tables, and four of them hold things rule 2 says a learner response
 * never carries:
 *
 * | Not exported | Why |
 * |---|---|
 * | `ai_jobs` | `payload` carries the review checklist and the rubric for a milestone, and the prompt version it ran. Rule 2 names prompts and rubrics. The learner's *answer* is in `ai_outputs`, which is exported |
 * | `integrity_flags` | Rule 2 names integrity flags. They are *about* the learner and are still not theirs to read — an export is not a side door onto the admin's view |
 * | `ai_feedback_flags.admin_notes`, `.reviewed_by` | An admin's working notes on the learner's complaint, and which admin wrote them. The learner's own `reason` and the `status` are exported |
 * | `sessions`, `email_verification_tokens`, `password_reset_tokens`, `users.password_hash` | Credentials, not data. A token hash is a key to the account; handing someone a copy of their own keys is not a transparency feature |
 *
 * `github_connections.installation_id` is left out for the same reason: it is
 * the platform's credential for reaching the repository, not a fact about the
 * learner. The username and the date are what they gave us.
 *
 * Two things that look like leaks and are not:
 *
 * - **`assessment_attempts.answers`** is `{question_id: option_id}` — the
 *   learner's own choices. It is not the answer key, and nothing here joins to
 *   `question_options.is_correct`.
 * - **`code_submissions.test_results`** is stored *already redacted*: the
 *   worker calls `redact()` before writing, so a hidden case in that column has
 *   a name and a pass/fail and no expected or actual. Exporting the column is
 *   safe **because of where the redaction happens**, which is worth knowing
 *   before anyone moves it to read time.
 *
 * Every query names its columns (§6.1 step 6) and filters on the session user's
 * id (step 3). There is no id parameter anywhere in this file.
 */

/**
 * One row per module the learner has touched: the enrolment's start date and
 * the completion's outcome together, with a module that was started and never
 * finished still listed. Dropping those would quietly rewrite the record as
 * "only what went well".
 */
function mergeModules(
  completions: Record<string, unknown>[],
  enrolments: Record<string, unknown>[],
): Record<string, unknown>[] {
  const started = new Map(enrolments.map((e) => [e.module_id, e.started_at]));
  const merged: Record<string, unknown>[] = completions.map(({ module_id, ...rest }) => ({
    ...rest,
    started_at: started.get(module_id) ?? null,
  }));

  const finished = new Set(completions.map((c) => c.module_id));
  for (const { module_id, ...rest } of enrolments) {
    if (!finished.has(module_id)) {
      merged.push({ ...rest, method: null, score: null, completed_at: null, override_reason: null });
    }
  }
  return merged;
}

/** What the download contains. Kept as a type so a new table is a deliberate act. */
export interface DataExport {
  exportedAt: string;
  account: Record<string, unknown> | null;
  profile: Record<string, unknown> | null;
  placement: Record<string, unknown>[];
  roadmaps: Record<string, unknown>[];
  modules: Record<string, unknown>[];
  lessons: Record<string, unknown>[];
  quizAttempts: Record<string, unknown>[];
  codeSubmissions: Record<string, unknown>[];
  aiFeedback: Record<string, unknown>[];
  flagsRaised: Record<string, unknown>[];
  capstone: Record<string, unknown>[];
  certificates: Record<string, unknown>[];
  resume: Record<string, unknown> | null;
  resumeDetails: Record<string, unknown> | null;
  notifications: Record<string, unknown>[];
  github: Record<string, unknown> | null;
  /**
   * Said in the file itself, not only on the screen.
   *
   * Someone reading this JSON a year from now cannot see §5.18, so the export
   * states what it deliberately leaves out. An export that is silent about its
   * own gaps reads as the whole record.
   */
  notIncluded: string[];
}

const NOT_INCLUDED = [
  "Your password, session cookies, and any verification or reset links — these are credentials, not records.",
  "The prompts and checklists the AI was given. The feedback you were shown is included, under aiFeedback.",
  "Notes an administrator wrote while reviewing something you flagged, and any integrity review of a project.",
  "Learning content itself — lessons, quizzes and briefs are the platform's, and your answers to them are above.",
];

export async function buildExport(pool: Pool, userId: string): Promise<DataExport> {
  const rows = async (sql: string) => (await pool.query(sql, [userId])).rows as Record<string, unknown>[];
  const one = async (sql: string) => (await rows(sql))[0] ?? null;

  /**
   * Roadmaps and capstone projects carry their children as nested arrays,
   * because that is how the learner met them — but the children are fetched in
   * their own query and attached here rather than by a `json_agg` subquery
   * correlated on the parent's id. **pg-mem cannot see an outer alias from a
   * correlated subquery** (`column "r.id" does not exist`), a divergence
   * already on `packages/test-db`'s list, so the nested form would have been
   * untestable against the suite the rest of this file runs in.
   */
  const attach = <P extends Record<string, unknown>, C extends Record<string, unknown>>(
    parents: P[],
    children: C[],
    parentKey: string,
    childKey: string,
    as: string,
  ): Record<string, unknown>[] =>
    parents.map((parent) => {
      const mine = children
        .filter((child) => child[childKey] === parent[parentKey])
        .map(({ [childKey]: _omit, ...rest }) => rest);
      const { [parentKey]: _id, ...kept } = parent;
      return { ...kept, [as]: mine };
    });

  const roadmapRows = await rows(
    `select r.id, r.status, r.weekly_hours, r.ai_rationale, r.created_at, r.completed_at,
            cp.title as career_path, t.title as track
       from roadmaps r
       join career_paths cp on cp.id = r.career_path_id
       left join tracks t on t.id = r.track_id
      where r.user_id = $1
      order by r.created_at`,
  );

  /**
   * `added_reason` is exported because "Added after two quiz attempts" is a
   * decision the platform made *about* the learner, which is the kind of thing
   * an export exists for.
   */
  const itemRows = await rows(
    `select i.roadmap_id, mv.title as module, i.sort_order, i.source,
            i.added_reason, i.status
       from roadmap_items i
       join roadmaps r on r.id = i.roadmap_id
       join modules m on m.id = i.module_id
       join module_versions mv on mv.module_id = m.id and mv.status = 'published'
      where r.user_id = $1
      order by i.sort_order`,
  );

  const projectRows = await rows(
    `select p.id, p.repo_full_name, p.demo_url, p.status, p.started_at, p.completed_at,
            bv.title as brief, tech.name as technology
       from capstone_projects p
       join capstone_brief_versions bv on bv.id = p.brief_version_id
       join technologies tech on tech.id = p.technology_id
      where p.user_id = $1
      order by p.started_at`,
  );

  const attemptRows = await rows(
    `select ma.project_id, ms.title as milestone, ma.status, ma.commit_sha,
            ma.check_results, ma.explanation_answer, ma.created_at
       from milestone_attempts ma
       join capstone_projects p on p.id = ma.project_id
       join milestones ms on ms.id = ma.milestone_id
      where p.user_id = $1
      order by ma.created_at`,
  );

  return {
    exportedAt: new Date().toISOString(),

    account: await one(
      `select full_name, email, role, status, email_verified_at, created_at
         from users where id = $1`,
    ),

    profile: await one(
      `select experience_level, goal, weekly_hours, survey_answers,
              onboarding_step, onboarding_completed_at
         from learner_profiles where user_id = $1`,
    ),

    placement: await rows(
      `select p.results, p.taken_at, cp.title as career_path
         from placement_results p
         join career_paths cp on cp.id = p.career_path_id
        where p.user_id = $1
        order by p.taken_at`,
    ),

    /** The items come down with the roadmap, so the file reads the way it did. */
    roadmaps: attach(roadmapRows, itemRows, "id", "roadmap_id", "items"),

    /**
     * Completions and enrolments in one list, because a learner thinks in
     * modules rather than in two tables — merged here rather than by a
     * `union all` over a self-referencing left join, which pg-mem could not
     * resolve (`column "e.user_id" does not exist`).
     *
     * `override_reason` is included: if an admin corrected a score, the learner
     * is entitled to read why (§6 rule 10 makes the reason mandatory, and a
     * mandatory reason nobody can read is a formality).
     */
    modules: mergeModules(
      await rows(
        `select c.module_id, mv.title as module, c.method, c.score, c.completed_at,
                c.override_reason
           from module_completions c
           join module_versions mv on mv.id = c.module_version_id
          where c.user_id = $1`,
      ),
      await rows(
        `select e.module_id, mv.title as module, e.started_at
           from module_enrollments e
           join module_versions mv on mv.id = e.module_version_id
          where e.user_id = $1`,
      ),
    ),

    lessons: await rows(
      `select l.title as lesson, mv.title as module, p.completed_at
         from lesson_progress p
         join lessons l on l.id = p.lesson_id
         join module_versions mv on mv.id = l.module_version_id
        where p.user_id = $1
        order by p.completed_at`,
    ),

    /**
     * The learner's own answers. Nothing joins to `question_options.is_correct`.
     *
     * The label falls back to the skill because an assessment belongs to
     * **either** a module version or a skill (migration 0002): a placement quiz
     * has no module, and `mv.title` alone would export it as a nameless row.
     */
    quizAttempts: await rows(
      `select a.attempt_no, a.answers, a.score, a.passed, a.is_test_out, a.submitted_at,
              coalesce(mv.title, sk.name) as subject,
              (s.skill_id is not null) as was_placement
         from assessment_attempts a
         join assessments s on s.id = a.assessment_id
         left join module_versions mv on mv.id = s.module_version_id
         left join skills sk on sk.id = s.skill_id
        where a.user_id = $1
        order by a.submitted_at`,
    ),

    /** `test_results` is the redacted column the worker wrote. See the docblock. */
    codeSubmissions: await rows(
      `select c.files, c.status, c.passed, c.test_results, c.lint_results,
              c.submitted_at, c.completed_at, mv.title as module
         from code_submissions c
         join assessments s on s.id = c.assessment_id
         left join module_versions mv on mv.id = s.module_version_id
        where c.user_id = $1
        order by c.submitted_at`,
    ),

    /** What the AI told them. The prompt that produced it is not theirs. */
    aiFeedback: await rows(
      `select source_type, content, created_at
         from ai_outputs where user_id = $1 order by created_at`,
    ),

    /** Their own complaint and what came of it — not the admin's notes on it. */
    flagsRaised: await rows(
      `select reason, status, created_at from ai_feedback_flags
        where user_id = $1 order by created_at`,
    ),

    capstone: attach(projectRows, attemptRows, "id", "project_id", "milestoneAttempts"),

    certificates: await rows(
      `select public_code, type, recipient_name, title, details, status,
              issued_at, revoked_at, revoked_reason
         from certificates where user_id = $1 order by issued_at`,
    ),

    resume: await one(
      `select selected_evidence, content, ai_fields, generated_at, updated_at
         from resumes where user_id = $1 order by updated_at desc limit 1`,
    ),

    resumeDetails: await one(
      `select email, phone, city, links, education from resume_details where user_id = $1`,
    ),

    notifications: await rows(
      `select type, title, body, link, read_at, created_at
         from notifications where user_id = $1 order by created_at`,
    ),

    /** The username and the date. Not the installation id. */
    github: await one(
      `select github_username, connected_at from github_connections where user_id = $1`,
    ),

    notIncluded: NOT_INCLUDED,
  };
}
