import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../app.js";
import { createTestDb, type TestDb } from "@first-commit/test-db";
import { post } from "../test/http.js";
import type { Mailer } from "../mail/index.js";

const silentMailer: Mailer = { name: "test", async send() {} };

/**
 * The capstone brief editor (design.md §6.5).
 *
 * **Briefs follow the same versioning rules as modules**, so the §6 rule 6
 * assertions are the same shape — and the gate that is particular to a brief is
 * §6.5's: "the brief cannot be published for an option without one [a starter
 * template]". A learner who picks Vue and finds no template cannot start their
 * capstone **at all**, and nothing else in the platform stops them getting
 * there.
 */

let db: TestDb;
let app: Express;
let adminCookie: string;
let learnerCookie: string;
let learnerId: string;
let briefId: string;
let v1: string;
let reactId: string;
let vueId: string;

const one = async (sql: string, params: unknown[] = []) =>
  (await db.pool.query<{ id: string }>(sql, params)).rows[0].id;

const startDraft = async () =>
  (
    await post(app, `/admin/briefs/${briefId}/versions`).set("Cookie", adminCookie).send({})
  ).body.versionId as string;

const putMilestones = (versionId: string, milestones: unknown[], cookie = adminCookie) =>
  request(app)
    .put(`/admin/briefs/${briefId}/versions/${versionId}/milestones`)
    .set("Cookie", cookie)
    .set("Origin", "http://localhost:5173")
    .send({ milestones });

const putTemplates = (versionId: string, templates: unknown[]) =>
  request(app)
    .put(`/admin/briefs/${briefId}/versions/${versionId}/templates`)
    .set("Cookie", adminCookie)
    .set("Origin", "http://localhost:5173")
    .send({ templates });

const publish = (versionId: string) =>
  post(app, `/admin/briefs/${briefId}/versions/${versionId}/publish`)
    .set("Cookie", adminCookie)
    .send({});

const aMilestone = (over: Record<string, unknown> = {}) => ({
  title: "Add and edit tasks",
  acceptanceCriteria: ["A task can be added"],
  reviewChecklist: ["Is the form accessible?"],
  explanationQuestion: "How does your form stop an empty task?",
  checks: [{ type: "file_exists", name: "TaskForm exists", path: "src/components/TaskForm.*" }],
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

  const pathId = await one(
    `insert into career_paths (slug, title, status) values ('jwd','JWD','published') returning id`,
  );
  const trackId = await one(
    `insert into tracks (career_path_id, title, status) values ($1,'Frontend','published') returning id`,
    [pathId],
  );
  reactId = await one(`insert into technologies (slug, name) values ('react','React') returning id`);
  vueId = await one(`insert into technologies (slug, name) values ('vue','Vue') returning id`);
  const decision = await one(
    `insert into technology_decisions (track_id, title) values ($1,'Choose a framework') returning id`,
    [trackId],
  );
  await db.pool.query(
    `insert into decision_options (decision_id, technology_id, status) values ($1,$2,'published'),($1,$3,'published')`,
    [decision, reactId, vueId],
  );

  briefId = await one(
    `insert into capstone_briefs (track_id, slug, status) values ($1,'task-tracker','published') returning id`,
    [trackId],
  );
  v1 = await one(
    `insert into capstone_brief_versions (brief_id, version_no, title, status, published_at)
     values ($1,1,'Task tracker','published', now()) returning id`,
    [briefId],
  );
  const milestone = await one(
    `insert into milestones (brief_version_id, sort_order, title) values ($1,0,'Set up repository') returning id`,
    [v1],
  );
  await db.pool.query(
    `insert into milestone_checks (milestone_id, type, name, config, sort_order)
     values ($1,'file_exists','README exists',$2,0)`,
    [milestone, JSON.stringify({ path: "README.md" })],
  );
  await db.pool.query(
    `insert into starter_templates (brief_version_id, technology_id, repo_full_name)
     values ($1,$2,'first-commit/task-tracker-react'),($1,$3,'first-commit/task-tracker-vue')`,
    [v1, reactId, vueId],
  );
});

describe("starting a draft", () => {
  it("copies the milestones, their checks and the templates", async () => {
    const versionId = await startDraft();

    const res = await request(app).get(`/admin/briefs/${briefId}`).set("Cookie", adminCookie);
    const draft = res.body.versions.find((v: { id: string }) => v.id === versionId);

    expect(draft.versionNo).toBe(2);
    expect(draft.milestones).toHaveLength(1);
    expect(draft.milestones[0].checks[0].path).toBe("README.md");
    expect(draft.templates).toHaveLength(2);
  });

  it("returns the open draft rather than starting a second", async () => {
    const first = await startDraft();
    const again = await post(app, `/admin/briefs/${briefId}/versions`)
      .set("Cookie", adminCookie)
      .send({});

    expect(again.body.versionId).toBe(first);
    expect(db.rows("capstone_brief_versions")).toHaveLength(2);
  });
});

describe("milestones and checks", () => {
  it("replaces the list, keeping the check configuration", async () => {
    const versionId = await startDraft();

    const res = await putMilestones(versionId, [
      aMilestone(),
      aMilestone({
        title: "Deploy",
        checks: [{ type: "deployment_url", name: "The site loads" }],
      }),
    ]);

    expect(res.status).toBe(200);
    const stored = db.rows("milestones").filter((m) => m.brief_version_id === versionId);
    expect(stored).toHaveLength(2);
    /*
     * Scoped to the draft's own milestones. The published version still has its
     * README check — that is the point of versioning, and an unscoped `find`
     * would have returned it and passed for the wrong reason.
     */
    const draftMilestoneIds = stored.map((m) => m.id);
    const fileCheck = db
      .rows("milestone_checks")
      .find((c) => draftMilestoneIds.includes(c.milestone_id) && c.type === "file_exists")!;
    expect((fileCheck.config as { path: string }).path).toBe("src/components/TaskForm.*");
  });

  /** A workflow check without a test name would pass against nothing. */
  it("refuses a workflow check with no test name", async () => {
    const versionId = await startDraft();

    const res = await putMilestones(versionId, [
      aMilestone({
        checks: [{ type: "workflow_test", name: "Tests pass", workflow: "ci.yml" }],
      }),
    ]);

    expect(res.status).toBe(400);
  });

  it("refuses to write a published version's milestones", async () => {
    const before = db.rows("milestones").length;

    expect((await putMilestones(v1, [aMilestone()])).status).toBe(404);
    expect(db.rows("milestones")).toHaveLength(before);
  });

  it("answers 404 to a learner", async () => {
    const versionId = await startDraft();
    expect((await putMilestones(versionId, [aMilestone()], learnerCookie)).status).toBe(404);
  });
});

describe("templates", () => {
  it("refuses a repository that is not owner/name", async () => {
    const versionId = await startDraft();

    const res = await putTemplates(versionId, [
      { technologyId: reactId, repoFullName: "not a repo" },
    ]);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/owner\/name/i);
  });

  it("reports which technologies have no template", async () => {
    const versionId = await startDraft();
    await putTemplates(versionId, [
      { technologyId: reactId, repoFullName: "first-commit/task-tracker-react" },
    ]);

    const res = await request(app).get(`/admin/briefs/${briefId}`).set("Cookie", adminCookie);
    const draft = res.body.versions.find((v: { id: string }) => v.id === versionId);

    expect(draft.missingTemplates).toEqual(["Vue"]);
  });
});

describe("the publish gate", () => {
  /**
   * §6.5, and the reason the gate exists. A learner who picks Vue and finds no
   * template cannot start their capstone at all — the admin overview counts
   * that gap, this refuses to create it.
   */
  it("refuses when a technology option has no starter template", async () => {
    const versionId = await startDraft();
    await putMilestones(versionId, [aMilestone()]);
    await putTemplates(versionId, [
      { technologyId: reactId, repoFullName: "first-commit/task-tracker-react" },
    ]);

    const res = await publish(versionId);

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Vue");
    expect(res.body.error).toMatch(/could not start the project/i);
  });

  it("publishes once every option has one", async () => {
    const versionId = await startDraft();
    await putMilestones(versionId, [aMilestone()]);

    const res = await publish(versionId);

    expect(res.status).toBe(200);
    expect(res.body.supersededVersionNo).toBe(1);
    expect(db.rows("capstone_brief_versions").find((v) => v.id === v1)!.status).toBe("superseded");
  });

  it("refuses a brief with no milestones", async () => {
    const versionId = await startDraft();
    await putMilestones(versionId, []);

    const res = await publish(versionId);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at least one milestone/i);
  });

  /**
   * §6 rule 6, as for modules: `capstone_projects` references a version, so a
   * learner part-way through finishes the one they started because nothing
   * moves them.
   */
  it("leaves a learner's project on the version they started", async () => {
    const roadmap = await one(
      `insert into roadmaps (user_id, career_path_id, status)
       values ($1,(select id from career_paths limit 1),'active') returning id`,
      [learnerId],
    );
    await db.pool.query(
      `insert into capstone_projects (user_id, roadmap_id, brief_version_id, technology_id, status)
       values ($1,$2,$3,$4,'in_progress')`,
      [learnerId, roadmap, v1, reactId],
    );

    const versionId = await startDraft();
    await putMilestones(versionId, [aMilestone()]);
    await publish(versionId);

    expect(db.rows("capstone_projects")[0].brief_version_id).toBe(v1);
  });

  it("logs the publish", async () => {
    const versionId = await startDraft();
    await putMilestones(versionId, [aMilestone()]);
    await publish(versionId);

    expect(db.rows("admin_activity_log")[0].action).toBe("brief_version.published");
  });

  it("answers 404 to a learner", async () => {
    const versionId = await startDraft();
    const res = await post(app, `/admin/briefs/${briefId}/versions/${versionId}/publish`)
      .set("Cookie", learnerCookie)
      .send({});

    expect(res.status).toBe(404);
  });
});
