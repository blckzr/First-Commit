import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@first-commit/test-db";
import { queueFeedback, runSubmission, type Submission } from "./submissions.js";
import { CodeFeedbackInput } from "./prompts/code-feedback.js";
import { UnconfiguredRunner, type RunResult, type Runner } from "./runner.js";

/**
 * The third place the platform writes evidence, and the only one outside the
 * API (AGENT.md §6 rule 4: "only worker-run results are written as evidence").
 *
 * This is the first worker code with a database behind it in tests. The
 * harness moved to `packages/test-db` so both suites build pg-mem from the
 * same real migrations — it had been tracked as a gap since the roadmap work.
 */

let db: TestDb;
let ids: Record<string, string>;
let submission: Submission;

/** A runner that reports exactly what a test tells it to, and records its brief. */
let lastRequest: { cases: { id: string; visible: boolean }[] } | null = null;
const fake = (result: RunResult): Runner => ({
  name: "fake",
  supports: () => true,
  run: (request) => {
    lastRequest = request;
    return Promise.resolve(result);
  },
});

const outcome = (id: string, name: string, passed: boolean, hidden = false) => ({
  testCaseId: id,
  name,
  passed,
  hidden,
  ...(passed ? {} : { expected: "12", actual: "10" }),
});

beforeEach(async () => {
  db = createTestDb();
  const one = async (sql: string, values: unknown[] = []) =>
    (await db.pool.query<{ id: string }>(sql, values)).rows[0].id;

  ids = {};
  ids.user = await one(
    `insert into users (email, password_hash, full_name) values ('l@example.com','h','L') returning id`,
  );
  ids.skill = await one(`insert into skills (slug, name) values ('js','JavaScript') returning id`);
  ids.module = await one(
    `insert into modules (skill_id, kind, slug, status) values ($1,'core','arrays','published') returning id`,
    [ids.skill],
  );
  ids.version = await one(
    `insert into module_versions (module_id, version_no, title, status)
     values ($1,1,'Arrays and objects','published') returning id`,
    [ids.module],
  );
  ids.exercise = await one(
    `insert into assessments (module_version_id, type, title, runtime, starter_files, passing_score)
     values ($1,'code','Sum of even numbers','javascript','[]',100) returning id`,
    [ids.version],
  );
  ids.visible = await one(
    `insert into test_cases (assessment_id, sort_order, name, test_code, is_visible)
     values ($1,0,'Sums the evens','expect(x).toBe(12)',true) returning id`,
    [ids.exercise],
  );
  ids.hidden = await one(
    `insert into test_cases (assessment_id, sort_order, name, test_code, is_visible)
     values ($1,1,'Works on a longer list','expect(y).toBe(44)',false) returning id`,
    [ids.exercise],
  );
  ids.submission = await one(
    `insert into code_submissions (user_id, assessment_id, files, status)
     values ($1,$2,'[{"path":"script.js","content":"mine"}]','running') returning id`,
    [ids.user, ids.exercise],
  );

  lastRequest = null;
  submission = {
    id: ids.submission,
    user_id: ids.user,
    assessment_id: ids.exercise,
    files: [{ path: "script.js", content: "mine" }],
  };
});

const stored = () => db.rows("code_submissions")[0];

describe("runSubmission", () => {
  it("records a pass and writes the completion", async () => {
    const result = await runSubmission(
      db.pool,
      fake({
        outcomes: [
          outcome(ids.visible, "Sums the evens", true),
          outcome(ids.hidden, "Works on a longer list", true, true),
        ],
      }),
      submission,
    );

    expect(result).toEqual({ passed: true, status: "completed" });
    expect(stored().status).toBe("completed");
    expect(stored().passed).toBe(true);

    const done = db.rows("module_completions");
    expect(done).toHaveLength(1);
    expect(done[0].method).toBe("passed");
    expect(done[0].user_id).toBe(ids.user);
    // §6 rule 6: progress points at the exact version taken.
    expect(done[0].module_version_id).toBe(ids.version);
  });

  /**
   * **A hidden case failing is still a failure.** That is the whole reason
   * hidden cases exist: a solution that satisfies only the visible ones must
   * not pass.
   */
  it("fails when only a hidden case fails, and writes no completion", async () => {
    const result = await runSubmission(
      db.pool,
      fake({
        outcomes: [
          outcome(ids.visible, "Sums the evens", true),
          outcome(ids.hidden, "Works on a longer list", false, true),
        ],
      }),
      submission,
    );

    expect(result.passed).toBe(false);
    expect(stored().passed).toBe(false);
    expect(db.rows("module_completions")).toHaveLength(0);
  });

  /**
   * §6 rule 2: a learner may know a hidden case failed — that is useful and
   * honest — but not what it checked, because its expected and actual values
   * describe the input it was hiding.
   */
  it("keeps a hidden case's name and drops its values", async () => {
    await runSubmission(
      db.pool,
      fake({
        outcomes: [
          outcome(ids.visible, "Sums the evens", false),
          outcome(ids.hidden, "Works on a longer list", false, true),
        ],
      }),
      submission,
    );

    const results = stored().test_results as Record<string, unknown>[];
    const visible = results.find((r) => r.testCaseId === ids.visible)!;
    const hidden = results.find((r) => r.testCaseId === ids.hidden)!;

    expect(visible.expected).toBe("12");
    expect(hidden.name).toBe("Works on a longer list");
    expect(hidden.expected).toBeUndefined();
    expect(hidden.actual).toBeUndefined();
  });

  /**
   * **The worker runs every case; the API shows only some.** `is_visible`
   * decides what a learner may read, not what decides the outcome — filtering
   * on it here would make the hidden cases decorative, and mutation-testing
   * found nothing stopping that.
   */
  it("gives the runner the hidden cases too", async () => {
    await runSubmission(
      db.pool,
      fake({
        outcomes: [
          outcome(ids.visible, "Sums the evens", true),
          outcome(ids.hidden, "Works on a longer list", true, true),
        ],
      }),
      submission,
    );

    expect(lastRequest!.cases.map((c) => c.id).sort()).toEqual([ids.visible, ids.hidden].sort());
    expect(lastRequest!.cases.filter((c) => !c.visible)).toHaveLength(1);
  });

  /**
   * **End to end, with the real reader.** The earlier redaction test fed
   * `runSubmission` a `hidden: true` outcome from a fake runner — so it proved
   * `redact()` works, and proved nothing about whether anything ever sets the
   * flag. Nothing did: `readOutcomes` reported `hidden: false` for every case,
   * so a failing hidden case would have put its expected and actual on the
   * learner's screen.
   *
   * This drives the **real** reader over the **real** harness cases, which is
   * the seam the leak lived in.
   */
  it("redacts a failing hidden case when the reader supplies the flag", async () => {
    const { buildHarness } = await import("./sandbox/harness.js");
    const { readOutcomes } = await import("./sandbox/results.js");

    /** The shape `runSubmission` builds for the runner, hidden case included. */
    const request = {
      runtime: "javascript",
      files: submission.files,
      cases: [
        { id: ids.visible, name: "Sums the evens", code: "expect(1).toBe(1);", visible: true },
        {
          id: ids.hidden,
          name: "Works on a longer list",
          code: "expect(2).toBe(2);",
          visible: false,
        },
      ],
    };
    const harness = buildHarness(request);

    const runner: Runner = {
      name: "real-reader",
      supports: () => true,
      run: () =>
        Promise.resolve(
          // Both fail with values. The hidden one's must not reach the learner.
          readOutcomes(
            harness.cases
              .map((c) =>
                JSON.stringify({ i: c.i, passed: false, expected: "44", actual: "41" }),
              )
              .map((json) => `__fc_result__ ${json}`)
              .join("\n"),
            harness.cases,
          ),
        ),
    };

    await runSubmission(db.pool, runner, submission);

    const results = stored().test_results as Record<string, unknown>[];
    const visible = results.find((r) => r.testCaseId === ids.visible)!;
    const hidden = results.find((r) => r.testCaseId === ids.hidden)!;

    expect(visible.expected).toBe("44");
    expect(hidden.hidden).toBe(true);
    expect(hidden.name).toBe("Works on a longer list");
    expect(hidden.expected, "a hidden case's expected value reached the learner").toBeUndefined();
    expect(hidden.actual, "a hidden case's actual value reached the learner").toBeUndefined();
  });

  it("records an error rather than a pass when the code could not run", async () => {
    const result = await runSubmission(
      db.pool,
      fake({ outcomes: [outcome(ids.visible, "Sums the evens", false)], error: "SyntaxError" }),
      submission,
    );

    expect(result.status).toBe("error");
    expect(stored().status).toBe("error");
    expect(stored().passed).toBeNull();
    expect(db.rows("module_completions")).toHaveLength(0);
  });

  /** A learner who already passed keeps the completion they earned. */
  it("leaves an existing completion alone", async () => {
    await db.pool.query(
      `insert into module_completions (user_id, module_id, module_version_id, method, score)
       values ($1,$2,$3,'tested_out',88)`,
      [ids.user, ids.module, ids.version],
    );

    await runSubmission(
      db.pool,
      fake({
        outcomes: [
          outcome(ids.visible, "Sums the evens", true),
          outcome(ids.hidden, "Works on a longer list", true, true),
        ],
      }),
      submission,
    );

    const kept = db.rows("module_completions")[0];
    expect(kept.method).toBe("tested_out");
    expect(Number(kept.score)).toBe(88);
  });

  it("errors rather than passing when the exercise has no test cases", async () => {
    await db.pool.query(`delete from test_cases where assessment_id = $1`, [ids.exercise]);

    const result = await runSubmission(db.pool, fake({ outcomes: [] }), submission);

    expect(result).toEqual({ passed: false, status: "error" });
    expect(db.rows("module_completions")).toHaveLength(0);
  });
});

describe("UnconfiguredRunner", () => {
  /**
   * The default until a sandbox is set up. It must never report a pass — an
   * unrun submission that wrote a completion would be the worst version of
   * this bug.
   */
  it("fails every case and explains why", async () => {
    const result = await runSubmission(db.pool, new UnconfiguredRunner(), submission);

    expect(result.status).toBe("error");
    expect(db.rows("module_completions")).toHaveLength(0);
    expect(stored().passed).toBeNull();
  });

  it("does not claim to support any runtime", () => {
    expect(new UnconfiguredRunner().supports()).toBe(false);
  });
});

describe("queueFeedback", () => {
  /** §7: the model explains results that already exist. */
  it("queues code_feedback against the submission", async () => {
    await queueFeedback(db.pool, submission, [
      outcome(ids.visible, "Sums the evens", false),
      outcome(ids.hidden, "Works on a longer list", true, true),
    ]);

    const jobs = db.rows("ai_jobs");
    expect(jobs).toHaveLength(1);
    expect(jobs[0].type).toBe("code_feedback");
    expect(jobs[0].user_id).toBe(ids.user);
    expect(jobs[0].source_id).toBe(ids.submission);
  });

  /**
   * **The test that was missing.** The old version asserted the payload matched
   * what this function wrote — a `{ files, failing }` shape nothing consumed —
   * so it passed while every real job died on
   * `Cannot read properties of undefined (reading 'map')`.
   *
   * Parsing with the *handler's own schema* is what ties producer to consumer.
   * A payload the handler cannot read now fails here instead.
   */
  it("writes a payload the handler can actually parse", async () => {
    await queueFeedback(db.pool, submission, [
      outcome(ids.visible, "Sums the evens", false),
      outcome(ids.hidden, "Works on a longer list", true, true),
    ]);

    const parsed = CodeFeedbackInput.safeParse(db.rows("ai_jobs")[0].payload);
    expect(parsed.success, parsed.error?.message).toBe(true);

    const payload = parsed.data!;
    expect(payload.exerciseTitle).toBe("Sum of even numbers");
    expect(payload.language).toBe("javascript");
    expect(payload.files[0].path).toBe("script.js");
    // Every case, passes included — the model should be able to say what works.
    expect(payload.testResults).toHaveLength(2);
    expect(payload.testResults.filter((t) => t.passed)).toHaveLength(1);
  });

  /**
   * The rubric goes to the model and never to the learner (§6 rule 2). It is
   * what lets feedback speak to what the exercise was teaching rather than only
   * to the assertion that failed.
   */
  it("includes the rubric for the model", async () => {
    await db.pool.query(
      `insert into rubrics (assessment_id, criteria) values ($1, $2)`,
      [
        ids.exercise,
        JSON.stringify([{ name: "Uses a loop", description: "Iterates rather than hard-coding" }]),
      ],
    );

    await queueFeedback(db.pool, submission, [outcome(ids.visible, "Sums the evens", false)]);

    const payload = CodeFeedbackInput.parse(db.rows("ai_jobs")[0].payload);
    expect(payload.rubric).toEqual([
      { name: "Uses a loop", description: "Iterates rather than hard-coding" },
    ]);
  });

  /** `rubrics.criteria` is jsonb, so it is whatever an author put there. */
  it("survives a malformed rubric rather than failing the job", async () => {
    await db.pool.query(`insert into rubrics (assessment_id, criteria) values ($1, $2)`, [
      ids.exercise,
      JSON.stringify(["not an object", { name: "no description" }]),
    ]);

    await queueFeedback(db.pool, submission, [outcome(ids.visible, "Sums the evens", false)]);

    const payload = CodeFeedbackInput.parse(db.rows("ai_jobs")[0].payload);
    expect(payload.rubric).toEqual([]);
  });

  /**
   * A hidden case reaches the model the same way it reaches the learner: a name
   * and an outcome. Otherwise the hint could hand over the value the hidden case
   * was checking.
   */
  it("sends a hidden case with no values", async () => {
    await queueFeedback(db.pool, submission, [
      outcome(ids.visible, "Sums the evens", false),
      // Redacted, as `runSubmission` stores it: name and outcome only.
      { testCaseId: ids.hidden, name: "Works on a longer list", passed: false, hidden: true },
    ]);

    const payload = CodeFeedbackInput.parse(db.rows("ai_jobs")[0].payload);
    const hidden = payload.testResults.find((t) => t.name === "Works on a longer list")!;
    expect(hidden.passed).toBe(false);
    expect(hidden.expected).toBeUndefined();
    expect(hidden.actual).toBeUndefined();
  });

  /**
   * **The exact payload that broke production**, pinned. `{ files, failing }` was
   * what this function used to write; the handler cast it to
   * `CodeFeedbackInput` and died on `Cannot read properties of undefined
   * (reading 'map')` — a message naming neither the field nor the producer.
   *
   * The schema now rejects it and says which fields are missing, so the same
   * mistake becomes a readable error instead of three silent retries.
   */
  it("rejects the old payload shape, naming what is missing", () => {
    const parsed = CodeFeedbackInput.safeParse({
      files: [{ path: "script.js", content: "x" }],
      failing: [{ name: "Sums the evens" }],
    });

    expect(parsed.success).toBe(false);
    const missing = parsed.error!.issues.map((i) => i.path.join("."));
    expect(missing).toContain("testResults");
    expect(missing).toContain("exerciseTitle");
    expect(missing).toContain("rubric");
  });

  /** Nothing to explain about a pass, and a hint is not what a pass needs. */
  it("queues nothing when everything passed", async () => {
    await queueFeedback(db.pool, submission, [outcome(ids.visible, "Sums the evens", true)]);
    expect(db.rows("ai_jobs")).toHaveLength(0);
  });

  /** The assertion never leaves the server, not even into a job payload. */
  it("sends no test code to the model", async () => {
    await queueFeedback(db.pool, submission, [outcome(ids.visible, "Sums the evens", false)]);
    expect(JSON.stringify(db.rows("ai_jobs")[0].payload)).not.toContain("expect(x).toBe(12)");
  });

  it("queues nothing when there are no results at all", async () => {
    await queueFeedback(db.pool, submission, []);
    expect(db.rows("ai_jobs")).toHaveLength(0);
  });
});
