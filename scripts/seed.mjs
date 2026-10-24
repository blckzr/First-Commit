#!/usr/bin/env node
/**
 * Loads the seed curriculum into the database.
 *
 *   node --env-file=apps/api/.env scripts/seed.mjs
 *   node --env-file=apps/api/.env scripts/seed.mjs --dry-run
 *
 * The content lives in supabase/seed/ as data; this file is only the loader.
 *
 * **Idempotent by slug.** Every insert is an upsert keyed on the natural key,
 * so running it twice changes nothing and running it after editing the content
 * file applies the edit. That matters because this is the only way content
 * exists until the admin editors are built — re-running it is the edit loop.
 *
 * **It never touches learner data.** No deletes, and nothing in `roadmaps`,
 * `module_completions`, `users` or any other table holding evidence. Content
 * rows that would have to be removed are left alone and reported instead:
 * `modules` and `module_versions` are referenced by evidence with
 * `on delete restrict` (AGENT.md §6 rule 5), so deleting content is an archive,
 * not a delete, and it is not this script's job.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import {
  careerPath,
  modules,
  pathSkills,
  skills,
  technologies,
  tracks,
} from "../supabase/seed/junior-web-developer.mjs";
import { lessons as lessonsBySlug } from "../supabase/seed/lessons.mjs";
import { placement } from "../supabase/seed/placement.mjs";
import { exercises } from "../supabase/seed/exercises.mjs";
import { capstones } from "../supabase/seed/capstone.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
void ROOT;

const dryRun = process.argv.includes("--dry-run");

let client;

/** Only needed for a real run — `--dry-run` checks the content with no database. */
function connect() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error(
      "DATABASE_URL is not set.\n\n" +
        "  Copy apps/api/.env.example to apps/api/.env, paste your connection\n" +
        "  string, then run:\n\n" +
        "    npm run db:seed\n\n" +
        "  To check the content without a database:\n\n" +
        "    node scripts/seed.mjs --dry-run\n",
    );
    process.exit(1);
  }
  client = new pg.Client({
    connectionString: url,
    ssl:
      url.includes("localhost") || url.includes("127.0.0.1")
        ? false
        : { rejectUnauthorized: false },
  });
  return client.connect();
}

const ok = (s) => `  ✓ ${s}`;

/** Upserts one row and returns its id. */
async function upsert(sql, values) {
  const { rows } = await client.query(sql, values);
  return rows[0].id;
}

/**
 * Checks the content before writing any of it.
 *
 * The Roadmap AI is validated against prerequisite order (AGENT.md §7), which
 * is only meaningful if the prerequisites themselves are sound. A cycle here
 * would mean no valid ordering exists at all, and the AI would be blamed for it.
 */
/**
 * How far to rotate a question's options before storing them, from the prompt.
 *
 * Deterministic on purpose — a random shuffle would reorder every live quiz on
 * each re-seed, and `quiz_options` is upserted by `(question_id, sort_order)`.
 */
function rotate(seed, length) {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h % length;
}

function validate() {
  const problems = [];
  const bySlug = new Map(modules.map((m) => [m.slug, m]));
  const skillSlugs = new Set(skills.map((s) => s.slug));
  const techSlugs = new Set(technologies.map((t) => t.slug));
  const trackTitles = new Set(tracks.map((t) => t.title));
  const placed = new Map(pathSkills.map((p) => [p.skill, p]));

  for (const skill of skillSlugs) {
    if (!placed.has(skill)) problems.push(`skill "${skill}" is never placed in the path`);
  }
  for (const p of pathSkills) {
    if (!skillSlugs.has(p.skill)) problems.push(`path skill "${p.skill}" is not a defined skill`);
    if (p.layer === "concept" && !trackTitles.has(p.track)) {
      problems.push(`concept skill "${p.skill}" names unknown track "${p.track}"`);
    }
    if (p.layer === "core" && p.track) {
      problems.push(`core skill "${p.skill}" must not belong to a track`);
    }
  }

  for (const m of modules) {
    if (!skillSlugs.has(m.skill)) problems.push(`module "${m.slug}" names unknown skill "${m.skill}"`);
    if (!placed.has(m.skill)) problems.push(`module "${m.slug}" is in a skill with no place in the path`);
    if ((m.kind === "technology") !== Boolean(m.technology)) {
      problems.push(`module "${m.slug}": kind "${m.kind}" and technology must agree`);
    }
    if (m.technology && !techSlugs.has(m.technology)) {
      problems.push(`module "${m.slug}" names unknown technology "${m.technology}"`);
    }
    for (const req of m.requires) {
      if (!bySlug.has(req)) problems.push(`module "${m.slug}" requires unknown module "${req}"`);
    }
    const lessonCount = (lessonsBySlug[m.slug] ?? []).length;
    for (const [i, q] of (m.quiz?.questions ?? []).entries()) {
      if (q.correct < 0 || q.correct >= q.options.length) {
        problems.push(`module "${m.slug}": question ${i + 1}'s correct answer is out of range`);
      }
      /**
       * §5.10's failed-quiz screen lists "topics to review" with the lesson to
       * go back to, so a question pointing at a lesson that does not exist
       * would leave a dead link on the one screen a struggling learner needs.
       */
      if (q.lesson !== undefined && (q.lesson < 1 || q.lesson > lessonCount)) {
        problems.push(
          `module "${m.slug}": question ${i + 1} links to lesson ${q.lesson}, but it has ${lessonCount}`,
        );
      }
    }
  }

  // A prerequisite cycle means no valid roadmap order exists.
  const state = new Map();
  const walk = (slug, trail) => {
    if (state.get(slug) === "done") return;
    if (state.get(slug) === "open") {
      problems.push(`prerequisite cycle: ${[...trail, slug].join(" → ")}`);
      return;
    }
    state.set(slug, "open");
    for (const req of bySlug.get(slug)?.requires ?? []) walk(req, [...trail, slug]);
    state.set(slug, "done");
  };
  for (const m of modules) walk(m.slug, []);

  /**
   * A core module must not depend on a track's concept module: a learner on the
   * other track would never be able to finish the core layer.
   *
   * Returns null for anything already reported above, so one bad reference does
   * not hide the rest of the problems.
   */
  const layerOf = (slug) => placed.get(bySlug.get(slug)?.skill)?.layer ?? null;
  for (const m of modules) {
    if (layerOf(m.slug) !== "core") continue;
    for (const req of m.requires) {
      const layer = layerOf(req);
      if (layer !== null && layer !== "core") {
        problems.push(`core module "${m.slug}" requires "${req}", which is not core`);
      }
    }
  }

  /**
   * Placement checks. A check for a skill that is not on the path would never
   * be reachable, and one whose skill has no core modules could never clear
   * anything — both are authoring mistakes worth catching before they load.
   */
  const coreSkills = new Set(modules.filter((m) => m.kind === "core").map((m) => m.skill));

  for (const [slug, check] of Object.entries(placement)) {
    if (!skillSlugs.has(slug)) {
      problems.push(`placement check "${slug}": no such skill`);
      continue;
    }
    if (!coreSkills.has(slug)) {
      problems.push(
        `placement check "${slug}": that skill has no core modules, so passing it would clear nothing`,
      );
    }
    for (const [i, q] of check.questions.entries()) {
      if (q.correct < 0 || q.correct >= q.options.length) {
        problems.push(`placement check "${slug}": question ${i + 1}'s correct answer is out of range`);
      }
      if (q.lesson !== undefined) {
        problems.push(
          `placement check "${slug}": question ${i + 1} links to a lesson. A placement question ` +
            `must be answerable by someone who learned the skill elsewhere.`,
        );
      }
    }
    /**
     * Sized to what a pass buys: roughly 2.5 questions per module cleared.
     * Too few and a module of certificate credit costs one or two answers.
     */
    const covered = modules.filter((m) => m.kind === "core" && m.skill === slug).length;
    if (check.questions.length < covered * 2) {
      problems.push(
        `placement check "${slug}": ${check.questions.length} questions clears ${covered} modules — ` +
          `at least ${covered * 2} needed`,
      );
    }
  }

  /**
   * Coding exercises. An exercise on a module that does not exist is an
   * authoring mistake; so is one with no hidden test case, because a solution
   * that special-cases the visible inputs would pass it.
   */
  const moduleSlugs = new Set(modules.map((m) => m.slug));
  for (const [slug, exercise] of Object.entries(exercises)) {
    if (!moduleSlugs.has(slug)) {
      problems.push(`exercise "${slug}": no such module`);
      continue;
    }
    if (!exercise.starterFiles?.length) {
      problems.push(`exercise "${slug}": no starter files, so there is nothing to open`);
    }
    if (!exercise.testCases?.length) {
      problems.push(`exercise "${slug}": no test cases, so nothing decides whether it passed`);
    }
    if (!exercise.testCases?.some((t) => t.visible)) {
      problems.push(
        `exercise "${slug}": every test case is hidden, so a failure would be unreadable (§5.11)`,
      );
    }
    if (!exercise.testCases?.some((t) => !t.visible)) {
      problems.push(
        `exercise "${slug}": no hidden test case — a solution that hard-codes the visible answers would pass`,
      );
    }
    if (!exercise.referenceSolution?.length) {
      problems.push(`exercise "${slug}": no reference solution to check the tests against`);
    }
  }

  /**
   * Capstone briefs. Everything checked here is something that would otherwise
   * surface as a broken screen rather than a seed error: a brief on a track
   * that does not exist has nowhere to appear, a milestone whose "related
   * modules" name nothing leaves §5.14's panel empty, and a brief with no
   * starter template for a technology the track offers sends that learner to a
   * dead button on stage 2.
   */
  const techBySlug = new Map(technologies.map((t) => [t.slug, t]));
  const trackTechnologies = new Map(
    tracks.map((t) => [t.title, new Set((t.decision?.options ?? []).map((o) => o.technology))]),
  );

  for (const brief of capstones) {
    const where = `capstone "${brief.slug}"`;
    if (!trackTitles.has(brief.track)) {
      problems.push(`${where}: no track called "${brief.track}"`);
    }

    const offered = trackTechnologies.get(brief.track);
    for (const slug of Object.keys(brief.starterTemplates ?? {})) {
      if (!techBySlug.has(slug)) problems.push(`${where}: unknown technology "${slug}"`);
      else if (offered && offered.size > 0 && !offered.has(slug)) {
        problems.push(`${where}: "${slug}" is not offered on the ${brief.track} track`);
      }
    }
    for (const slug of offered ?? []) {
      if (!brief.starterTemplates?.[slug]) {
        problems.push(
          `${where}: no starter template for "${slug}", which the ${brief.track} track offers — ` +
            `a learner who chose it would reach a dead button on §5.14 stage 2`,
        );
      }
    }

    if (!brief.milestones?.length) {
      problems.push(`${where}: no milestones, so there is nothing to track`);
    }

    for (const [i, m] of (brief.milestones ?? []).entries()) {
      const at = `${where} milestone ${i + 1} ("${m.title}")`;
      if (!m.acceptanceCriteria?.length) {
        problems.push(`${at}: no acceptance criteria, so the learner is told nothing to aim at`);
      }
      if (!m.checks?.length) {
        problems.push(`${at}: no checks, so nothing decides whether it is done`);
      }
      for (const module of m.modules ?? []) {
        if (!bySlug.has(module)) problems.push(`${at}: names unknown module "${module}"`);
      }
      for (const check of m.checks ?? []) {
        if (!["file_exists", "workflow_test", "deployment_url"].includes(check.type)) {
          problems.push(`${at}: unknown check type "${check.type}"`);
        }
        if (check.type === "file_exists" && !check.config?.path) {
          problems.push(`${at}: a file_exists check needs a path`);
        }
        if (check.type === "workflow_test" && !(check.config?.workflow && check.config?.test_name)) {
          problems.push(`${at}: a workflow_test check needs a workflow and a test_name`);
        }
      }
    }

    /**
     * The last milestone is the one §5.14 says asks for the live address, and
     * a `deployment_url` check is what confirms it loads. Without one the
     * project can be "complete" while nothing was ever published.
     */
    const last = brief.milestones?.[brief.milestones.length - 1];
    if (last && !last.checks?.some((c) => c.type === "deployment_url")) {
      problems.push(
        `${where}: the last milestone has no deployment_url check, so a project could finish ` +
          `without anything being live`,
      );
    }
  }

  return problems;
}

/**
 * Writes a question set, its options and its answer keys.
 *
 * Shared by module quizzes and placement checks so the two cannot drift —
 * most importantly the option rotation, which is the thing standing between a
 * learner and passing every assessment on the platform by clicking the top
 * answer.
 */
async function writeQuestions(assessmentId, questions, lessonIds = []) {
for (const [i, q] of questions.entries()) {
  const questionId = await upsert(
    `insert into quiz_questions (assessment_id, sort_order, prompt, explanation, linked_lesson_id)
     values ($1, $2, $3, $4, $5)
     on conflict (assessment_id, sort_order) do update
       set prompt = excluded.prompt,
           explanation = excluded.explanation,
           linked_lesson_id = excluded.linked_lesson_id
     returning id`,
    [assessmentId, i, q.prompt, q.explanation, q.lesson ? lessonIds[q.lesson - 1] : null],
  );

  /**
   * **The stored order is rotated, so the answer is not always first.**
   *
   * Writing the correct option first is the natural way to author a
   * question, and every question in this file does it — which meant every
   * answer sat at position 0 in the database too. `GET /assessments/:id`
   * returns options in `sort_order`, so a learner could pass every quiz on
   * the platform by clicking the top option, and the pass would be written
   * to `module_completions` as evidence (§6 rule 1). Real evidence, worth
   * nothing.
   *
   * The rotation comes from the prompt, so it is the same on every
   * re-seed: the upsert below stays idempotent, and a learner part-way
   * through a quiz does not watch the options move.
   */
  const shift = rotate(q.prompt, q.options.length);
  const ordered = q.options.map((_, j) => q.options[(j + shift) % q.options.length]);
  const correctAt = (q.correct - shift + q.options.length) % q.options.length;

  const optionIds = [];
  for (const [j, text] of ordered.entries()) {
    optionIds.push(
      await upsert(
        `insert into quiz_options (question_id, sort_order, text) values ($1, $2, $3)
         on conflict (question_id, sort_order) do update set text = excluded.text
         returning id`,
        [questionId, j, text],
      ),
    );
  }

  // The answer key lives in its own table so a learner endpoint selecting
  // from quiz_options can never return it (AGENT.md §6 rule 2).
  await client.query(
    `insert into quiz_answer_keys (question_id, correct_option_id) values ($1, $2)
     on conflict (question_id) do update set correct_option_id = excluded.correct_option_id`,
    [questionId, optionIds[correctAt]],
  );
}
}

async function seed() {
  const problems = validate();
  if (problems.length > 0) {
    console.error("\nThe seed content is not valid:\n");
    for (const p of problems) console.error(`  ✗ ${p}`);
    console.error("");
    process.exit(1);
  }
  console.log(ok(`content checks pass (${modules.length} modules)`));

  if (dryRun) {
    console.log("\n  --dry-run: nothing was written.\n");
    return;
  }

  await connect();
  await client.query("begin");

  const pathId = await upsert(
    `insert into career_paths (slug, title, description, status, published_at)
     values ($1, $2, $3, 'published', now())
     on conflict (slug) do update
       set title = excluded.title,
           description = excluded.description,
           status = 'published',
           published_at = coalesce(career_paths.published_at, now())
     returning id`,
    [careerPath.slug, careerPath.title, careerPath.description],
  );
  console.log(ok(`career path: ${careerPath.title}`));

  const techIds = new Map();
  for (const t of technologies) {
    techIds.set(
      t.slug,
      await upsert(
        `insert into technologies (slug, name, description) values ($1, $2, $3)
         on conflict (slug) do update set name = excluded.name, description = excluded.description
         returning id`,
        [t.slug, t.name, t.description],
      ),
    );
  }
  console.log(ok(`${technologies.length} technologies`));

  const skillIds = new Map();
  for (const s of skills) {
    skillIds.set(
      s.slug,
      await upsert(
        `insert into skills (slug, name, description) values ($1, $2, $3)
         on conflict (slug) do update set name = excluded.name, description = excluded.description
         returning id`,
        [s.slug, s.name, s.description],
      ),
    );
  }
  console.log(ok(`${skills.length} skills`));

  const trackIds = new Map();
  for (const t of tracks) {
    const trackId = await upsert(
      `insert into tracks (career_path_id, title, description, audience, status, sort_order)
       values ($1, $2, $3, $4, 'published', $5)
       on conflict (career_path_id, title) do update
         set description = excluded.description,
             audience = excluded.audience,
             status = 'published',
             sort_order = excluded.sort_order
       returning id`,
      [pathId, t.title, t.description, t.audience, t.sortOrder],
    );
    trackIds.set(t.title, trackId);

    // technology_decisions has no natural unique key, so match on (track, title).
    const existing = await client.query(
      `select id from technology_decisions where track_id = $1 and title = $2`,
      [trackId, t.decision.title],
    );
    const decisionId =
      existing.rows[0]?.id ??
      (await upsert(
        `insert into technology_decisions (track_id, title, sort_order) values ($1, $2, 0) returning id`,
        [trackId, t.decision.title],
      ));

    for (const option of t.decision.options) {
      await client.query(
        `insert into decision_options (decision_id, technology_id, comparison, status)
         values ($1, $2, $3, 'published')
         on conflict (decision_id, technology_id) do update
           set comparison = excluded.comparison, status = 'published'`,
        [decisionId, techIds.get(option.technology), JSON.stringify(option.comparison)],
      );
    }
  }
  console.log(ok(`${tracks.length} tracks, each with a technology decision`));

  const pathSkillIds = new Map();
  for (const p of pathSkills) {
    const trackId = p.track ? trackIds.get(p.track) : null;
    // `unique nulls not distinct` makes the core rows (track_id null) conflict
    // properly, which a plain unique constraint would not.
    pathSkillIds.set(
      p.skill,
      await upsert(
        `insert into path_skills (career_path_id, track_id, skill_id, layer, sort_order)
         values ($1, $2, $3, $4, $5)
         on conflict (career_path_id, track_id, skill_id) do update set sort_order = excluded.sort_order
         returning id`,
        [pathId, trackId, skillIds.get(p.skill), p.layer, p.sortOrder],
      ),
    );
  }
  console.log(ok(`${pathSkills.length} skills placed in the path`));

  const moduleIds = new Map();
  for (const m of modules) {
    moduleIds.set(
      m.slug,
      await upsert(
        `insert into modules (skill_id, kind, technology_id, slug, status)
         values ($1, $2, $3, $4, 'published')
         on conflict (slug) do update
           set skill_id = excluded.skill_id,
               kind = excluded.kind,
               technology_id = excluded.technology_id,
               status = 'published'
         returning id`,
        [
          skillIds.get(m.skill),
          m.kind,
          m.technology ? techIds.get(m.technology) : null,
          m.slug,
        ],
      ),
    );
  }

  // Prerequisites and path placement, once every module id exists.
  for (const m of modules) {
    const moduleId = moduleIds.get(m.slug);

    for (const req of m.requires) {
      await client.query(
        `insert into module_prerequisites (module_id, requires_module_id) values ($1, $2)
         on conflict do nothing`,
        [moduleId, moduleIds.get(req)],
      );
    }

    await client.query(
      `insert into path_skill_modules (path_skill_id, module_id, sort_order, required_for_certificate)
       values ($1, $2, $3, $4)
       on conflict (path_skill_id, module_id) do update
         set sort_order = excluded.sort_order,
             required_for_certificate = excluded.required_for_certificate`,
      [
        pathSkillIds.get(m.skill),
        moduleId,
        m.sortOrder,
        m.requiredForCertificate ?? true,
      ],
    );
  }
  console.log(ok(`${modules.length} modules, with prerequisites and path placement`));

  let versions = 0;
  let quizzes = 0;
  let lessonCount = 0;
  /** Published version per module slug, so later passes can attach to it. */
  const versionIds = new Map();
  for (const m of modules) {
    const moduleId = moduleIds.get(m.slug);

    // Version 1 only. A content change here edits version 1 rather than
    // publishing version 2, because no learner has taken it yet — real
    // versioning starts when the admin editor does (AGENT.md §6 rule 6).
    const versionId = await upsert(
      `insert into module_versions
         (module_id, version_no, title, description, estimated_hours, status, change_summary, published_at)
       values ($1, 1, $2, $3, $4, 'published', 'First version.', now())
       on conflict (module_id, version_no) do update
         set title = excluded.title,
             description = excluded.description,
             estimated_hours = excluded.estimated_hours,
             status = 'published',
             published_at = coalesce(module_versions.published_at, now())
       returning id`,
      [moduleId, m.version.title, m.version.description, m.version.estimatedHours],
    );
    versionIds.set(m.slug, versionId);
    versions++;

    /**
     * Lessons, in order. `sort_order` is the natural key, so editing the text
     * of lesson 2 updates it rather than inserting a second one — and a lesson
     * removed from the file is reported rather than deleted, because
     * `lesson_progress` points at it.
     */
    const lessons = lessonsBySlug[m.slug] ?? [];
    const lessonIds = [];
    for (const [i, lesson] of lessons.entries()) {
      lessonIds.push(
        await upsert(
          `insert into lessons (module_version_id, sort_order, title, content)
           values ($1, $2, $3, $4)
           on conflict (module_version_id, sort_order) do update
             set title = excluded.title, content = excluded.content
           returning id`,
          [versionId, i, lesson.title, JSON.stringify({ blocks: lesson.blocks })],
        ),
      );
    }
    lessonCount += lessons.length;

    const orphaned = await client.query(
      `select count(*)::int as n from lessons where module_version_id = $1 and sort_order >= $2`,
      [versionId, lessons.length],
    );
    if (orphaned.rows[0].n > 0) {
      console.log(
        `  ! ${m.slug}: ${orphaned.rows[0].n} lesson(s) in the database are no longer in the seed file. ` +
          `Left alone — lesson_progress points at them.`,
      );
    }

    if (!m.quiz) continue;

    const found = await client.query(
      `select id from assessments where module_version_id = $1 and type = 'quiz'`,
      [versionId],
    );
    const assessmentId =
      found.rows[0]?.id ??
      (await upsert(
        `insert into assessments (module_version_id, type, title, instructions, passing_score, sort_order)
         values ($1, 'quiz', $2, $3, 70, 0) returning id`,
        [versionId, m.quiz.title, m.quiz.instructions],
      ));
    await client.query(
      `update assessments set title = $2, instructions = $3 where id = $1`,
      [assessmentId, m.quiz.title, m.quiz.instructions],
    );

    await writeQuestions(assessmentId, m.quiz.questions, lessonIds);
    quizzes++;
  }
  console.log(ok(`${versions} published module versions`));
  console.log(ok(`${lessonCount} lessons`));
  console.log(ok(`${quizzes} quizzes with answer keys`));

  /**
   * Placement checks — one per skill, owned by the skill rather than by a
   * module version (migration 0002). Passing one clears that skill's modules
   * on the learner's roadmap, so which modules it covers is decided at grading
   * time and not stored here.
   */
  let checks = 0;
  for (const [skillSlug, check] of Object.entries(placement)) {
    const skillId = skillIds.get(skillSlug);

    const found = await client.query(
      `select id from assessments where skill_id = $1`,
      [skillId],
    );
    const assessmentId =
      found.rows[0]?.id ??
      (await upsert(
        `insert into assessments (skill_id, type, title, instructions, passing_score, sort_order)
         values ($1, 'quiz', $2, $3, $4, 0) returning id`,
        [skillId, check.title, check.instructions, check.passingScore],
      ));
    await client.query(
      `update assessments set title = $2, instructions = $3, passing_score = $4 where id = $1`,
      [assessmentId, check.title, check.instructions, check.passingScore],
    );

    await writeQuestions(assessmentId, check.questions);
    checks += 1;
  }
  console.log(ok(`${checks} placement checks with answer keys`));

  /**
   * Coding exercises (§5.11). A second assessment on the module version, with
   * `type = 'code'` — the module quiz keeps its own row, and the module page
   * lists both.
   */
  let codeAssessments = 0;
  for (const [slug, exercise] of Object.entries(exercises)) {
    const versionId = versionIds.get(slug);
    if (!versionId) continue;

    const found = await client.query(
      `select id from assessments where module_version_id = $1 and type = 'code'`,
      [versionId],
    );
    const assessmentId =
      found.rows[0]?.id ??
      (await upsert(
        `insert into assessments (module_version_id, type, title, instructions, passing_score, runtime, starter_files, sort_order)
         values ($1, 'code', $2, $3, $4, $5, $6, 1) returning id`,
        [
          versionId,
          exercise.title,
          exercise.instructions,
          exercise.passingScore ?? 100,
          exercise.runtime,
          JSON.stringify(exercise.starterFiles),
        ],
      ));
    await client.query(
      `update assessments
          set title = $2, instructions = $3, passing_score = $4, runtime = $5, starter_files = $6
        where id = $1`,
      [
        assessmentId,
        exercise.title,
        exercise.instructions,
        exercise.passingScore ?? 100,
        exercise.runtime,
        JSON.stringify(exercise.starterFiles),
      ],
    );

    for (const [i, test] of exercise.testCases.entries()) {
      await upsert(
        `insert into test_cases (assessment_id, sort_order, name, test_code, is_visible)
         values ($1, $2, $3, $4, $5)
         on conflict (assessment_id, sort_order) do update
           set name = excluded.name,
               test_code = excluded.test_code,
               is_visible = excluded.is_visible
         returning id`,
        [assessmentId, i, test.name, test.code, test.visible !== false],
      );
    }

    // §6 rule 2: admin-only, and no learner endpoint may select from here.
    await client.query(
      `insert into reference_solutions (assessment_id, files) values ($1, $2)
       on conflict (assessment_id) do update set files = excluded.files`,
      [assessmentId, JSON.stringify(exercise.referenceSolution)],
    );
    codeAssessments += 1;
  }
  if (codeAssessments) console.log(ok(`${codeAssessments} coding exercises with test cases`));

  // --- Capstone briefs (design.md §5.14) -----------------------------------
  for (const brief of capstones) {
    const briefId = await upsert(
      `insert into capstone_briefs (track_id, slug, status)
       values ($1, $2, 'published')
       on conflict (slug) do update set track_id = excluded.track_id, status = 'published'
       returning id`,
      [trackIds.get(brief.track), brief.slug],
    );

    /**
     * Version 1, published. `brief_versions_one_published` allows only one
     * published version per brief, so re-seeding updates this row rather than
     * adding a second — §6 rule 6 means a learner mid-project keeps the version
     * they started, and a real content edit would be a new version number
     * written by the admin editor, not by re-running the seed.
     */
    const versionId = await upsert(
      `insert into capstone_brief_versions
         (brief_id, version_no, title, description, goals, estimated_weeks, status, published_at)
       values ($1, 1, $2, $3, $4, $5, 'published', now())
       on conflict (brief_id, version_no) do update
         set title = excluded.title,
             description = excluded.description,
             goals = excluded.goals,
             estimated_weeks = excluded.estimated_weeks,
             status = 'published'
       returning id`,
      [
        briefId,
        brief.version.title,
        brief.version.description,
        brief.version.goals,
        brief.version.estimatedWeeks,
      ],
    );

    for (const [techSlug, repo] of Object.entries(brief.starterTemplates)) {
      await client.query(
        `insert into starter_templates (brief_version_id, technology_id, repo_full_name)
         values ($1, $2, $3)
         on conflict (brief_version_id, technology_id) do update
           set repo_full_name = excluded.repo_full_name`,
        [versionId, techIds.get(techSlug), repo],
      );
    }

    for (const [i, m] of brief.milestones.entries()) {
      const milestoneId = await upsert(
        `insert into milestones
           (brief_version_id, sort_order, title, acceptance_criteria, review_checklist, explanation_question)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (brief_version_id, sort_order) do update
           set title = excluded.title,
               acceptance_criteria = excluded.acceptance_criteria,
               review_checklist = excluded.review_checklist,
               explanation_question = excluded.explanation_question
         returning id`,
        [
          versionId,
          i,
          m.title,
          JSON.stringify(m.acceptanceCriteria),
          JSON.stringify(m.reviewChecklist ?? []),
          m.explanationQuestion ?? null,
        ],
      );

      for (const moduleSlug of m.modules ?? []) {
        await client.query(
          `insert into milestone_modules (milestone_id, module_id) values ($1, $2)
           on conflict do nothing`,
          [milestoneId, moduleIds.get(moduleSlug)],
        );
      }

      /**
       * Checks are replaced rather than upserted: they have no natural key, and
       * an edited brief that renamed a check would otherwise leave the old one
       * behind for every future attempt to fail against. Nothing points at a
       * `milestone_checks` row except `check_overrides`, which only exists once
       * an attempt has been reviewed — so a project mid-flight keeps its
       * results (`milestone_attempts.check_results` stores them) and only the
       * definition moves.
       */
      await client.query(`delete from milestone_checks where milestone_id = $1`, [milestoneId]);
      for (const [j, check] of (m.checks ?? []).entries()) {
        await client.query(
          `insert into milestone_checks (milestone_id, type, name, config, sort_order)
           values ($1, $2, $3, $4, $5)`,
          [milestoneId, check.type, check.name, JSON.stringify(check.config ?? {}), j],
        );
      }
    }

    console.log(
      ok(
        `capstone "${brief.version.title}": ${brief.milestones.length} milestones, ` +
          `${Object.keys(brief.starterTemplates).length} starter templates`,
      ),
    );
  }

  await client.query("commit");
}

try {
  console.log(`\nSeeding ${careerPath.title}\n`);
  await seed();
  if (!dryRun) {
    console.log("\n  Done. Re-run after editing supabase/seed/ — it upserts, so nothing duplicates.\n");
  }
} catch (err) {
  await client?.query("rollback").catch(() => {});
  console.error(`\n  ✗ ${err.message}\n`);
  process.exitCode = 1;
} finally {
  await client?.end();
}
