import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../app.js";
import { createTestDb, type TestDb } from "../test/db.js";
import { post } from "../test/http.js";
import type { Mailer } from "../mail/index.js";

const silentMailer: Mailer = { name: "test", async send() {} };

let db: TestDb;
let app: Express;
let cookie: string;
let learnerId: string;
let ids: Record<string, string>;

const read = () => request(app).get("/home").set("Cookie", cookie);

/** Two core skills, four modules, three lessons on the first. */
async function buildContent(): Promise<void> {
  ids = {};
  const one = async (sql: string, values: unknown[] = []) =>
    (await db.pool.query<{ id: string }>(sql, values)).rows[0].id;

  ids.path = await one(
    `insert into career_paths (slug, title, status) values ('jwd','Junior Web Developer','published') returning id`,
  );
  ids.track = await one(
    `insert into tracks (career_path_id, title, status) values ($1,'Frontend','published') returning id`,
    [ids.path],
  );
  ids.htmlSkill = await one(`insert into skills (slug,name) values ('html','HTML') returning id`);
  ids.jsSkill = await one(`insert into skills (slug,name) values ('js','JavaScript') returning id`);

  ids.htmlPathSkill = await one(
    `insert into path_skills (career_path_id, track_id, skill_id, layer, sort_order)
     values ($1, null, $2, 'core', 0) returning id`,
    [ids.path, ids.htmlSkill],
  );
  ids.jsPathSkill = await one(
    `insert into path_skills (career_path_id, track_id, skill_id, layer, sort_order)
     values ($1, null, $2, 'core', 1) returning id`,
    [ids.path, ids.jsSkill],
  );

  const addModule = async (
    key: string,
    skill: string,
    pathSkill: string,
    slug: string,
    title: string,
    hours: number,
    order: number,
  ) => {
    ids[key] = await one(
      `insert into modules (skill_id, kind, slug, status) values ($1,'core',$2,'published') returning id`,
      [skill, slug],
    );
    ids[`${key}Version`] = await one(
      `insert into module_versions (module_id, version_no, title, estimated_hours, status)
       values ($1, 1, $2, $3, 'published') returning id`,
      [ids[key], title, hours],
    );
    await db.pool.query(
      `insert into path_skill_modules (path_skill_id, module_id, sort_order) values ($1,$2,$3)`,
      [pathSkill, ids[key], order],
    );
  };

  await addModule("htmlBasics", ids.htmlSkill, ids.htmlPathSkill, "html-basics", "HTML basics", 4, 0);
  await addModule("forms", ids.htmlSkill, ids.htmlPathSkill, "forms", "Forms and semantics", 5, 1);
  await addModule("jsBasics", ids.jsSkill, ids.jsPathSkill, "js-basics", "JavaScript basics", 8, 0);
  await addModule("arrays", ids.jsSkill, ids.jsPathSkill, "arrays", "Arrays and objects", 5, 1);

  await db.pool.query(
    `insert into module_prerequisites (module_id, requires_module_id) values ($1,$2),($3,$4)`,
    [ids.forms, ids.htmlBasics, ids.arrays, ids.jsBasics],
  );

  for (const [i, title] of ["What a page is", "Semantics", "Alt text"].entries()) {
    ids[`lesson${i}`] = await one(
      `insert into lessons (module_version_id, sort_order, title) values ($1,$2,$3) returning id`,
      [ids.htmlBasicsVersion, i, title],
    );
  }
}

async function buildRoadmapRow(userId: string, status = "active"): Promise<string> {
  const roadmap = await db.pool.query<{ id: string }>(
    `insert into roadmaps (user_id, career_path_id, track_id, weekly_hours, status)
     values ($1,$2,$3,6,$4) returning id`,
    [userId, ids.path, ids.track, status],
  );
  const id = roadmap.rows[0].id;
  for (const [i, moduleId] of [ids.htmlBasics, ids.forms, ids.jsBasics, ids.arrays].entries()) {
    await db.pool.query(
      `insert into roadmap_items (roadmap_id, module_id, sort_order, source) values ($1,$2,$3,'generated')`,
      [id, moduleId, i],
    );
  }
  return id;
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

describe("GET /home", () => {
  it("needs a session", async () => {
    expect((await request(app).get("/home")).status).toBe(401);
  });

  it("summarises the learner's active roadmap", async () => {
    await buildRoadmapRow(learnerId);
    const res = await read();

    expect(res.status).toBe(200);
    expect(res.body.home.roadmap).toMatchObject({
      careerPathTitle: "Junior Web Developer",
      trackTitle: "Frontend",
      passedCount: 0,
      totalCount: 4,
    });
  });

  /** §5.6's empty state: "Choose a target job to build your first roadmap." */
  it("returns nothing to continue when there is no roadmap", async () => {
    const res = await read();
    expect(res.body.home).toEqual({ roadmap: null, continue: null, updates: [] });
  });

  it("ignores an archived roadmap", async () => {
    await buildRoadmapRow(learnerId, "archived");
    expect((await read()).body.home.roadmap).toBeNull();
  });

  /**
   * §6.1 step 3. Home takes no id, so the only thing that decides whose data
   * this is, is the session.
   */
  it("never shows another learner's roadmap", async () => {
    const other = await db.pool.query<{ id: string }>(
      `insert into users (email, password_hash, full_name)
       values ('other@example.com','h','Other') returning id`,
    );
    await buildRoadmapRow(other.rows[0].id);

    const res = await read();
    expect(res.body.home.roadmap).toBeNull();
    expect(JSON.stringify(res.body)).not.toMatch(/Junior Web Developer/);
  });

  /**
   * The case that actually bites: the learner **has** a roadmap, and someone
   * else's is newer. Picking the wrong one would make their own roadmap vanish
   * from Home rather than leaking anything — a silent, confusing failure.
   */
  it("picks the caller's roadmap even when another learner's is newer", async () => {
    const mine = await buildRoadmapRow(learnerId);
    const other = await db.pool.query<{ id: string }>(
      `insert into users (email, password_hash, full_name)
       values ('other@example.com','h','Other') returning id`,
    );
    await buildRoadmapRow(other.rows[0].id);

    const res = await read();
    expect(res.body.home.roadmap?.id).toBe(mine);
  });
});

describe("the Continue panel", () => {
  /** §5.6: "Arrays and objects, lesson 2 of 4". */
  it("points at the first unlocked module and its first lesson", async () => {
    await buildRoadmapRow(learnerId);
    const res = await read();

    expect(res.body.home.continue).toMatchObject({
      kind: "module",
      moduleId: ids.htmlBasics,
      moduleTitle: "HTML basics",
      skillTitle: "HTML",
      lessonNumber: 1,
      lessonCount: 3,
      lessonId: ids.lesson0,
      started: false,
    });
  });

  it("resumes at the lesson the learner reached", async () => {
    await buildRoadmapRow(learnerId);
    await db.pool.query(
      `insert into module_enrollments (user_id, module_id, module_version_id, current_lesson_id)
       values ($1,$2,$3,$4)`,
      [learnerId, ids.htmlBasics, ids.htmlBasicsVersion, ids.lesson1],
    );

    expect((await read()).body.home.continue).toMatchObject({
      lessonNumber: 2,
      lessonCount: 3,
      lessonId: ids.lesson1,
      started: true,
    });
  });

  /**
   * Home and the roadmap chart must never disagree about where the learner is,
   * which is why both read the same builder.
   */
  it("moves on with the roadmap when a module is passed", async () => {
    await buildRoadmapRow(learnerId);
    await db.pool.query(
      `insert into module_completions (user_id, module_id, module_version_id, method, score)
       values ($1,$2,$3,'passed',92)`,
      [learnerId, ids.htmlBasics, ids.htmlBasicsVersion],
    );

    const home = (await read()).body.home;
    expect(home.continue.moduleTitle).toBe("Forms and semantics");
    expect(home.roadmap.passedCount).toBe(1);
  });

  it("handles a module with no lessons yet", async () => {
    await buildRoadmapRow(learnerId);
    await db.pool.query(`delete from lessons where module_version_id = $1`, [ids.htmlBasicsVersion]);

    expect((await read()).body.home.continue).toMatchObject({
      lessonNumber: null,
      lessonCount: 0,
      lessonId: null,
    });
  });
});

describe("the Updates panel", () => {
  /** §5.6's own example: a practice module the Roadmap AI added, with its reason. */
  it("reports a reinforcement module and labels it as AI", async () => {
    const roadmapId = await buildRoadmapRow(learnerId);
    const loops = await db.pool.query<{ id: string }>(
      `insert into modules (skill_id, kind, slug, status)
       values ($1,'reinforcement','loops','published') returning id`,
      [ids.jsSkill],
    );
    await db.pool.query(
      `insert into module_versions (module_id, version_no, title, estimated_hours, status)
       values ($1,1,'Practice: loops',2,'published')`,
      [loops.rows[0].id],
    );
    await db.pool.query(
      `insert into roadmap_items (roadmap_id, module_id, sort_order, source, added_reason)
       values ($1,$2,9,'reinforcement','Added after two attempts on the arrays quiz.')`,
      [roadmapId, loops.rows[0].id],
    );

    const updates = (await read()).body.home.updates;
    expect(updates).toHaveLength(1);
    expect(updates[0].kind).toBe("ai_added");
    expect(updates[0].fromAi).toBe(true);
    expect(updates[0].text).toMatch(/Practice: loops was added .* extra practice/);
    expect(updates[0].text).toMatch(/Added after two attempts/);
  });

  /** §5.9 / §6 rule 6: the credit stays; this is a notice, not a repointing. */
  it("reports a module that was updated after the learner passed it", async () => {
    await buildRoadmapRow(learnerId);
    await db.pool.query(
      `insert into module_completions (user_id, module_id, module_version_id, method, score)
       values ($1,$2,$3,'passed',92)`,
      [learnerId, ids.htmlBasics, ids.htmlBasicsVersion],
    );
    await db.pool.query(`update module_versions set status = 'superseded' where id = $1`, [
      ids.htmlBasicsVersion,
    ]);
    await db.pool.query(
      `insert into module_versions (module_id, version_no, title, estimated_hours, status, change_summary)
       values ($1,2,'HTML basics',4,'published','Clearer examples.')`,
      [ids.htmlBasics],
    );

    const updates = (await read()).body.home.updates;
    expect(updates.some((u: { kind: string }) => u.kind === "module_updated")).toBe(true);
    expect(updates.find((u: { kind: string }) => u.kind === "module_updated").text).toMatch(
      /Your credit stays/,
    );
  });

  /**
   * Another learner passing the same module must not produce "you passed it".
   * The module is on both roadmaps, so only the `user_id` on the completion
   * tells them apart.
   */
  it("does not report a version update from another learner's completion", async () => {
    await buildRoadmapRow(learnerId);
    const other = await db.pool.query<{ id: string }>(
      `insert into users (email, password_hash, full_name)
       values ('other@example.com','h','Other') returning id`,
    );
    await db.pool.query(
      `insert into module_completions (user_id, module_id, module_version_id, method, score)
       values ($1,$2,$3,'passed',92)`,
      [other.rows[0].id, ids.htmlBasics, ids.htmlBasicsVersion],
    );
    await db.pool.query(`update module_versions set status = 'superseded' where id = $1`, [
      ids.htmlBasicsVersion,
    ]);
    await db.pool.query(
      `insert into module_versions (module_id, version_no, title, estimated_hours, status)
       values ($1,2,'HTML basics',4,'published')`,
      [ids.htmlBasics],
    );

    expect((await read()).body.home.updates).toEqual([]);
  });

  it("says nothing when there is nothing to say", async () => {
    await buildRoadmapRow(learnerId);
    expect((await read()).body.home.updates).toEqual([]);
  });

  it("does not report another learner's added modules", async () => {
    const other = await db.pool.query<{ id: string }>(
      `insert into users (email, password_hash, full_name)
       values ('other@example.com','h','Other') returning id`,
    );
    const theirs = await buildRoadmapRow(other.rows[0].id);
    // A module of its own: buildRoadmapRow already placed the four core ones.
    const extra = await db.pool.query<{ id: string }>(
      `insert into modules (skill_id, kind, slug, status)
       values ($1,'reinforcement','their-loops','published') returning id`,
      [ids.jsSkill],
    );
    await db.pool.query(
      `insert into module_versions (module_id, version_no, title, estimated_hours, status)
       values ($1,1,'Their practice module',2,'published')`,
      [extra.rows[0].id],
    );
    await db.pool.query(
      `insert into roadmap_items (roadmap_id, module_id, sort_order, source, added_reason)
       values ($1,$2,9,'reinforcement','Their reason.')`,
      [theirs, extra.rows[0].id],
    );

    await buildRoadmapRow(learnerId);
    const res = await read();
    expect(res.body.home.updates).toEqual([]);
    expect(JSON.stringify(res.body)).not.toMatch(/Their reason|Their practice/);
  });
});

/** §6 rule 1: Home reports progress; it never records any. */
describe("Home writes nothing", () => {
  it("leaves progress untouched", async () => {
    await buildRoadmapRow(learnerId);
    await read();

    expect(db.rows("module_completions")).toHaveLength(0);
    expect(db.rows("module_enrollments")).toHaveLength(0);
    expect(db.rows("lesson_progress")).toHaveLength(0);
  });
});
