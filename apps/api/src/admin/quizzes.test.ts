import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../app.js";
import { createTestDb, type TestDb } from "@first-commit/test-db";
import { post } from "../test/http.js";
import type { Mailer } from "../mail/index.js";

const silentMailer: Mailer = { name: "test", async send() {} };

/**
 * The quiz editor (design.md §6.3's Assessment tab).
 *
 * Two things are worth the most attention here. **Only a draft's quiz may be
 * written**, because a published one is what learners are being tested on and
 * `assessment_attempts` references it. And **the answer key is a secret**
 * (§6 rule 2) — this file returns it because an editor cannot work without it,
 * which makes it exactly the file where one could leak by a copied query.
 */

let db: TestDb;
let app: Express;
let adminCookie: string;
let learnerCookie: string;
let moduleId: string;
let draftId: string;
let publishedId: string;

const one = async (sql: string, params: unknown[] = []) =>
  (await db.pool.query<{ id: string }>(sql, params)).rows[0].id;

const quizUrl = (versionId: string) =>
  `/admin/modules/${moduleId}/versions/${versionId}/quiz`;

const putQuiz = (versionId: string, body: unknown, cookie = adminCookie) =>
  request(app)
    .put(quizUrl(versionId))
    .set("Cookie", cookie)
    .set("Origin", "http://localhost:5173")
    .send(body as object);

const aQuiz = (over: Record<string, unknown> = {}) => ({
  title: "Components in React quiz",
  instructions: "Five questions. There is no time limit.",
  passingScore: 70,
  questions: [
    {
      prompt: "Why must a component's name start with a capital letter?",
      explanation: "A lowercase name is treated as an HTML element.",
      options: ["Because JSX treats lowercase as HTML", "Style only", "It must not"],
      correctIndex: 0,
    },
  ],
  ...over,
});

beforeEach(async () => {
  db = createTestDb();
  app = createApp({ pool: db.pool, mailer: silentMailer });

  const learner = await post(app, "/auth/signup").send({
    fullName: "A Learner",
    email: "learner@example.com",
    password: "a-good-password",
  });
  learnerCookie = (learner.headers["set-cookie"] as unknown as string[])[0].split(";")[0];

  const admin = await post(app, "/auth/signup").send({
    fullName: "An Admin",
    email: "admin@example.com",
    password: "a-good-password",
  });
  adminCookie = (admin.headers["set-cookie"] as unknown as string[])[0].split(";")[0];
  // §6 rule 8: no endpoint sets `users.role`.
  await db.pool.query(`update users set role = 'admin' where email = 'admin@example.com'`);

  const skill = await one(
    `insert into skills (slug, name) values ('components','Components') returning id`,
  );
  moduleId = await one(
    `insert into modules (skill_id, kind, slug, status)
     values ($1,'core','components-in-react','published') returning id`,
    [skill],
  );
  publishedId = await one(
    `insert into module_versions (module_id, version_no, title, status, published_at)
     values ($1,1,'Components in React','published', now()) returning id`,
    [moduleId],
  );
  draftId = await one(
    `insert into module_versions (module_id, version_no, title, status)
     values ($1,2,'Components in React','draft') returning id`,
    [moduleId],
  );
  await db.pool.query(
    `insert into lessons (module_version_id, sort_order, title, content)
     values ($1,0,'A lesson',$2)`,
    [draftId, JSON.stringify({ blocks: [] })],
  );
});

describe("writing a quiz", () => {
  it("creates one on a draft", async () => {
    const res = await putQuiz(draftId, aQuiz());

    expect(res.status).toBe(200);
    expect(res.body.questions).toBe(1);
    expect(db.rows("quiz_questions")).toHaveLength(1);
    expect(db.rows("quiz_options")).toHaveLength(3);
    expect(db.rows("quiz_answer_keys")).toHaveLength(1);
  });

  it("points the answer key at the option the author chose", async () => {
    await putQuiz(
      draftId,
      aQuiz({
        questions: [
          {
            prompt: "Which is it?",
            explanation: "",
            options: ["Wrong", "Right", "Also wrong"],
            correctIndex: 1,
          },
        ],
      }),
    );

    const key = db.rows("quiz_answer_keys")[0];
    const correct = db.rows("quiz_options").find((o) => o.id === key.correct_option_id)!;
    expect(correct.text).toBe("Right");
  });

  /**
   * The whole quiz is replaced, which is what makes reordering one edit rather
   * than a sequence that collides with its own `(assessment_id, sort_order)`
   * unique constraint halfway through.
   */
  it("replaces the questions rather than adding to them", async () => {
    await putQuiz(draftId, aQuiz());
    await putQuiz(
      draftId,
      aQuiz({
        questions: [
          { prompt: "A new one", explanation: "", options: ["a", "b"], correctIndex: 0 },
        ],
      }),
    );

    const questions = db.rows("quiz_questions");
    expect(questions).toHaveLength(1);
    expect(questions[0].prompt).toBe("A new one");
    // The old question's options and key went with it.
    expect(db.rows("quiz_options")).toHaveLength(2);
    expect(db.rows("quiz_answer_keys")).toHaveLength(1);
  });

  it("keeps the assessment row across a rewrite", async () => {
    await putQuiz(draftId, aQuiz());
    const before = db.rows("assessments")[0].id;

    await putQuiz(draftId, aQuiz({ title: "Renamed" }));

    expect(db.rows("assessments")).toHaveLength(1);
    expect(db.rows("assessments")[0].id).toBe(before);
    expect(db.rows("assessments")[0].title).toBe("Renamed");
  });
});

describe("what it refuses", () => {
  /**
   * **A published quiz is what learners are being tested on.** The schema would
   * refuse anyway — `assessment_attempts` is `on delete restrict` — and the
   * status check turns that into a clear 404 rather than a foreign-key error.
   */
  it("refuses to write a published version's quiz", async () => {
    const res = await putQuiz(publishedId, aQuiz());

    expect(res.status).toBe(404);
    expect(db.rows("quiz_questions")).toHaveLength(0);
  });

  it("refuses a question with one option", async () => {
    const res = await putQuiz(
      draftId,
      aQuiz({
        questions: [{ prompt: "Only one?", explanation: "", options: ["a"], correctIndex: 0 }],
      }),
    );

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at least two options/i);
  });

  /** A key pointing past the end of the options is a quiz nobody can pass. */
  it("refuses a correct answer that is not one of the options", async () => {
    const res = await putQuiz(
      draftId,
      aQuiz({
        questions: [
          { prompt: "Which?", explanation: "", options: ["a", "b"], correctIndex: 5 },
        ],
      }),
    );

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/must be one of the options/i);
    expect(db.rows("quiz_questions")).toHaveLength(0);
  });

  it("refuses a blank option", async () => {
    const res = await putQuiz(
      draftId,
      aQuiz({
        questions: [{ prompt: "Which?", explanation: "", options: ["a", ""], correctIndex: 0 }],
      }),
    );

    expect(res.status).toBe(400);
  });

  it("answers 404 to a learner", async () => {
    const res = await putQuiz(draftId, aQuiz(), learnerCookie);

    expect(res.status).toBe(404);
    expect(db.rows("quiz_questions")).toHaveLength(0);
  });
});

describe("reading it back", () => {
  it("returns the questions, options and the correct index", async () => {
    await putQuiz(
      draftId,
      aQuiz({
        questions: [
          { prompt: "Which?", explanation: "Because.", options: ["a", "b", "c"], correctIndex: 2 },
        ],
      }),
    );

    const res = await request(app).get(quizUrl(draftId)).set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    expect(res.body.editable).toBe(true);
    expect(res.body.quiz.questions[0].options).toEqual(["a", "b", "c"]);
    expect(res.body.quiz.questions[0].correctIndex).toBe(2);
    expect(res.body.quiz.questions[0].explanation).toBe("Because.");
  });

  /** A published version's quiz is readable, and the screen must not offer edits. */
  it("says a published version is not editable", async () => {
    const res = await request(app).get(quizUrl(publishedId)).set("Cookie", adminCookie);

    expect(res.body.editable).toBe(false);
  });

  it("returns null rather than an empty shell when there is no quiz", async () => {
    const res = await request(app).get(quizUrl(draftId)).set("Cookie", adminCookie);

    expect(res.body.quiz).toBeNull();
  });

  it("answers 404 to a learner", async () => {
    expect(
      (await request(app).get(quizUrl(draftId)).set("Cookie", learnerCookie)).status,
    ).toBe(404);
  });
});

describe("publishing a version with a quiz", () => {
  const publish = (versionId: string) =>
    post(app, `/admin/modules/${moduleId}/versions/${versionId}/publish`)
      .set("Cookie", adminCookie)
      .send({});

  it("publishes when the quiz has questions", async () => {
    await putQuiz(draftId, aQuiz());

    expect((await publish(draftId)).status).toBe(200);
  });

  /**
   * **An empty quiz is worse than no quiz**: the module page offers it, the
   * learner opens it, and there is nothing there. A half-finished module
   * reaches a learner as a bug in the platform, not as somebody's draft.
   */
  it("refuses a version whose quiz has no questions", async () => {
    await db.pool.query(
      `insert into assessments (module_version_id, type, title, passing_score)
       values ($1,'quiz','Components in React quiz',70)`,
      [draftId],
    );

    const res = await publish(draftId);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no questions/i);
    expect(db.rows("module_versions").find((v) => v.id === draftId)!.status).toBe("draft");
  });

  /** Not every module is assessed, so having no quiz at all is legitimate. */
  it("publishes a version with no quiz", async () => {
    expect((await publish(draftId)).status).toBe(200);
  });
});
