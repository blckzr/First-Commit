#!/usr/bin/env node
/**
 * Database setup and verification.
 *
 *   node --env-file=apps/api/.env scripts/db.mjs migrate
 *   node --env-file=apps/api/.env scripts/db.mjs verify
 *
 * `migrate` applies every file in supabase/migrations in filename order, each
 * inside a transaction, and records it in a `schema_migrations` table so a
 * second run is a no-op rather than an error.
 *
 * `verify` is the one that matters. The API's tests run against pg-mem, which
 * does not execute triggers or plpgsql — so until this passes against a real
 * PostgreSQL, the functions and triggers the platform depends on have never
 * actually run.
 */
import { readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS = join(ROOT, "supabase", "migrations");

const url = process.env.DATABASE_URL;
if (!url) {
  console.error(
    "DATABASE_URL is not set.\n\n" +
      "  Copy apps/api/.env.example to apps/api/.env, paste your connection\n" +
      "  string, then run:\n\n" +
      "    node --env-file=apps/api/.env scripts/db.mjs migrate\n",
  );
  process.exit(1);
}

const client = new pg.Client({
  connectionString: url,
  ssl: url.includes("localhost") || url.includes("127.0.0.1")
    ? false
    : { rejectUnauthorized: false },
});

const ok = (s) => `  ✓ ${s}`;
const bad = (s) => `  ✗ ${s}`;

async function migrate() {
  await client.query(`
    create table if not exists schema_migrations (
      filename   text primary key,
      checksum   text not null,
      applied_at timestamptz not null default now()
    )`);

  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  const { rows } = await client.query("select filename, checksum from schema_migrations");
  const applied = new Map(rows.map((r) => [r.filename, r.checksum]));

  let ran = 0;
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS, file), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex").slice(0, 16);

    if (applied.has(file)) {
      if (applied.get(file) !== checksum) {
        console.log(
          bad(`${file} already applied, but the file has changed since.`) +
            "\n     Write a new migration rather than editing one that has run.",
        );
      } else {
        console.log(ok(`${file} (already applied)`));
      }
      continue;
    }

    process.stdout.write(`  … ${file}`);
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query(
        "insert into schema_migrations (filename, checksum) values ($1, $2)",
        [file, checksum],
      );
      await client.query("commit");
      console.log(`\r${ok(file)}                    `);
      ran++;
    } catch (err) {
      await client.query("rollback").catch(() => {});
      console.log(`\r${bad(file)}                    `);
      console.error(`\n     ${err.message}\n`);
      throw err;
    }
  }

  console.log(`\n  ${ran} migration(s) applied, ${files.length - ran} already present.`);
}

/**
 * Checks the objects the code actually calls, and exercises the two behaviours
 * pg-mem cannot: the append-only trigger and the job-claiming function.
 */
async function verify() {
  let failures = 0;
  const check = async (label, fn) => {
    try {
      const detail = await fn();
      console.log(ok(`${label}${detail ? ` — ${detail}` : ""}`));
    } catch (err) {
      console.log(bad(`${label} — ${err.message.split("\n")[0]}`));
      failures++;
    }
  };

  console.log("\nSchema");
  await check("tables", async () => {
    const { rows } = await client.query(
      `select count(*)::int as n from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE'`,
    );
    if (rows[0].n < 55) throw new Error(`only ${rows[0].n} tables`);
    return `${rows[0].n} present`;
  });

  await check("functions", async () => {
    const wanted = [
      "claim_next_ai_job",
      "purge_expired_auth_rows",
      "purge_processed_github_events",
      "set_updated_at",
      "prevent_log_changes",
    ];
    const { rows } = await client.query(
      `select proname from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and proname = any($1)`,
      [wanted],
    );
    const found = new Set(rows.map((r) => r.proname));
    const missing = wanted.filter((w) => !found.has(w));
    if (missing.length) throw new Error(`missing ${missing.join(", ")}`);
    return `all ${wanted.length} present`;
  });

  await check("triggers", async () => {
    const { rows } = await client.query(
      `select count(*)::int as n from pg_trigger where not tgisinternal`,
    );
    if (rows[0].n < 10) throw new Error(`only ${rows[0].n} triggers`);
    return `${rows[0].n} present`;
  });

  console.log("\nBehaviour pg-mem cannot test");

  await check("admin_activity_log is append-only", async () => {
    const admin = await client.query(
      `insert into users (email, password_hash, full_name, role)
       values ('verify-admin@example.invalid','x','Verify','admin') returning id`,
    );
    const adminId = admin.rows[0].id;
    try {
      await client.query(
        `insert into admin_activity_log (admin_id, action, target_type, target_id, reason)
         values ($1,'verify','script',null,'schema verification')`,
        [adminId],
      );

      // prevent_log_changes blocks both, so both are worth proving.
      const refuses = async (sql) => {
        try {
          await client.query(sql, [adminId]);
          return false;
        } catch {
          return true;
        }
      };

      const deleteBlocked = await refuses(
        `delete from admin_activity_log where admin_id = $1`,
      );
      const updateBlocked = await refuses(
        `update admin_activity_log set reason = 'tampered' where admin_id = $1`,
      );

      if (!deleteBlocked) throw new Error("a delete succeeded — the trigger is not firing");
      if (!updateBlocked) throw new Error("an update succeeded — the trigger only blocks deletes");
      return "delete and update both refused";
    } finally {
      // The row cannot be removed by design, so the user reference is cleared
      // instead: admin_id is `on delete set null`.
      await client.query(`delete from users where id = $1`, [adminId]).catch(() => {});
    }
  });

  await check("claim_next_ai_job claims exactly one job", async () => {
    const user = await client.query(
      `insert into users (email, password_hash, full_name)
       values ('verify-learner@example.invalid','x','Verify') returning id`,
    );
    const userId = user.rows[0].id;
    try {
      await client.query(
        `insert into ai_jobs (type, user_id, source_id, payload)
         values ('code_feedback', $1, gen_random_uuid(), '{}'::jsonb),
                ('code_feedback', $1, gen_random_uuid(), '{}'::jsonb)`,
        [userId],
      );

      const first = await client.query("select * from claim_next_ai_job()");
      if (first.rowCount !== 1) throw new Error(`claimed ${first.rowCount} rows, expected 1`);
      if (first.rows[0].status !== "running") {
        throw new Error(`status is '${first.rows[0].status}', expected 'running'`);
      }

      const second = await client.query("select * from claim_next_ai_job()");
      if (second.rows[0]?.id === first.rows[0].id) {
        throw new Error("claimed the same job twice");
      }
      return "one at a time, marked running";
    } finally {
      await client.query(`delete from users where id = $1`, [userId]).catch(() => {});
    }
  });

  await check("set_updated_at maintains the column", async () => {
    const user = await client.query(
      `insert into users (email, password_hash, full_name)
       values ('verify-touch@example.invalid','x','Verify') returning id, updated_at`,
    );
    const { id, updated_at: before } = user.rows[0];
    try {
      await new Promise((r) => setTimeout(r, 15));
      const after = await client.query(
        `update users set full_name = 'Verify 2' where id = $1 returning updated_at`,
        [id],
      );
      if (new Date(after.rows[0].updated_at) <= new Date(before)) {
        throw new Error("updated_at did not move");
      }
      return "trigger fires";
    } finally {
      await client.query(`delete from users where id = $1`, [id]).catch(() => {});
    }
  });

  console.log();
  if (failures) {
    console.log(`  ${failures} check(s) failed.\n`);
    process.exitCode = 1;
  } else {
    console.log("  Everything the code calls exists and behaves.\n");
  }
}

const command = process.argv[2];
try {
  await client.connect();
  if (command === "migrate") await migrate();
  else if (command === "verify") await verify();
  else {
    console.error("Usage: db.mjs migrate | verify");
    process.exitCode = 1;
  }
} catch (err) {
  console.error(`\n${err.message}\n`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
