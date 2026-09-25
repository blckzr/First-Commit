import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../app.js";
import { createTestDb, type TestDb } from "@first-commit/test-db";
import { post } from "../test/http.js";
import type { Mailer } from "../mail/index.js";
import { config } from "../config.js";

const silentMailer: Mailer = { name: "test", async send() {} };

let db: TestDb;
let app: Express;
let cookie: string;
let learnerId: string;
let ids: Record<string, string>;

const read = (path: string) => request(app).get(path).set("Cookie", cookie);
const send = (path: string) =>
  request(app).post(path).set("Cookie", cookie).set("Origin", config.appOrigin);

/**
 * Values planted where a learner must never see them. A field can be renamed
 * and a name-based assertion keeps passing; a value that only ever existed in
 * a secret column cannot appear in a response by accident.
 */
const SECRET = {
  hiddenCase: "HIDDEN-CASE-NAME",
  hiddenCode: "HIDDEN-ASSERTION-CODE",
  solution: "REFERENCE-SOLUTION-BODY",
  visibleCode: "VISIBLE-ASSERTION-CODE",
};

beforeEach(async () => {
  db = createTestDb();
  app = createApp({ pool: db.pool, mailer: silentMailer });

  const signUp = await post(app, "/auth/signup").send({
    fullName: "Jan Kevin Gerona",
    email: "learner@example.com",
    password: "a-good-password",
  });
  cookie = (signUp.headers["set-cookie"] as unknown as string[])[0].split(";")[0];
  learnerId = (
    await db.pool.query<{ id: string }>(`select id from users where email = 'learner@example.com'`)
  ).rows[0].id;

  const one = async (sql: string, values: unknown[] = []) =>
    (await db.pool.query<{ id: string }>(sql, values)).rows[0].id;

  ids = {};
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
    `insert into assessments (module_version_id, type, title, instructions, runtime, starter_files, passing_score)
     values ($1,'code','Sum of even numbers','Write sumEven.', 'javascript', $2, 100) returning id`,
    [
      ids.version,
      JSON.stringify([{ path: "script.js", content: "function sumEven() {}" }]),
    ],
  );

  await db.pool.query(
    `insert into test_cases (assessment_id, sort_order, name, test_code, is_visible) values
       ($1, 0, 'Sums [2, 4, 6] to 12', $2, true),
       ($1, 1, $3, $4, false)`,
    [ids.exercise, SECRET.visibleCode, SECRET.hiddenCase, SECRET.hiddenCode],
  );
  await db.pool.query(
    `insert into reference_solutions (assessment_id, files) values ($1, $2)`,
    [ids.exercise, JSON.stringify([{ path: "script.js", content: SECRET.solution }])],
  );
});

describe("GET /exercises/:id", () => {
  it("serves the instructions and the starter files", async () => {
    const res = await read(`/exercises/${ids.exercise}`);

    expect(res.status).toBe(200);
    expect(res.body.exercise.title).toBe("Sum of even numbers");
    expect(res.body.exercise.runtime).toBe("javascript");
    expect(res.body.exercise.starterFiles).toEqual([
      { path: "script.js", content: "function sumEven() {}" },
    ]);
    expect(res.body.exercise.moduleTitle).toBe("Arrays and objects");
  });

  /**
   * §6 rule 2 names hidden test cases and reference solutions as things that
   * never reach a learner. A hidden case must not appear in any shape — not
   * its name, not its code, and not as an extra entry in the count.
   */
  it("sends the visible test case and no trace of the hidden one", async () => {
    const res = await read(`/exercises/${ids.exercise}`);
    const body = JSON.stringify(res.body);

    expect(res.body.exercise.visibleTests).toHaveLength(1);
    expect(res.body.exercise.visibleTests[0].name).toBe("Sums [2, 4, 6] to 12");

    expect(body, "a hidden case name leaked").not.toContain(SECRET.hiddenCase);
    expect(body, "a hidden case's code leaked").not.toContain(SECRET.hiddenCode);
  });

  it("never sends the reference solution", async () => {
    const res = await read(`/exercises/${ids.exercise}`);
    expect(JSON.stringify(res.body)).not.toContain(SECRET.solution);
  });

  /**
   * Even a visible case's assertion stays on the server: §5.11's screen shows
   * a name and an expected-versus-actual, so the code would be payload nothing
   * renders.
   */
  it("sends no test code at all", async () => {
    const res = await read(`/exercises/${ids.exercise}`);
    const body = JSON.stringify(res.body);

    expect(body).not.toContain(SECRET.visibleCode);
    expect(body).not.toContain("testCode");
    expect(body).not.toContain("test_code");
  });

  it("answers 404 for a quiz id, not a code exercise", async () => {
    const quiz = (
      await db.pool.query<{ id: string }>(
        `insert into assessments (module_version_id, type, title) values ($1,'quiz','Quiz') returning id`,
        [ids.version],
      )
    ).rows[0].id;

    expect((await read(`/exercises/${quiz}`)).status).toBe(404);
  });

  it("answers 404 for an unpublished module", async () => {
    await db.pool.query(`update modules set status = 'draft' where id = $1`, [ids.module]);
    expect((await read(`/exercises/${ids.exercise}`)).status).toBe(404);
  });

  it("reopens the learner's own last attempt", async () => {
    await send(`/exercises/${ids.exercise}/submissions`).send({
      files: [{ path: "script.js", content: "my work in progress" }],
    });

    const res = await read(`/exercises/${ids.exercise}`);
    expect(res.body.exercise.lastSubmission.files[0].content).toBe("my work in progress");
    expect(res.body.exercise.lastSubmission.status).toBe("queued");
  });

  /** §6.1 step 3: somebody else's attempt is not theirs to reopen. */
  it("does not reopen another learner's attempt", async () => {
    const other = (
      await db.pool.query<{ id: string }>(
        `insert into users (email, password_hash, full_name) values ('other@example.com','h','Other') returning id`,
      )
    ).rows[0].id;
    await db.pool.query(
      `insert into code_submissions (user_id, assessment_id, files) values ($1,$2,$3)`,
      [other, ids.exercise, JSON.stringify([{ path: "script.js", content: "THEIR CODE" }])],
    );

    const res = await read(`/exercises/${ids.exercise}`);
    expect(res.body.exercise.lastSubmission).toBeNull();
    expect(JSON.stringify(res.body)).not.toContain("THEIR CODE");
  });
});

describe("POST /exercises/:id/submissions", () => {
  const files = [{ path: "script.js", content: "function sumEven() { return 12; }" }];

  it("records the files and queues the run", async () => {
    const res = await send(`/exercises/${ids.exercise}/submissions`).send({ files });

    expect(res.status).toBe(201);
    expect(res.body.submission.status).toBe("queued");
    // Nothing has run, so nothing may claim to have passed.
    expect(res.body.submission.passed).toBeNull();
    expect(res.body.submission.testResults).toBeNull();

    const row = db.rows("code_submissions")[0];
    expect(row.user_id).toBe(learnerId);
    expect(row.status).toBe("queued");
    expect(row.passed).toBeNull();
  });

  /**
   * §6 rule 4: "Submission endpoints accept files, nothing else." `.strict()`
   * makes that a refusal rather than a silent ignore.
   */
  it.each(["passed", "testResults", "test_results", "score", "status"])(
    "refuses a body carrying %s",
    async (field) => {
      const res = await send(`/exercises/${ids.exercise}/submissions`).send({
        files,
        [field]: field === "score" ? 100 : true,
      });

      expect(res.status).toBe(400);
      expect(db.rows("code_submissions")).toHaveLength(0);
      expect(db.rows("module_completions")).toHaveLength(0);
    },
  );

  it("refuses a submission with no files", async () => {
    const res = await send(`/exercises/${ids.exercise}/submissions`).send({ files: [] });
    expect(res.status).toBe(400);
    expect(db.rows("code_submissions")).toHaveLength(0);
  });

  it("writes no completion — passing is the worker's to decide", async () => {
    await send(`/exercises/${ids.exercise}/submissions`).send({ files });
    expect(db.rows("module_completions")).toHaveLength(0);
  });

  it("answers 404 for an exercise that does not exist", async () => {
    const res = await send(`/exercises/00000000-0000-0000-0000-000000000000/submissions`).send({
      files,
    });
    expect(res.status).toBe(404);
    expect(db.rows("code_submissions")).toHaveLength(0);
  });
});

describe("GET /submissions/:id", () => {
  const submit = async () => {
    const res = await send(`/exercises/${ids.exercise}/submissions`).send({
      files: [{ path: "script.js", content: "x" }],
    });
    return res.body.submission.id as string;
  };

  it("reports the state while it waits", async () => {
    const id = await submit();
    const res = await read(`/submissions/${id}`);

    expect(res.status).toBe(200);
    expect(res.body.submission.status).toBe("queued");
    expect(res.body.submission.passed).toBeNull();
    expect(res.body.submission.completedAt).toBeNull();
  });

  it("reports the worker's result once there is one", async () => {
    const id = await submit();
    await db.pool.query(
      `update code_submissions
          set status = 'completed', passed = true, completed_at = now(),
              test_results = $2
        where id = $1`,
      [id, JSON.stringify([{ name: "Sums [2, 4, 6] to 12", passed: true }])],
    );

    const res = await read(`/submissions/${id}`);
    expect(res.body.submission.status).toBe("completed");
    expect(res.body.submission.passed).toBe(true);
    expect(res.body.submission.testResults[0].name).toBe("Sums [2, 4, 6] to 12");
  });

  /** §6.1 step 4, and 404 rather than 403 so the id is not confirmed. */
  it("answers 404 for another learner's submission", async () => {
    const other = (
      await db.pool.query<{ id: string }>(
        `insert into users (email, password_hash, full_name) values ('other@example.com','h','Other') returning id`,
      )
    ).rows[0].id;
    const theirs = (
      await db.pool.query<{ id: string }>(
        `insert into code_submissions (user_id, assessment_id, files) values ($1,$2,'[]') returning id`,
        [other, ids.exercise],
      )
    ).rows[0].id;

    const res = await read(`/submissions/${theirs}`);
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain(theirs);
  });

  it("answers 404 for a malformed id rather than failing on the cast", async () => {
    expect((await read("/submissions/not-a-uuid")).status).toBe(404);
  });
});

describe("GET /submissions/:id — §5.11's AI feedback", () => {
  const RUBRIC_NOTE = "RUBRIC-ONLY-NOTE";

  const submit = async () => {
    const res = await send(`/exercises/${ids.exercise}/submissions`).send({
      files: [{ path: "script.js", content: "x" }],
    });
    return res.body.submission.id as string;
  };

  const writeFeedback = async (submissionId: string, userId = learnerId) =>
    (
      await db.pool.query<{ id: string }>(
        `insert into ai_outputs (user_id, source_type, source_id, content)
         values ($1, 'code_feedback', $2, $3) returning id`,
        [
          userId,
          submissionId,
          JSON.stringify({
            summary: "Your loop starts at index 1.",
            issues: [{ line: 3, problem: "The first item is skipped.", hint: "Where do arrays start?" }],
            rubric: [{ criterion: "Uses a loop", met: true, note: RUBRIC_NOTE }],
            encouragement: "You're one character away.",
          }),
        ],
      )
    ).rows[0].id;

  it("reports no feedback before any is written", async () => {
    const res = await read(`/submissions/${await submit()}`);
    expect(res.body.submission.feedback).toBeNull();
    expect(res.body.submission.feedbackStatus).toBe("none");
  });

  /** §5.11: "Feedback is queued. Your test results are ready below." */
  it("reports the job's state while it waits", async () => {
    const id = await submit();
    await db.pool.query(
      `insert into ai_jobs (type, user_id, source_id, payload)
       values ('code_feedback', $1, $2, '{}')`,
      [learnerId, id],
    );

    const res = await read(`/submissions/${id}`);
    expect(res.body.submission.feedbackStatus).toBe("queued");
    expect(res.body.submission.feedback).toBeNull();
  });

  it("serves the summary and issues, with the output id to flag", async () => {
    const id = await submit();
    const outputId = await writeFeedback(id);

    const res = await read(`/submissions/${id}`);
    const feedback = res.body.submission.feedback;

    expect(feedback.aiOutputId).toBe(outputId);
    expect(feedback.flagged).toBe(false);
    expect(feedback.summary).toBe("Your loop starts at index 1.");
    expect(feedback.issues[0]).toEqual({
      line: 3,
      problem: "The first item is skipped.",
      hint: "Where do arrays start?",
    });
    expect(feedback.encouragement).toBe("You're one character away.");
  });

  /** §6 rule 2 names rubrics among the things a learner never receives. */
  it("never sends the rubric", async () => {
    const id = await submit();
    await writeFeedback(id);

    const res = await read(`/submissions/${id}`);
    expect(JSON.stringify(res.body)).not.toContain(RUBRIC_NOTE);
    expect(JSON.stringify(res.body)).not.toContain("rubric");
  });

  it("reports feedback the learner already flagged as flagged", async () => {
    const id = await submit();
    const outputId = await writeFeedback(id);
    await db.pool.query(
      `insert into ai_feedback_flags (ai_output_id, user_id, reason) values ($1,$2,'wrong')`,
      [outputId, learnerId],
    );

    const res = await read(`/submissions/${id}`);
    expect(res.body.submission.feedback.flagged).toBe(true);
  });

  it("does not report another learner's flag as this learner's", async () => {
    const id = await submit();
    const outputId = await writeFeedback(id);
    const other = (
      await db.pool.query<{ id: string }>(
        `insert into users (email, password_hash, full_name) values ('other@example.com','h','O') returning id`,
      )
    ).rows[0].id;
    await db.pool.query(
      `insert into ai_feedback_flags (ai_output_id, user_id, reason) values ($1,$2,'theirs')`,
      [outputId, other],
    );

    const res = await read(`/submissions/${id}`);
    expect(res.body.submission.feedback.flagged).toBe(false);
  });
});
