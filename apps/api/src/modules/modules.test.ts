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
/** Option ids per question index, in order. */
let options: string[][];

const read = (path: string) => request(app).get(path).set("Cookie", cookie);
const send = (path: string) =>
  request(app).post(path).set("Cookie", cookie).set("Origin", config.appOrigin);

/**
 * One module with three lessons and a four-question quiz at 70%.
 *
 * Four questions and a 70% pass means three right answers are needed, which
 * makes "2 of 4" and "3 of 4" different outcomes — a pass boundary that a
 * rounding mistake would move.
 */
async function buildContent(): Promise<void> {
  ids = {};
  options = [];
  const one = async (sql: string, values: unknown[] = []) =>
    (await db.pool.query<{ id: string }>(sql, values)).rows[0].id;

  ids.skill = await one(`insert into skills (slug, name) values ('html','HTML') returning id`);
  ids.module = await one(
    `insert into modules (skill_id, kind, slug, status) values ($1,'core','html-basics','published') returning id`,
    [ids.skill],
  );
  ids.version = await one(
    `insert into module_versions (module_id, version_no, title, description, estimated_hours, status)
     values ($1, 1, 'HTML basics', 'The tags a page is built from.', 4, 'published') returning id`,
    [ids.module],
  );

  for (const [i, title] of ["What a page is made of", "Saying what content means", "Images and alt text"].entries()) {
    ids[`lesson${i}`] = await one(
      `insert into lessons (module_version_id, sort_order, title, content)
       values ($1, $2, $3, $4) returning id`,
      [ids.version, i, title, JSON.stringify({ blocks: [{ type: "paragraph", text: "…" }] })],
    );
  }

  ids.quiz = await one(
    `insert into assessments (module_version_id, type, title, instructions, passing_score, sort_order)
     values ($1, 'quiz', 'HTML basics quiz', 'Four questions.', 70, 0) returning id`,
    [ids.version],
  );

  for (let q = 0; q < 4; q++) {
    const questionId = await one(
      `insert into quiz_questions (assessment_id, sort_order, prompt, explanation, linked_lesson_id)
       values ($1, $2, $3, $4, $5) returning id`,
      [ids.quiz, q, `Question ${q + 1}?`, `Because of reason ${q + 1}.`, ids[`lesson${q % 3}`]],
    );
    ids[`q${q}`] = questionId;

    const forQuestion: string[] = [];
    for (let o = 0; o < 3; o++) {
      forQuestion.push(
        await one(
          `insert into quiz_options (question_id, sort_order, text) values ($1,$2,$3) returning id`,
          [questionId, o, `Option ${o + 1}`],
        ),
      );
    }
    options.push(forQuestion);

    // Option 0 is always the correct one.
    await db.pool.query(
      `insert into quiz_answer_keys (question_id, correct_option_id) values ($1,$2)`,
      [questionId, forQuestion[0]],
    );
  }
}

/** Answers with the first `correctCount` questions right and the rest wrong. */
function answers(correctCount: number): Record<string, string> {
  const out: Record<string, string> = {};
  for (let q = 0; q < 4; q++) {
    out[ids[`q${q}`]] = q < correctCount ? options[q][0] : options[q][1];
  }
  return out;
}

beforeEach(async () => {
  db = createTestDb();
  app = createApp({ pool: db.pool, mailer: silentMailer });

  const signUp = await post(app, "/auth/signup").send({
    fullName: "Jan Kevin Gerona",
    email: "learner@example.com",
    password: "a-good-password",
  });
  cookie = (signUp.headers["set-cookie"] as unknown as string[])[0].split(";")[0];
  learnerId = (db.rows("users")[0] as { id: string }).id;

  await buildContent();
});

describe("GET /modules/:id", () => {
  it("returns the module with its lessons and assessment", async () => {
    const res = await read(`/modules/${ids.module}`);
    expect(res.status).toBe(200);

    const page = res.body.module;
    expect(page.title).toBe("HTML basics");
    expect(page.versionNo).toBe(1);
    expect(page.lessons.map((l: { title: string }) => l.title)).toEqual([
      "What a page is made of",
      "Saying what content means",
      "Images and alt text",
    ]);
    expect(page.assessments).toHaveLength(1);
    expect(page.assessments[0].questionCount).toBe(4);
    expect(page.enrolled).toBe(false);
  });

  /**
   * §6 rule 2. The module page describes the assessment; it does not carry the
   * questions at all, so there is nothing here to diff against a key.
   */
  it("carries no questions and no answer key", async () => {
    const res = await read(`/modules/${ids.module}`);
    const body = JSON.stringify(res.body);

    for (const forQuestion of options) {
      for (const optionId of forQuestion) expect(body).not.toContain(optionId);
    }
    expect(body).not.toMatch(/Question \d\?/);
    expect(body).not.toMatch(/correct|answer_key|answerKey/i);
  });

  it("needs a session", async () => {
    const res = await request(app).get(`/modules/${ids.module}`);
    expect(res.status).toBe(401);
  });

  it("404s a module that does not exist, and a malformed id", async () => {
    expect((await read("/modules/00000000-0000-0000-0000-000000000000")).status).toBe(404);
    expect((await read("/modules/nope")).status).toBe(404);
  });

  it("hides a draft module", async () => {
    await db.pool.query(`update modules set status = 'draft' where id = $1`, [ids.module]);
    expect((await read(`/modules/${ids.module}`)).status).toBe(404);
  });
});

describe("starting a module", () => {
  it("enrols the learner at the published version, once", async () => {
    expect((await send(`/modules/${ids.module}/start`)).status).toBe(200);
    expect((await send(`/modules/${ids.module}/start`)).status).toBe(200);

    const rows = db.rows("module_enrollments");
    expect(rows).toHaveLength(1);
    expect(rows[0].module_version_id).toBe(ids.version);
    expect(rows[0].current_lesson_id).toBe(ids.lesson0);
  });

  /** §6 rule 6: in-progress learners finish their version. */
  it("does not repoint a learner when a newer version is published", async () => {
    await send(`/modules/${ids.module}/start`);

    await db.pool.query(`update module_versions set status = 'superseded' where id = $1`, [ids.version]);
    const v2 = await db.pool.query<{ id: string }>(
      `insert into module_versions (module_id, version_no, title, estimated_hours, status, change_summary)
       values ($1, 2, 'HTML basics', 4, 'published', 'Clearer examples.') returning id`,
      [ids.module],
    );

    await send(`/modules/${ids.module}/start`);
    expect(db.rows("module_enrollments")[0].module_version_id).toBe(ids.version);

    const page = (await read(`/modules/${ids.module}`)).body.module;
    expect(page.versionNo).toBe(1);
    expect(page.newerVersion).toEqual({ versionNo: 2, changeSummary: "Clearer examples." });
    expect(v2.rows[0].id).not.toBe(ids.version);
  });
});

describe("lesson progress", () => {
  beforeEach(async () => {
    await send(`/modules/${ids.module}/start`);
  });

  it("records a lesson as read and moves the bookmark on", async () => {
    expect((await send(`/lessons/${ids.lesson0}/complete`)).status).toBe(200);

    expect(db.rows("lesson_progress")).toHaveLength(1);
    expect(db.rows("module_enrollments")[0].current_lesson_id).toBe(ids.lesson1);

    const page = (await read(`/modules/${ids.module}`)).body.module;
    expect(page.lessons[0].completed).toBe(true);
    expect(page.lessons[1].completed).toBe(false);
  });

  /** Re-reading lesson 1 should not undo having reached lesson 3. */
  it("never moves the bookmark backwards", async () => {
    await send(`/lessons/${ids.lesson0}/complete`);
    await send(`/lessons/${ids.lesson1}/complete`);
    expect(db.rows("module_enrollments")[0].current_lesson_id).toBe(ids.lesson2);

    await send(`/lessons/${ids.lesson0}/complete`);
    expect(db.rows("module_enrollments")[0].current_lesson_id).toBe(ids.lesson2);
  });

  it("is idempotent", async () => {
    await send(`/lessons/${ids.lesson0}/complete`);
    await send(`/lessons/${ids.lesson0}/complete`);
    expect(db.rows("lesson_progress")).toHaveLength(1);
  });

  /** Ownership: the lesson must belong to a version this learner is enrolled in. */
  it("refuses a lesson the learner is not enrolled in", async () => {
    const other = await db.pool.query<{ id: string }>(
      `insert into modules (skill_id, kind, slug, status) values ($1,'core','other','published') returning id`,
      [ids.skill],
    );
    const otherVersion = await db.pool.query<{ id: string }>(
      `insert into module_versions (module_id, version_no, title, estimated_hours, status)
       values ($1, 1, 'Other', 1, 'published') returning id`,
      [other.rows[0].id],
    );
    const otherLesson = await db.pool.query<{ id: string }>(
      `insert into lessons (module_version_id, sort_order, title) values ($1, 0, 'Theirs') returning id`,
      [otherVersion.rows[0].id],
    );

    const res = await send(`/lessons/${otherLesson.rows[0].id}/complete`);
    expect(res.status).toBe(404);
    expect(db.rows("lesson_progress")).toHaveLength(0);
  });
});

describe("GET /assessments/:id", () => {
  it("returns the questions and options", async () => {
    const res = await read(`/assessments/${ids.quiz}`);
    expect(res.status).toBe(200);

    const quiz = res.body.assessment;
    expect(quiz.title).toBe("HTML basics quiz");
    expect(quiz.passingScore).toBe(70);
    expect(quiz.questions).toHaveLength(4);
    expect(quiz.questions[0].options).toHaveLength(3);
  });

  /**
   * The check this endpoint exists to pass.
   *
   * Every option id is necessarily present — the learner has to be able to
   * choose one. What must not be present is anything saying **which** is
   * correct: no flag, no extra field on one option, and no explanation, because
   * an explanation usually states the answer outright.
   */
  it("says nothing about which option is correct", async () => {
    const res = await read(`/assessments/${ids.quiz}`);
    const body = JSON.stringify(res.body);

    // Every option is offered, and every option looks exactly alike.
    for (const question of res.body.assessment.questions) {
      for (const option of question.options) {
        expect(Object.keys(option).sort()).toEqual(["id", "text"]);
      }
    }
    expect(body).not.toMatch(/Because of reason/);
    expect(body).not.toMatch(/correct|isAnswer|answer_key|answerKey/i);
    expect(body).not.toMatch(/linked_lesson|linkedLesson/i);
  });

  it("needs a session", async () => {
    expect((await request(app).get(`/assessments/${ids.quiz}`)).status).toBe(401);
  });
});

describe("submitting a quiz", () => {
  it("grades a pass and writes the completion", async () => {
    const res = await send(`/assessments/${ids.quiz}/attempts`).send({ answers: answers(4) });

    expect(res.status).toBe(200);
    expect(res.body.result.score).toBe(100);
    expect(res.body.result.correctCount).toBe(4);
    expect(res.body.result.questionCount).toBe(4);
    expect(res.body.result.passed).toBe(true);
    expect(res.body.result.completedModule).toBe(true);

    const completion = db.rows("module_completions")[0];
    expect(completion.user_id).toBe(learnerId);
    expect(completion.module_id).toBe(ids.module);
    expect(completion.module_version_id).toBe(ids.version);
    expect(completion.method).toBe("passed");
    expect(Number(completion.score)).toBe(100);
  });

  /** §5.10: "You got 4 of 8 (50%). You need 6 to pass." */
  it("grades a fail, says how many were needed, and writes no completion", async () => {
    const res = await send(`/assessments/${ids.quiz}/attempts`).send({ answers: answers(2) });

    expect(res.body.result.score).toBe(50);
    expect(res.body.result.correctCount).toBe(2);
    expect(res.body.result.needed).toBe(3);
    expect(res.body.result.passed).toBe(false);
    expect(db.rows("module_completions")).toHaveLength(0);
    expect(db.rows("assessment_attempts")).toHaveLength(1);
  });

  /** The pass boundary: 3 of 4 is 75%, which clears 70%. */
  it("passes at exactly the boundary", async () => {
    const res = await send(`/assessments/${ids.quiz}/attempts`).send({ answers: answers(3) });
    expect(res.body.result.score).toBe(75);
    expect(res.body.result.passed).toBe(true);
  });

  /**
   * §5.10: "Correct answers are shown only for questions answered correctly,
   * so retakes remain meaningful."
   */
  it("withholds the right answer for questions answered wrongly", async () => {
    const res = await send(`/assessments/${ids.quiz}/attempts`).send({ answers: answers(2) });
    const graded = res.body.result.answers;

    expect(graded[0].correct).toBe(true);
    expect(graded[0].correctOptionId).toBe(options[0][0]);
    expect(graded[0].explanation).toBe("Because of reason 1.");

    expect(graded[2].correct).toBe(false);
    expect(graded[2].correctOptionId).toBeNull();
    expect(graded[2].explanation).toBeNull();
    // The whole payload must not contain the key for a question they got wrong.
    expect(JSON.stringify(res.body)).not.toContain(options[2][0]);
  });

  /** §5.10's "Topics to review" needs the lesson, and only where it helps. */
  it("points a wrong answer at the lesson it came from", async () => {
    const res = await send(`/assessments/${ids.quiz}/attempts`).send({ answers: answers(2) });
    const graded = res.body.result.answers;

    expect(graded[2].linkedLessonId).toBe(ids.lesson2);
    expect(graded[0].linkedLessonId).toBeNull();
  });

  it("counts attempts, and keeps the better score on a retake", async () => {
    await send(`/assessments/${ids.quiz}/attempts`).send({ answers: answers(3) });
    await send(`/assessments/${ids.quiz}/attempts`).send({ answers: answers(4) });

    expect(db.rows("assessment_attempts")).toHaveLength(2);
    expect(Number(db.rows("module_completions")[0].score)).toBe(100);

    /**
     * A *passing* retake that scores lower must not reduce what the learner
     * earned. This is the case that matters: a failing retake never reaches the
     * completion at all, so it proves nothing about which score is kept.
     */
    await send(`/assessments/${ids.quiz}/attempts`).send({ answers: answers(3) });
    expect(Number(db.rows("module_completions")[0].score)).toBe(100);

    // And a failing retake leaves it alone too.
    await send(`/assessments/${ids.quiz}/attempts`).send({ answers: answers(1) });
    expect(Number(db.rows("module_completions")[0].score)).toBe(100);
    expect(db.rows("module_completions")).toHaveLength(1);
    expect(db.rows("assessment_attempts")).toHaveLength(4);
  });

  it("records a test-out as tested out, not as passed", async () => {
    await send(`/assessments/${ids.quiz}/attempts`).send({ answers: answers(4), testOut: true });

    const completion = db.rows("module_completions")[0];
    expect(completion.method).toBe("tested_out");
    expect(db.rows("assessment_attempts")[0].is_test_out).toBe(true);
  });

  it("treats a blank answer as wrong rather than failing", async () => {
    const res = await send(`/assessments/${ids.quiz}/attempts`).send({ answers: {} });
    expect(res.status).toBe(200);
    expect(res.body.result.score).toBe(0);
    expect(res.body.result.answers.every((a: { chosenOptionId: null }) => a.chosenOptionId === null)).toBe(true);
  });

  it("enrols the learner at the version they were graded against", async () => {
    await send(`/assessments/${ids.quiz}/attempts`).send({ answers: answers(4), testOut: true });
    expect(db.rows("module_enrollments")[0].module_version_id).toBe(ids.version);
  });

  it("needs a session", async () => {
    const res = await request(app)
      .post(`/assessments/${ids.quiz}/attempts`)
      .set("Origin", config.appOrigin)
      .send({ answers: answers(4) });
    expect(res.status).toBe(401);
    expect(db.rows("assessment_attempts")).toHaveLength(0);
  });
});

/**
 * AGENT.md §6 rule 1 — "No endpoint accepts a completion, a score, or a
 * `passed` flag as input."
 *
 * This is the first place in the repo that writes evidence, so these are the
 * tests that keep it honest.
 */
describe("§6 rule 1 — the browser cannot write its own result", () => {
  it("rejects a body that carries a score or a passed flag", async () => {
    for (const extra of [{ score: 100 }, { passed: true }, { correctCount: 4 }]) {
      const res = await send(`/assessments/${ids.quiz}/attempts`).send({
        answers: answers(0),
        ...extra,
      });
      expect(res.status, JSON.stringify(extra)).toBe(400);
    }
    expect(db.rows("assessment_attempts")).toHaveLength(0);
    expect(db.rows("module_completions")).toHaveLength(0);
  });

  /**
   * An option belonging to another question is not an answer at all.
   *
   * It grades as wrong either way — the comparison is per question — so what
   * this really protects is the **stored attempt**: `assessment_attempts.answers`
   * is what an admin reads when a learner disputes a result, and it must not
   * record them choosing an option that was never on their screen.
   */
  it("records an option from another question as no answer, not as chosen", async () => {
    const res = await send(`/assessments/${ids.quiz}/attempts`).send({
      answers: {
        [ids.q0]: options[1][0], // question 2's correct option, sent for question 1
        [ids.q1]: options[0][0],
        [ids.q2]: options[3][0],
        [ids.q3]: options[2][0],
      },
    });

    expect(res.body.result.correctCount).toBe(0);
    expect(res.body.result.passed).toBe(false);
    expect(res.body.result.answers.every((a: { chosenOptionId: null }) => a.chosenOptionId === null)).toBe(true);

    const stored = db.rows("assessment_attempts")[0].answers as Record<string, unknown>;
    expect(Object.values(stored).every((v) => v === null)).toBe(true);
  });

  it("ignores an answer naming an option that does not exist", async () => {
    const res = await send(`/assessments/${ids.quiz}/attempts`).send({
      answers: { [ids.q0]: "00000000-0000-0000-0000-000000000000" },
    });
    expect(res.body.result.correctCount).toBe(0);
  });

  /** Submitting answers for someone else's questions changes nothing of theirs. */
  it("writes the completion against the caller, whatever the body says", async () => {
    const other = await db.pool.query<{ id: string }>(
      `insert into users (email, password_hash, full_name)
       values ('other@example.com','h','Other') returning id`,
    );

    await send(`/assessments/${ids.quiz}/attempts`).send({
      answers: answers(4),
      // Ignored: `.strict()` rejects unknown keys outright.
    });

    const completions = db.rows("module_completions");
    expect(completions).toHaveLength(1);
    expect(completions[0].user_id).toBe(learnerId);
    expect(completions.some((c) => c.user_id === other.rows[0].id)).toBe(false);
  });

  it("has no endpoint that writes a completion directly", async () => {
    for (const [method, path] of [
      ["post", "/modules/completions"],
      ["post", `/modules/${ids.module}/complete`],
      ["put", `/modules/${ids.module}/completion`],
      ["post", `/modules/${ids.module}/completions`],
    ] as const) {
      const res = await request(app)
        [method](path)
        .set("Cookie", cookie)
        .set("Origin", config.appOrigin)
        .send({ passed: true, score: 100 });
      expect(res.status, `${method} ${path}`).toBe(404);
    }
    expect(db.rows("module_completions")).toHaveLength(0);
  });
});
