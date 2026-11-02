import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../app.js";
import { createTestDb, type TestDb } from "@first-commit/test-db";
import { post, patch } from "../test/http.js";
import type { Mailer } from "../mail/index.js";

const silentMailer: Mailer = { name: "test", async send() {} };

/**
 * The module editor (design.md §6.3) and its impact preview (§6.4).
 *
 * **Most of this is §6 rule 6**, because this is where it lives:
 *
 * > Progress points at the exact `module_version_id` taken. In-progress
 * > learners finish their version; completed learners keep credit. Never
 * > repoint existing progress at a new version.
 *
 * A publish that moved a learner forward would be invisible — their lessons
 * would simply change under them, mid-module — so it is asserted directly
 * rather than inferred from the absence of an update statement.
 */

let db: TestDb;
let app: Express;
let adminCookie: string;
let learnerCookie: string;
let learnerId: string;
let moduleId: string;
let v1: string;

const asAdmin = (path: string) => request(app).get(path).set("Cookie", adminCookie);

const del = (path: string, cookie = adminCookie) =>
  request(app).delete(path).set("Cookie", cookie).set("Origin", "http://localhost:5173");

const one = async (sql: string, params: unknown[] = []) =>
  (await db.pool.query<{ id: string }>(sql, params)).rows[0].id;

const lesson = (title: string) => ({
  title,
  blocks: [{ type: "paragraph", text: "Something to read." }],
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
  learnerId = (
    await db.pool.query<{ id: string }>(`select id from users where email = 'learner@example.com'`)
  ).rows[0].id;

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
  v1 = await one(
    `insert into module_versions (module_id, version_no, title, description, status, published_at)
     values ($1,1,'Components in React','Props and JSX','published', now()) returning id`,
    [moduleId],
  );
  await db.pool.query(
    `insert into lessons (module_version_id, sort_order, title, content)
     values ($1,0,'What a component is',$2)`,
    [v1, JSON.stringify({ blocks: [{ type: "paragraph", text: "Version one." }] })],
  );
});

const startDraft = async () => {
  const res = await post(app, `/admin/modules/${moduleId}/versions`)
    .set("Cookie", adminCookie)
    .send({});
  return res.body.versionId as string;
};

describe("who may use it", () => {
  it("lists modules for an admin", async () => {
    const res = await asAdmin("/admin/modules");

    expect(res.status).toBe(200);
    expect(res.body.modules[0].slug).toBe("components-in-react");
    expect(res.body.modules[0].published.versionNo).toBe(1);
    expect(res.body.modules[0].draft).toBeNull();
  });

  /** §6.1 step 5: 404, not 403 — a 403 confirms the route exists. */
  it("answers 404 to a learner", async () => {
    expect((await request(app).get("/admin/modules").set("Cookie", learnerCookie)).status).toBe(
      404,
    );
  });
});

describe("starting a draft", () => {
  /**
   * An author changing a sentence should not retype a lesson. Starting empty is
   * how a small edit becomes a rewrite that loses something.
   */
  it("copies the published version's lessons", async () => {
    const versionId = await startDraft();

    const res = await asAdmin(`/admin/modules/${moduleId}`);
    const draft = res.body.versions.find((v: { id: string }) => v.id === versionId);

    expect(draft.versionNo).toBe(2);
    expect(draft.status).toBe("draft");
    expect(draft.lessons).toHaveLength(1);
    expect(draft.lessons[0].title).toBe("What a component is");
    expect(draft.lessons[0].blocks[0].text).toBe("Version one.");
  });

  /**
   * One draft at a time: two would be two answers to "what is being written",
   * and §6.3's header shows one. A second tab lands on the same draft.
   */
  it("returns the open draft rather than starting a second", async () => {
    const first = await startDraft();

    const again = await post(app, `/admin/modules/${moduleId}/versions`)
      .set("Cookie", adminCookie)
      .send({});

    expect(again.body.versionId).toBe(first);
    expect(again.body.reused).toBe(true);
    expect(db.rows("module_versions")).toHaveLength(2);
  });

  it("answers 404 for a module that does not exist", async () => {
    const res = await post(
      app,
      "/admin/modules/00000000-0000-4000-8000-000000000000/versions",
    )
      .set("Cookie", adminCookie)
      .send({});

    expect(res.status).toBe(404);
  });
});

describe("editing a draft", () => {
  it("saves the version's own fields", async () => {
    const versionId = await startDraft();

    const res = await patch(app, `/admin/modules/${moduleId}/versions/${versionId}`)
      .set("Cookie", adminCookie)
      .send({ title: "Components in React, revised", estimatedHours: 7 });

    expect(res.status).toBe(200);
    const stored = db.rows("module_versions").find((v) => v.id === versionId)!;
    expect(stored.title).toBe("Components in React, revised");
  });

  /**
   * **A published version is history, and learners are reading it.** The screen
   * only offers editing on a draft, so a request to edit a published version is
   * a stale tab or a bug — not a question to answer.
   */
  it("refuses to edit a published version", async () => {
    const res = await patch(app, `/admin/modules/${moduleId}/versions/${v1}`)
      .set("Cookie", adminCookie)
      .send({ title: "Rewritten under the learners" });

    expect(res.status).toBe(404);
    expect(db.rows("module_versions").find((v) => v.id === v1)!.title).toBe(
      "Components in React",
    );
  });

  it("replaces the lesson list in one request", async () => {
    const versionId = await startDraft();

    const res = await request(app)
      .put(`/admin/modules/${moduleId}/versions/${versionId}/lessons`)
      .set("Cookie", adminCookie)
      .set("Origin", "http://localhost:5173")
      .send({ lessons: [lesson("Second"), lesson("First")] });

    expect(res.status).toBe(200);
    const stored = db
      .rows("lessons")
      .filter((l) => l.module_version_id === versionId)
      .sort((a, b) => Number(a.sort_order) - Number(b.sort_order));

    expect(stored.map((l) => l.title)).toEqual(["Second", "First"]);
  });

  /** §13.3's block union, validated so nothing unrenderable is stored. */
  it("refuses a block type the renderer does not have", async () => {
    const versionId = await startDraft();

    const res = await request(app)
      .put(`/admin/modules/${moduleId}/versions/${versionId}/lessons`)
      .set("Cookie", adminCookie)
      .set("Origin", "http://localhost:5173")
      .send({
        lessons: [{ title: "Bad", blocks: [{ type: "iframe", src: "https://example.com" }] }],
      });

    expect(res.status).toBe(400);
  });

  it("refuses to write lessons onto a published version", async () => {
    const res = await request(app)
      .put(`/admin/modules/${moduleId}/versions/${v1}/lessons`)
      .set("Cookie", adminCookie)
      .set("Origin", "http://localhost:5173")
      .send({ lessons: [lesson("Rewritten")] });

    expect(res.status).toBe(404);
    expect(db.rows("lessons").filter((l) => l.module_version_id === v1)).toHaveLength(1);
  });
});

describe("publishing", () => {
  it("promotes the draft and supersedes the old version", async () => {
    const versionId = await startDraft();

    const res = await post(
      app,
      `/admin/modules/${moduleId}/versions/${versionId}/publish`,
    )
      .set("Cookie", adminCookie)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.versionNo).toBe(2);
    expect(res.body.supersededVersionNo).toBe(1);

    const versions = db.rows("module_versions");
    expect(versions.find((v) => v.id === versionId)!.status).toBe("published");
    expect(versions.find((v) => v.id === v1)!.status).toBe("superseded");
  });

  /**
   * **§6 rule 6, asserted directly.** A learner halfway through version 1 keeps
   * version 1 — not because anything checks a date, but because their
   * enrollment references that row and nothing moves it. A publish that
   * repointed them would change their lessons mid-module, invisibly.
   */
  it("leaves a learner mid-module on the version they started", async () => {
    await db.pool.query(
      `insert into module_enrollments (user_id, module_id, module_version_id)
       values ($1,$2,$3)`,
      [learnerId, moduleId, v1],
    );

    const versionId = await startDraft();
    await post(app, `/admin/modules/${moduleId}/versions/${versionId}/publish`)
      .set("Cookie", adminCookie)
      .send({});

    expect(db.rows("module_enrollments")[0].module_version_id).toBe(v1);
  });

  /** A learner who passed keeps the credit, against the version they took. */
  it("leaves a completion pointing at the version that was passed", async () => {
    await db.pool.query(
      `insert into module_completions (user_id, module_id, module_version_id, method, score)
       values ($1,$2,$3,'passed',90)`,
      [learnerId, moduleId, v1],
    );

    const versionId = await startDraft();
    await post(app, `/admin/modules/${moduleId}/versions/${versionId}/publish`)
      .set("Cookie", adminCookie)
      .send({});

    const completion = db.rows("module_completions")[0];
    expect(completion.module_version_id).toBe(v1);
    expect(Number(completion.score)).toBe(90);
  });

  /** §6.1 step 5: the one action here that changes what a learner sees. */
  it("writes an activity log entry in the same transaction", async () => {
    const versionId = await startDraft();
    await post(app, `/admin/modules/${moduleId}/versions/${versionId}/publish`)
      .set("Cookie", adminCookie)
      .send({});

    const log = db.rows("admin_activity_log");
    expect(log).toHaveLength(1);
    expect(log[0].action).toBe("module_version.published");
    expect(log[0].target_id).toBe(versionId);
  });

  /**
   * A version with no lessons is a module a learner opens and finds empty.
   * §6.3 blocks publishing on a failing reference solution; this is the same
   * idea, and the one check possible before the assessment editors exist.
   */
  it("refuses a version with nothing to read", async () => {
    const versionId = await startDraft();
    await request(app)
      .put(`/admin/modules/${moduleId}/versions/${versionId}/lessons`)
      .set("Cookie", adminCookie)
      .set("Origin", "http://localhost:5173")
      .send({ lessons: [] });

    const res = await post(
      app,
      `/admin/modules/${moduleId}/versions/${versionId}/publish`,
    )
      .set("Cookie", adminCookie)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at least one lesson/i);
    // Nothing moved: the old version is still the published one.
    expect(db.rows("module_versions").find((v) => v.id === v1)!.status).toBe("published");
  });

  it("refuses to publish a version that is already published", async () => {
    const res = await post(app, `/admin/modules/${moduleId}/versions/${v1}/publish`)
      .set("Cookie", adminCookie)
      .send({});

    expect(res.status).toBe(404);
  });
});

describe("the impact preview", () => {
  /**
   * §6.4's numbers are promises about real people, so they are counted. An
   * approximate figure is worse than none: an admin who learns they drift stops
   * reading the dialog.
   */
  it("counts roadmaps, learners taking it, and learners who passed", async () => {
    const path = await one(
      `insert into career_paths (slug, title, status) values ('jwd','JWD','published') returning id`,
    );
    const roadmap = await one(
      `insert into roadmaps (user_id, career_path_id, status) values ($1,$2,'active') returning id`,
      [learnerId, path],
    );
    await db.pool.query(
      `insert into roadmap_items (roadmap_id, module_id, sort_order) values ($1,$2,0)`,
      [roadmap, moduleId],
    );
    await db.pool.query(
      `insert into module_enrollments (user_id, module_id, module_version_id) values ($1,$2,$3)`,
      [learnerId, moduleId, v1],
    );

    const versionId = await startDraft();
    const res = await asAdmin(
      `/admin/modules/${moduleId}/versions/${versionId}/impact`,
    );

    expect(res.body.versionNo).toBe(2);
    expect(res.body.currentVersionNo).toBe(1);
    expect(res.body.activeRoadmaps).toBe(1);
    expect(res.body.takingCurrent).toBe(1);
    expect(res.body.passed).toBe(0);
  });

  /**
   * "Taking it now" means still working on it. Counting somebody who has
   * finished would tell an admin people are mid-module who are not, which is
   * the sentence the dialog makes a promise about.
   */
  it("does not count a learner who has already passed as still taking it", async () => {
    await db.pool.query(
      `insert into module_enrollments (user_id, module_id, module_version_id) values ($1,$2,$3)`,
      [learnerId, moduleId, v1],
    );
    await db.pool.query(
      `insert into module_completions (user_id, module_id, module_version_id, method, score)
       values ($1,$2,$3,'passed',90)`,
      [learnerId, moduleId, v1],
    );

    const versionId = await startDraft();
    const res = await asAdmin(
      `/admin/modules/${moduleId}/versions/${versionId}/impact`,
    );

    expect(res.body.takingCurrent).toBe(0);
    expect(res.body.passed).toBe(1);
  });
});

describe("discarding a draft", () => {
  /**
   * §6 rule 5: nothing learners depend on is hard-deleted. A draft is by
   * definition something no learner has seen, which is what makes this the one
   * safe delete here.
   */
  it("removes the draft and its lessons", async () => {
    const versionId = await startDraft();

    const res = await del(`/admin/modules/${moduleId}/versions/${versionId}`);

    expect(res.status).toBe(200);
    expect(db.rows("module_versions")).toHaveLength(1);
    expect(db.rows("lessons").filter((l) => l.module_version_id === versionId)).toHaveLength(0);
  });

  /** The published version is what learners are reading. */
  it("refuses to discard a published version", async () => {
    const res = await del(`/admin/modules/${moduleId}/versions/${v1}`);

    expect(res.status).toBe(404);
    expect(db.rows("module_versions").find((v) => v.id === v1)!.status).toBe("published");
  });

  /** §6.12 is where an author asks "where did my draft go". */
  it("logs the discard", async () => {
    const versionId = await startDraft();
    await del(`/admin/modules/${moduleId}/versions/${versionId}`);

    expect(db.rows("admin_activity_log")[0].action).toBe("module_version.discarded");
  });

  it("answers 404 to a learner", async () => {
    const versionId = await startDraft();

    const res = await del(`/admin/modules/${moduleId}/versions/${versionId}`, learnerCookie);

    expect(res.status).toBe(404);
    expect(db.rows("module_versions")).toHaveLength(2);
  });
});
