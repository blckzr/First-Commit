import pg from "pg";
import type { Pool } from "pg";
import { createTestDb } from "@first-commit/test-db";

/**
 * The database the evaluation runs against: pg-mem, loaded with the **real
 * curriculum** from `supabase/seed/`.
 *
 * ### Why the real seed and not a small fixture curriculum
 *
 * The Roadmap AI is measured on whether it uses existing module ids, respects
 * prerequisite order, and covers every unproven core module
 * (`project-proposal.md` §9.1). Against a hand-written five-module catalogue all
 * three are nearly free, and the score would say more about the fixture than
 * about the model. The real path is 19 modules across 8 skills and 2 tracks with
 * 17 prerequisite edges, which is the problem the model actually faces.
 *
 * ### Why pg-mem and not the development database
 *
 * The run must be repeatable and must not write fixture learners into a
 * database that holds real accounts. pg-mem is built from the real migrations
 * (`packages/test-db`), so a renamed column fails here too.
 *
 * pg-mem does not run triggers or plpgsql. Nothing the evaluation drives
 * depends on one: the handlers read content and write rows with plain SQL.
 *
 * ### How the seed is loaded without refactoring it
 *
 * `scripts/seed.mjs` is a command-line script — it reads `DATABASE_URL`,
 * connects, seeds, and exits. Rather than restructure a working script to be
 * importable two ways, this swaps the class it constructs: `pg`'s default
 * export is one live object shared by every importer, and the script does `new
 * pg.Client(...)` at call time, so replacing `Client` beforehand is enough to
 * redirect every statement into pg-mem. Measured: all 1009 statements execute,
 * giving 19 modules, 57 lessons and 26 assessments.
 *
 * **It can only run once per process.** ESM caches the module, and the script
 * does its work at import. `seededDb()` therefore memoises, and every
 * evaluation in one run shares the database — which is also what we want, since
 * the curriculum is read-only to all of them.
 */

let cached: Promise<SeededDb> | null = null;

export interface SeededDb {
  pool: Pool;
  rows(table: string): Record<string, unknown>[];
}

export function seededDb(): Promise<SeededDb> {
  cached ??= load();
  return cached;
}

async function load(): Promise<SeededDb> {
  const db = createTestDb();

  class MemClient {
    connect() {
      return Promise.resolve();
    }
    query(text: unknown, values?: unknown[]) {
      return (db.pool as unknown as { query: (t: unknown, v?: unknown[]) => Promise<unknown> }).query(
        text,
        values,
      );
    }
    end() {
      return Promise.resolve();
    }
  }

  const client = (pg as unknown as { Client: unknown }).Client;
  (pg as unknown as { Client: unknown }).Client = MemClient;

  // The script refuses to start without one, and never dials it: every query
  // goes through MemClient above.
  const url = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgres://pg-mem/evaluation";

  const quiet = console.log;
  console.log = () => {};
  try {
    // @ts-expect-error — a .mjs script with no types. It is imported for its
    // effect, not its exports; it has none.
    await import("../../../../scripts/seed.mjs");
  } finally {
    console.log = quiet;
    (pg as unknown as { Client: unknown }).Client = client;
    if (url === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = url;
  }

  // `seed.mjs` reports failure by setting exitCode rather than throwing, so a
  // silent half-seeded database would otherwise look like a model that cannot
  // name a module.
  if (process.exitCode) {
    throw new Error("The seed did not complete — the evaluation would measure an empty catalogue.");
  }

  const modules = db.rows("modules").length;
  if (modules === 0) throw new Error("The seed wrote no modules.");

  return db;
}
