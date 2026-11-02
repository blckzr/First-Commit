import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../app.js";
import { createTestDb, type TestDb } from "@first-commit/test-db";
import { post } from "../test/http.js";
import type { Mailer } from "../mail/index.js";

const silentMailer: Mailer = { name: "test", async send() {} };

/**
 * The exercise editor (design.md §6.3's Test cases and Rubric tabs).
 *
 * **The gate is the point.** §6.3: "Publishing is blocked if the reference
 * solution fails any test." A learner who reaches an exercise whose own answer
 * fails has been handed a problem with no solution and no way to know it — so
 * what is asserted hardest here is that the gate cannot be walked around, and
 * in particular that **editing un-verifies**. An exercise verified on Monday
 * and edited on Tuesday has not been checked.
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

const url = (versionId: string) =>
  `/admin/modules/${moduleId}/versions/${versionId}/exercise`;

const putExercise = (versionId: string, body: unknown, cookie = adminCookie) =>
  request(app)
    .put(url(versionId))
    .set("Cookie", cookie)
    .set("Origin", "http://localhost:5173")
    .send(body as object);

const anExercise = (over: Record<string, unknown> = {}) => ({
  title: "Sum of even numbers",
  instructions: "Add up the even numbers.",
  passingScore: 100,
  runtime: "javascript",
  starterFiles: [{ path: "script.js", content: "function sumEven() {}" }],
  referenceSolution: [{ path: "script.js", content: "function sumEven(n) { return 0; }" }],
  testCases: [
    { name: "Sums [2, 4, 6] to 12", code: "expect(sumEven([2,4,6])).toBe(12);", visible: true },
    { name: "Works on a longer list", code: "expect(sumEven([5,8])).toBe(8);", visible: false },
  ],
  rubric: [{ name: "Readability", description: "Names say what they hold." }],
  ...over,
});

/** What the worker does on a full pass, and the only thing that sets this. */
const markVerified = async () =>
  db.pool.query(`update reference_solutions set last_verified_at = now()`);

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

  const skill = await one(`insert into skills (slug, name) values ('js','JS') returning id`);
  moduleId = await one(
    `insert into modules (skill_id, kind, slug, status)
     values ($1,'core','js-arrays','published') returning id`,
    [skill],
  );
  publishedId = await one(
    `insert into module_versions (module_id, version_no, title, status, published_at)
     values ($1,1,'Arrays','published', now()) returning id`,
    [moduleId],
  );
  draftId = await one(
    `insert into module_versions (module_id, version_no, title, status)
     values ($1,2,'Arrays','draft') returning id`,
    [moduleId],
  );
  await db.pool.query(
    `insert into lessons (module_version_id, sort_order, title, content)
     values ($1,0,'A lesson',$2)`,
    [draftId, JSON.stringify({ blocks: [] })],
  );
});

describe("writing an exercise", () => {
  it("stores the starter, the solution, the cases and the rubric", async () => {
    const res = await putExercise(draftId, anExercise());

    expect(res.status).toBe(200);
    expect(db.rows("test_cases")).toHaveLength(2);
    expect(db.rows("reference_solutions")).toHaveLength(1);
    expect(db.rows("rubrics")).toHaveLength(1);
  });

  /** §6 rule 2: hidden cases exist so a solution cannot special-case the visible ones. */
  it("keeps which cases are hidden", async () => {
    await putExercise(draftId, anExercise());

    const hidden = db.rows("test_cases").filter((c) => !c.is_visible);
    expect(hidden).toHaveLength(1);
    expect(hidden[0].name).toBe("Works on a longer list");
  });

  it("replaces the cases rather than adding to them", async () => {
    await putExercise(draftId, anExercise());
    await putExercise(
      draftId,
      anExercise({
        testCases: [{ name: "Only this one", code: "expect(1).toBe(1);", visible: true }],
      }),
    );

    expect(db.rows("test_cases")).toHaveLength(1);
    expect(db.rows("test_cases")[0].name).toBe("Only this one");
  });

  it("refuses an exercise with no test cases", async () => {
    const res = await putExercise(draftId, anExercise({ testCases: [] }));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at least one test case/i);
  });

  it("refuses an exercise with no reference solution", async () => {
    const res = await putExercise(draftId, anExercise({ referenceSolution: [] }));

    expect(res.status).toBe(400);
  });

  /** Only the five runtimes the platform has a harness for. */
  it("refuses a runtime nothing can run", async () => {
    const res = await putExercise(draftId, anExercise({ runtime: "svelte" }));

    expect(res.status).toBe(400);
  });

  it("refuses to write a published version's exercise", async () => {
    const res = await putExercise(publishedId, anExercise());

    expect(res.status).toBe(404);
    expect(db.rows("test_cases")).toHaveLength(0);
  });

  it("answers 404 to a learner", async () => {
    expect((await putExercise(draftId, anExercise(), learnerCookie)).status).toBe(404);
  });
});

describe("verification", () => {
  /**
   * **This is the whole gate.** An exercise verified before an edit has not
   * been verified after it, and a stale stamp is how a broken exercise reaches
   * a learner through a check that looks like it ran.
   */
  it("un-verifies the exercise on every save", async () => {
    await putExercise(draftId, anExercise());
    await markVerified();
    expect(db.rows("reference_solutions")[0].last_verified_at).not.toBeNull();

    await putExercise(draftId, anExercise({ title: "Renamed" }));

    expect(db.rows("reference_solutions")[0].last_verified_at).toBeNull();
  });

  /** The API has no sandbox, so it queues and waits to be told. */
  it("queues a job for the worker", async () => {
    await putExercise(draftId, anExercise());

    const res = await post(app, `${url(draftId)}/verify`).set("Cookie", adminCookie).send({});

    expect(res.status).toBe(202);
    expect(res.body.queued).toBe(true);
    const job = db.rows("ai_jobs")[0];
    expect(job.type).toBe("exercise_validation");
    expect(job.status).toBe("queued");
  });

  it("returns the waiting job rather than stacking a second", async () => {
    await putExercise(draftId, anExercise());
    const first = await post(app, `${url(draftId)}/verify`)
      .set("Cookie", adminCookie)
      .send({});

    const again = await post(app, `${url(draftId)}/verify`)
      .set("Cookie", adminCookie)
      .send({});

    expect(again.body.jobId).toBe(first.body.jobId);
    expect(again.body.queued).toBe(false);
    expect(db.rows("ai_jobs")).toHaveLength(1);
  });

  /**
   * **There is no endpoint that marks an exercise verified.** Only the worker
   * sets `last_verified_at`, because only the worker has a sandbox — so no
   * request can claim a solution passed.
   */
  it("offers no way to declare an exercise verified", async () => {
    await putExercise(draftId, anExercise());

    for (const body of [{ verified: true }, { verifiedAt: new Date().toISOString() }]) {
      await putExercise(draftId, { ...anExercise(), ...body });
    }

    expect(db.rows("reference_solutions")[0].last_verified_at).toBeNull();
  });

  it("answers 404 to a learner", async () => {
    await putExercise(draftId, anExercise());

    const res = await post(app, `${url(draftId)}/verify`)
      .set("Cookie", learnerCookie)
      .send({});

    expect(res.status).toBe(404);
    expect(db.rows("ai_jobs")).toHaveLength(0);
  });
});

describe("reading it back", () => {
  it("returns the solution, the hidden cases and the rubric for an admin", async () => {
    await putExercise(draftId, anExercise());

    const res = await request(app).get(url(draftId)).set("Cookie", adminCookie);

    expect(res.body.editable).toBe(true);
    expect(res.body.exercise.referenceSolution[0].content).toMatch(/return 0/);
    expect(res.body.exercise.testCases.filter((c: { visible: boolean }) => !c.visible)).toHaveLength(1);
    expect(res.body.exercise.rubric[0].name).toBe("Readability");
    expect(res.body.exercise.verifiedAt).toBeNull();
  });

  it("reports when it was last verified", async () => {
    await putExercise(draftId, anExercise());
    await markVerified();

    const res = await request(app).get(url(draftId)).set("Cookie", adminCookie);

    expect(res.body.exercise.verifiedAt).not.toBeNull();
  });

  it("returns null rather than an empty shell when there is no exercise", async () => {
    const res = await request(app).get(url(draftId)).set("Cookie", adminCookie);

    expect(res.body.exercise).toBeNull();
  });

  it("answers 404 to a learner", async () => {
    expect((await request(app).get(url(draftId)).set("Cookie", learnerCookie)).status).toBe(404);
  });
});

describe("the publish gate", () => {
  const publish = (versionId: string) =>
    post(app, `/admin/modules/${moduleId}/versions/${versionId}/publish`)
      .set("Cookie", adminCookie)
      .send({});

  /**
   * §6.3, and the reason the whole verification path exists. A learner who
   * reaches an exercise whose own answer fails has a problem with no solution
   * and no way to know it.
   */
  it("refuses a version whose exercise is not verified", async () => {
    await putExercise(draftId, anExercise());

    const res = await publish(draftId);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/has not been verified/i);
    expect(db.rows("module_versions").find((v) => v.id === draftId)!.status).toBe("draft");
  });

  it("publishes once the worker has verified it", async () => {
    await putExercise(draftId, anExercise());
    await markVerified();

    expect((await publish(draftId)).status).toBe(200);
  });

  /** Editing after verification re-closes the gate. */
  it("refuses again after the exercise is edited", async () => {
    await putExercise(draftId, anExercise());
    await markVerified();
    await putExercise(draftId, anExercise({ title: "Changed my mind" }));

    expect((await publish(draftId)).status).toBe(400);
  });

  /** Not every module has an exercise, so having none is legitimate. */
  it("publishes a version with no exercise", async () => {
    expect((await publish(draftId)).status).toBe(200);
  });
});
