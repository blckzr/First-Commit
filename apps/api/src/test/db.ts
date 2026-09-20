import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DataType, newDb } from "pg-mem";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

/**
 * An in-memory PostgreSQL for endpoint tests.
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

const MIGRATION = resolve(process.cwd(), "../../supabase/migrations/0001_initial_schema.sql");

/** Tables the auth endpoints touch. */
const TABLES = [
  "users",
  "sessions",
  "email_verification_tokens",
  "password_reset_tokens",
  "auth_attempts",
  "learner_profiles",
];

function readMigration(): string {
  return readFileSync(MIGRATION, "utf8").replace(/\r\n/g, "\n");
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
    statements.push(match[0]);
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
