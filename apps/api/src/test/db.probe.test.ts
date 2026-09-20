import { describe, expect, it } from "vitest";
import { createTestDb } from "./db.js";

/**
 * Proves the harness itself works before anything relies on it: the real DDL
 * loads, and the specific SQL features the auth endpoints use behave.
 */
describe("test database", () => {
  it("loads the auth tables from the real migration", async () => {
    const { pool } = createTestDb();
    const { rows } = await pool.query<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema = 'public'`,
    );
    const names = rows.map((r) => r.table_name);
    for (const table of ["users", "sessions", "email_verification_tokens", "learner_profiles"]) {
      expect(names).toContain(table);
    }
  });

  it("applies the schema's defaults for role and status", async () => {
    const { pool } = createTestDb();
    const { rows } = await pool.query(
      `insert into users (email, password_hash, full_name)
       values ('a@b.c', 'hash', 'A') returning id, role, status, email_verified_at`,
    );
    expect(rows[0].role).toBe("learner");
    expect(rows[0].status).toBe("active");
    expect(rows[0].email_verified_at).toBeNull();
    expect(rows[0].id).toBeTruthy();
  });

  it("enforces the case-insensitive email index sign up relies on", async () => {
    const { pool } = createTestDb();
    await pool.query(`insert into users (email, password_hash, full_name) values ('a@b.c','h','A')`);
    const dup = await pool.query(
      `insert into users (email, password_hash, full_name)
       values ('A@B.C','h','B') on conflict do nothing returning id`,
    );
    expect(dup.rowCount).toBe(0);
  });
});
