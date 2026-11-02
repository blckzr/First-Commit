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
  // §6.11's AI section reads the active prompt per component.
  "ai_prompts",
  // The admin surface
  "admin_activity_log",
  // §6.11's learning rules. The only reader outside the settings screen is the
  // quiz editor, which starts a new quiz at `passing_score_default`.
  "platform_settings",
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
  // The capstone chain (design.md §5.14). **Order is dependency order** — the
  // DDL runs in the order of this list, so a table must appear after everything
  // it references or pg-mem rejects the foreign key.
  "github_connections",
  "github_events",
  "capstone_briefs",
  "capstone_brief_versions",
  "starter_templates",
  "milestones",
  "milestone_modules",
  "milestone_checks",
  "capstone_projects",
  "project_commits",
  "milestone_attempts",
  "check_overrides",
  "integrity_flags",
  "certificates",
  // §5.17. Only `users` is referenced, so it can sit anywhere after it.
  "notifications",
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
/**
 * **pg-mem silently ignores `filter (where ...)` on an aggregate.**
 *
 * Not an error — a wrong number. `count(distinct user_id) filter (where passed)`
 * answered "4" for one pass and three failures, so a test over it would have
 * agreed with a production query that behaved differently. Write
 * `count(distinct case when passed then user_id end)` instead; it means the
 * same thing in PostgreSQL and pg-mem computes it correctly.
 *
 * Other divergences found so far, each with the same shape — something that
 * looks like it worked:
 *
 * - **`having` is not supported at all** (it throws, at least). The admin
 *   overview applies its thresholds in TypeScript instead.
 * - **A correlated subquery cannot see an outer alias** (`column "bv.id" does
 *   not exist`). Use a left join and test for null. **It is not only the select
 *   list**: a `where ... exists (select 1 ... where psm.module_id = m.id)`
 *   throws the same way (`column "m.id" does not exist`), which §5.13's career
 *   path filter met. Resolve the inner set in its own query and filter with
 *   `in (...)` — and note that joining the inner table into the outer `from`
 *   is usually the wrong alternative, because a one-to-many relationship then
 *   duplicates the outer row and inflates any count over it.
 * - **`on conflict` will not match a table-level unique constraint**, and
 *   `do nothing ... returning` returns the existing row where PostgreSQL returns
 *   none. Catch `23505` instead.
 * - **A text parameter is not implicitly cast to an enum** in `insert ... select`.
 *   Cast it explicitly.
 * - **`alter type ... add value` is not applied**, which is why `extractStatements`
 *   folds those values into the `create type`.
 * - **`= any($1::uuid[])` returns an empty result** rather than erroring — another
 *   silent wrong answer. Expand the list into `in ($1, $2, …)` instead.
 * - **`update <table> <alias> ... from ...` is not parsed** ("Unknown alias").
 *   Check ownership with a select, then update without the alias.
 * - **A correlated scalar subquery in the select list fails** ("column m.x does
 *   not exist"), as in `select (select count(*) ... where s.id = m.skill_id)`.
 *   Group separately and join the counts in TypeScript.
 * - **No `date_trunc`**, registered above.
 * - **Two aliases of the same column name, under `group by` with an aggregate,
 *   resolve to the same value.** `select ms.title, bv.title as brief_title,
 *   count(*) ... group by ms.title, bv.title` returned the *brief's* title for
 *   both. The aliases are right, the shape is right, the answer is wrong — and
 *   the counts beside them are correct, so nothing looks broken. It took
 *   §6.1's struggling-milestones panel being labelled "Task tracker" instead of
 *   "Save tasks" to find it, and that panel had no test at all until then.
 *   `group by` alone is fine; it needs an aggregate in the select list. Group
 *   by ids, fetch the names in a second query, and join them in TypeScript.
 * - **An optional filter written `($1::uuid is null or col = $1::uuid)` over a
 *   join throws "lookups on joins"** — pg-mem will not evaluate an `or`-wrapped
 *   predicate against a joined selection. Build the `where` clause from the
 *   filters that were actually given, which is the better query anyway: an
 *   `or null` predicate is not usable as an index predicate.
 * - **One `delete` that cascades into two tables, where one of them
 *   `restrict`s the other, is refused.** `delete from users` for a learner
 *   holding a certificate throws `update or delete on table "roadmaps"
 *   violates foreign key constraint on table "certificates_roadmap_id_fk"`,
 *   because pg-mem evaluates the restrict against rows the same statement is
 *   about to delete. **Real PostgreSQL completes the cascade and the delete
 *   succeeds** — measured by `npm run db:verify`. Cascade and restrict are each
 *   implemented correctly on their own; it is only this combination. Note the
 *   polarity: pg-mem is *stricter* here, so the divergence makes a test fail
 *   where production works, rather than the other way round. `account/routes.ts`
 *   deletes the referencing rows first, which both engines accept.
 * - **`text || integer` is refused** ("operator does not exist"), where
 *   PostgreSQL resolves it through `anynonarray`. Cast explicitly:
 *   `v.version_no::text`.
 *
 * Anything on this list is covered against real PostgreSQL by `npm run db:verify`
 * or by the query being written in a form both engines agree on.
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

  /*
   * Enums first — the tables reference them.
   *
   * **A later migration's `alter type ... add value` is folded into the
   * `create type` rather than run as its own statement.** pg-mem does not apply
   * it, so without this the in-memory enum silently lacks the value and an
   * insert using it fails with "invalid input value" — a failure that looks like
   * a broken endpoint rather than a stale harness, which is the exact confusion
   * this whole file exists to avoid. Migration 0004 adds `jsdom` to
   * `code_runtime` this way.
   */
  const added = new Map<string, string[]>();
  for (const match of sql.matchAll(
    /alter type\s+(\w+)\s+add value\s+(?:if not exists\s+)?'([^']+)'/gi,
  )) {
    const [, type, value] = match;
    added.set(type, [...(added.get(type) ?? []), value]);
  }

  for (const match of sql.matchAll(/create type\s+(\w+)\s+as enum\s*\(([^;]*)\);/g)) {
    const [statement, type, values] = match;
    const extra = added.get(type);
    statements.push(
      extra
        ? `create type ${type} as enum (${values.trim()}, ${extra.map((v) => `'${v}'`).join(", ")});`
        : statement,
    );
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

  /**
   * pg-mem has no `date_trunc`, which the admin overview uses to count this
   * month's certificates (design.md §6.1).
   *
   * Only the units the code actually passes are implemented, and an unknown one
   * **throws** rather than falling back to something plausible. A silent
   * approximation here would make a test agree with a production query that
   * behaves differently — the exact failure this whole package exists to
   * prevent.
   */
  db.public.registerFunction({
    name: "date_trunc",
    args: [DataType.text, DataType.timestamptz],
    returns: DataType.timestamptz,
    implementation: (unit: string, at: Date) => {
      const d = new Date(at);
      switch (unit) {
        case "month":
          return new Date(d.getFullYear(), d.getMonth(), 1);
        case "day":
          return new Date(d.getFullYear(), d.getMonth(), d.getDate());
        case "year":
          return new Date(d.getFullYear(), 0, 1);
        default:
          throw new Error(`test-db's date_trunc does not implement "${unit}" yet.`);
      }
    },
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
