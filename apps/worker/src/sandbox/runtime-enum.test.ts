import { describe, expect, it } from "vitest";
import { createTestDb } from "@first-commit/test-db";
import { DOCKER_RUNTIMES } from "./docker.js";

/**
 * `code_runtime` after migration 0004.
 *
 * **pg-mem does not apply `alter type ... add value`**, so `packages/test-db`
 * folds a later migration's added values into the `create type` when it
 * extracts the DDL. Without that fold the in-memory enum silently lacks `jsdom`
 * and an insert fails with "invalid input value" — which reads as a broken
 * endpoint rather than a stale harness, the exact confusion that package exists
 * to avoid.
 *
 * This lives in the worker suite rather than beside the harness it tests,
 * because `packages/test-db` has no test script of its own.
 */
describe("the code_runtime enum", () => {
  it("accepts every runtime the migrations define, 0004 included", async () => {
    const db = createTestDb();

    for (const runtime of ["javascript", "python", "react", "vue", "jsdom"]) {
      const { rows } = await db.pool.query<{ value: string }>(
        `select $1::code_runtime as value`,
        [runtime],
      );
      expect(rows[0].value).toBe(runtime);
    }
  });

  it("refuses a runtime the migrations do not define", async () => {
    const db = createTestDb();

    await expect(db.pool.query(`select 'ruby'::code_runtime`)).rejects.toThrow();
  });

  /**
   * Every runtime the Docker sandbox claims must be a value the schema can
   * store. A runner that supports a runtime no assessment can declare would be
   * unreachable code; one the schema has and the runner silently drops is a
   * submission that never runs.
   */
  it("can store every runtime the docker sandbox claims", async () => {
    const db = createTestDb();

    for (const runtime of DOCKER_RUNTIMES) {
      const { rows } = await db.pool.query<{ value: string }>(
        `select $1::code_runtime as value`,
        [runtime],
      );
      expect(rows[0].value).toBe(runtime);
    }
  });
});
