import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@first-commit/test-db";
import { validateExercise } from "./validate-exercise.js";
import type { Runner, RunRequest, RunResult } from "./sandbox/types.js";

/**
 * Verifying an exercise's reference solution (design.md §6.3, migration 0005).
 *
 * **The stamp is the gate.** `reference_solutions.last_verified_at` is what the
 * API's publish check reads, and this is the only thing that writes it. So what
 * matters here is that it is written on a full pass, **cleared on anything
 * else**, and that nothing about a learner is touched on the way.
 */

let db: TestDb;
let assessmentId: string;
let adminId: string;
let lastRequest: RunRequest | null = null;

const one = async (sql: string, params: unknown[] = []) =>
  (await db.pool.query<{ id: string }>(sql, params)).rows[0].id;

const runner = (result: RunResult): Runner => ({
  name: "fake",
  supports: () => true,
  run: (request) => {
    lastRequest = request;
    return Promise.resolve(result);
  },
});

const outcome = (name: string, passed: boolean) => ({
  testCaseId: name,
  name,
  passed,
  hidden: false,
});

const stamp = () =>
  db.rows("reference_solutions")[0]?.last_verified_at as Date | null | undefined;

beforeEach(async () => {
  db = createTestDb();
  lastRequest = null;

  adminId = await one(
    `insert into users (email, password_hash, full_name, role)
     values ('admin@example.com','x','An Admin','admin') returning id`,
  );
  const skill = await one(`insert into skills (slug, name) values ('js','JS') returning id`);
  const module = await one(
    `insert into modules (skill_id, kind, slug, status)
     values ($1,'core','js-arrays','published') returning id`,
    [skill],
  );
  const version = await one(
    `insert into module_versions (module_id, version_no, title, status)
     values ($1,1,'Arrays','draft') returning id`,
    [module],
  );
  assessmentId = await one(
    `insert into assessments (module_version_id, type, title, passing_score, runtime, starter_files)
     values ($1,'code','Sum of even numbers',100,'javascript',$2) returning id`,
    [version, JSON.stringify([{ path: "index.html", content: "<body></body>" }])],
  );
  await db.pool.query(
    `insert into test_cases (assessment_id, sort_order, name, test_code, is_visible)
     values ($1,0,'Sums the evens','expect(1).toBe(1)',true),
            ($1,1,'A hidden one','expect(2).toBe(2)',false)`,
    [assessmentId],
  );
  await db.pool.query(
    `insert into reference_solutions (assessment_id, files) values ($1,$2)`,
    [assessmentId, JSON.stringify([{ path: "script.js", content: "// the answer" }])],
  );
});

describe("a passing reference solution", () => {
  it("stamps it verified", async () => {
    const result = await validateExercise(
      db.pool,
      runner({ outcomes: [outcome("Sums the evens", true), outcome("A hidden one", true)] }),
      { assessmentId },
    );

    expect(result.verified).toBe(true);
    expect(stamp()).not.toBeNull();
  });

  /** The gate exists so a learner never meets an exercise with no answer. */
  it("writes nothing about any learner", async () => {
    await validateExercise(
      db.pool,
      runner({ outcomes: [outcome("Sums the evens", true), outcome("A hidden one", true)] }),
      { assessmentId },
    );

    expect(db.rows("module_completions")).toHaveLength(0);
    expect(db.rows("code_submissions")).toHaveLength(0);
    expect(db.rows("module_enrollments")).toHaveLength(0);
  });

  /** Every case runs, hidden included — they are what the gate is checking. */
  it("runs the hidden cases too", async () => {
    await validateExercise(
      db.pool,
      runner({ outcomes: [outcome("Sums the evens", true), outcome("A hidden one", true)] }),
      { assessmentId },
    );

    expect(lastRequest!.cases).toHaveLength(2);
    expect(lastRequest!.cases.filter((c) => !c.visible)).toHaveLength(1);
  });

  /**
   * The exercise's own files, so a DOM or component exercise gets the page it
   * asserts against — the same reason `runSubmission` reads them.
   */
  it("passes the exercise's starter files as fixtures", async () => {
    await validateExercise(
      db.pool,
      runner({ outcomes: [outcome("Sums the evens", true), outcome("A hidden one", true)] }),
      { assessmentId },
    );

    expect(lastRequest!.fixtures?.map((f) => f.path)).toContain("index.html");
    expect(lastRequest!.files[0].content).toBe("// the answer");
  });
});

describe("anything short of a full pass", () => {
  /**
   * **Cleared, not left alone.** An exercise that passed last week and fails
   * now is not verified, and a stale stamp is how a broken exercise reaches a
   * learner through a publish check that appears to have run.
   */
  it("clears a previous stamp when a case fails", async () => {
    await db.pool.query(`update reference_solutions set last_verified_at = now()`);

    const result = await validateExercise(
      db.pool,
      runner({ outcomes: [outcome("Sums the evens", true), outcome("A hidden one", false)] }),
      { assessmentId },
    );

    expect(result.verified).toBe(false);
    expect(stamp()).toBeNull();
  });

  it("does not verify when the sandbox could not run", async () => {
    const result = await validateExercise(
      db.pool,
      runner({ outcomes: [outcome("Sums the evens", false)], error: "Docker is not running." }),
      { assessmentId },
    );

    expect(result.verified).toBe(false);
    expect(result.error).toMatch(/docker/i);
    expect(stamp()).toBeNull();
  });

  /** No outcomes at all is a failure, never a pass — AGENT.md's standing rule. */
  it("does not verify on an empty result", async () => {
    const result = await validateExercise(db.pool, runner({ outcomes: [] }), { assessmentId });

    expect(result.verified).toBe(false);
  });

  it("refuses a runtime this worker cannot run", async () => {
    const refusing: Runner = { name: "fake", supports: () => false, run: async () => ({ outcomes: [] }) };

    const result = await validateExercise(db.pool, refusing, { assessmentId });

    expect(result.verified).toBe(false);
    expect(result.error).toMatch(/cannot run javascript/i);
  });
});

describe("what it reports", () => {
  /**
   * **Hidden cases are shown here, unredacted.** `redact()` exists because a
   * *learner* may not read one; an author wrote them and cannot fix a failing
   * case they are not shown. This result is only ever served to an admin.
   */
  it("names every failing case, hidden ones included", async () => {
    const result = await validateExercise(
      db.pool,
      runner({
        outcomes: [
          outcome("Sums the evens", true),
          { ...outcome("A hidden one", false), expected: "44", actual: "41" },
        ],
      }),
      { assessmentId },
    );

    const failed = result.outcomes.find((o) => !o.passed)!;
    expect(failed.name).toBe("A hidden one");
    expect(failed.expected).toBe("44");
    expect(failed.actual).toBe("41");
  });
});

describe("what it refuses to start", () => {
  it("reports an exercise with no reference solution", async () => {
    await db.pool.query(`delete from reference_solutions`);

    const result = await validateExercise(db.pool, runner({ outcomes: [] }), { assessmentId });

    expect(result.error).toMatch(/no reference solution/i);
  });

  it("reports an exercise with no test cases", async () => {
    await db.pool.query(`delete from test_cases`);

    const result = await validateExercise(db.pool, runner({ outcomes: [] }), { assessmentId });

    expect(result.error).toMatch(/no test cases/i);
  });

  /** A job payload is a boundary: parsed, not cast (AGENT.md §7). */
  it("rejects a payload that is not an assessment id", async () => {
    await expect(
      validateExercise(db.pool, runner({ outcomes: [] }), { assessment: "nope" }),
    ).rejects.toThrow();
  });

  it("reports an exercise that no longer exists", async () => {
    const result = await validateExercise(db.pool, runner({ outcomes: [] }), {
      assessmentId: "00000000-0000-4000-8000-000000000000",
    });

    expect(result.error).toMatch(/no longer exists/i);
    expect(adminId).toBeTruthy();
  });
});
