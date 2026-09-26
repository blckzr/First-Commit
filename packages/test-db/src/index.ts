import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DataType, newDb } from "pg-mem";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

/**
 * An in-memory PostgreSQL for endpoint and worker tests.
 *
 * The DDL is **extracted from the real migration**, not hand-written here, so
 * these tests fail if a column is renamed or a constraint moves. A hand-copied
 * schema drifts silently, which is worse than no schema test at all.
 *
 * pg-mem is not PostgreSQL. It does not run the triggers or the plpgsql
 * functions, and its planner is simpler. What it does give us is that the SQL
 * in our handlers is syntactically valid and matches the real column names and
 * types. Anything relying on a trigger still needs a real database.
 */

/**
 * Resolved from this file, not from `process.cwd()`.
 *
 * It used to be cwd-relative, which worked while only `apps/api` imported it.
 * The worker runs its tests from `apps/worker`, and "two levels up" is the
 * same place from both — but only by luck, and luck is a poor thing for a
 * test harness to depend on.
 */
const MIGRATIONS_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../supabase/migrations",
);

/**
 * Every migration, in order — not just the first one.
 *
 * `0002` is the first migration to change a table `0001` created, and reading
 * only `0001` would have meant the tests knew a schema the database no longer
 * had: `assessments.skill_id` missing, `module_version_id` still `not null`.
 * The failure would have looked like a broken endpoint rather than a stale
 * harness.
 */
function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

/**
 * Tables the endpoints under test touch. Add to this as endpoints are built —
 * a missing table surfaces immediately as "relation does not exist", which is
 * a clearer failure than a silently hand-written schema drifting from the real
 * one.
 */
const TABLES = [
  // Auth
  "users",
  "sessions",
  "email_verification_tokens",
  "password_reset_tokens",
  "auth_attempts",
  "learner_profiles",
  // AI results, for the event stream
  "ai_jobs",
  "ai_outputs",
  "ai_feedback_flags",
  // The admin surface
  "admin_activity_log",
  // Onboarding
  "career_paths",
  "tracks",        // roadmaps references it
  "placement_results",
  "roadmaps",
  // The roadmap chart
  "skills",
  "technologies",
  "technology_decisions",
  "decision_options",
  "path_skills",
  "modules",
  "module_versions",
  "lessons",       // module_enrollments references it
  "module_prerequisites",
  "path_skill_modules",
  "roadmap_technology_choices",
  "roadmap_items",
  "module_enrollments",
  "module_completions",
  // The module page and the quiz
  "lesson_progress",
  "assessments",
  "quiz_questions",
  "quiz_options",
  "quiz_answer_keys",
  "assessment_attempts",
  "test_cases",
  "reference_solutions",
  // Admin-only, and read when queueing code feedback for the model.
  "rubrics",
  "code_submissions",
  // certificates.project_id points into the capstone chain, so the whole chain
  // has to exist even though nothing here reads it yet.
  "capstone_briefs",
  "capstone_brief_versions",
  "capstone_projects",
  "certificates",
  // The resume reads verified evidence and stores rendered sections.
  "resumes",
  "resume_details",
];

function readMigration(): string {
  return migrationFiles()
    .map((f) => readFileSync(resolve(MIGRATIONS_DIR, f), "utf8"))
    .join("\n")
    .replace(/\r\n/g, "\n");
}

/**
 * The handful of things pg-mem cannot parse.
 *
 * Kept to a **named, explained list** rather than a general cleanup, because
 * the whole point of reading the real migration is that a difference between
 * test and production has to be deliberate. Anything rewritten here is
 * something the tests genuinely cannot cover, and is covered by
 * `npm run db:verify` against real PostgreSQL instead.
 */
function forPgMem(statement: string): string {
  return (
    statement
      // `unique nulls not distinct` is PostgreSQL 15+. pg-mem parses neither the
      // clause nor its meaning — under it, two core path_skills rows (track_id
      // null) would not conflict. Nothing in the API relies on that conflict;
      // the seed loader does, and it runs against the real database.
      .replace(/unique nulls not distinct/g, "unique")
  );
}

function extractStatements(sql: string): string[] {
  const statements: string[] = [];

  // Enums first — the tables reference them.
  for (const match of sql.matchAll(/create type\s+\w+\s+as enum\s*\([^;]*\);/g)) {
    statements.push(match[0]);
  }

  for (const table of TABLES) {
    const re = new RegExp(String.raw`create table ${table} \([\s\S]*?\n\);`);
    const match = sql.match(re);
    if (!match) throw new Error(`Could not find "create table ${table}" in the migration`);
    statements.push(forPgMem(match[0]));
  }

  /**
   * Then every `alter table` from the later migrations, in file order, so a
   * column added in `0002` exists here too. `create index` and `comment on`
   * are left out: no test reads them, and pg-mem's index support is partial.
   */
  for (const statement of sql.matchAll(/^alter table [\s\S]*?;$/gm)) {
    statements.push(forPgMem(statement[0]));
  }

  // The case-insensitive email uniqueness the sign-up conflict path relies on.
  const emailIndex = sql.match(/create unique index users_email_unique[^;]*;/);
  if (!emailIndex) throw new Error("Could not find users_email_unique in the migration");
  statements.push(emailIndex[0]);

  return statements;
}

export interface TestDb {
  pool: Pool;
  /** Rows currently in a table, for assertions. */
  rows(table: string): Record<string, unknown>[];
}

export function createTestDb(): TestDb {
  const db = newDb({ autoCreateForeignKeyIndices: true });

  // pg-mem has no pgcrypto, and every table's primary key defaults to this.
  db.public.registerFunction({
    name: "gen_random_uuid",
    returns: DataType.uuid,
    implementation: () => randomUUID(),
    impure: true,
  });

  for (const statement of extractStatements(readMigration())) {
    try {
      db.public.none(statement);
    } catch (err) {
      throw new Error(
        `pg-mem rejected a statement from the migration:\n` +
          `${statement.split("\n")[0]}\n  ${(err as Error).message.split("\n")[0]}`,
      );
    }
  }

  const { Pool: MemPool } = db.adapters.createPg();
  return {
    pool: new MemPool() as unknown as Pool,
    rows: (table: string) => db.public.many(`select * from ${table}`) as Record<string, unknown>[],
  };
}
