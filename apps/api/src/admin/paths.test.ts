import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../app.js";
import { createTestDb, type TestDb } from "@first-commit/test-db";
import { post, patch } from "../test/http.js";
import type { Mailer } from "../mail/index.js";
import { findCycle, missingTechnologyModules } from "./paths.js";

const silentMailer: Mailer = { name: "test", async send() {} };

/**
 * The career path editor (design.md §6.2).
 *
 * The two validations §6.2 names are the point. **A circular prerequisite makes
 * a module unreachable** — the schema's only check is `module_id <>
 * requires_module_id`, which catches a one-step loop and nothing longer — and
 * `roadmap/validate.ts` would then reject every roadmap the model produced,
 * with an error about the model rather than about the content.
 *
 * `findCycle` is tested directly as well as through the endpoint, because the
 * interesting cases are the long loops and building a six-module cycle over
 * HTTP is noise around one question.
 */

describe("findCycle", () => {
  const edge = (module: string, requires: string) => ({ module, requires });

  it("finds nothing in an empty graph", () => {
    expect(findCycle([], "a", "b")).toBeNull();
  });

  it("allows a chain", () => {
    // c requires b, b requires a. Adding "d requires c" is fine.
    expect(findCycle([edge("c", "b"), edge("b", "a")], "d", "c")).toBeNull();
  });

  it("catches a module requiring itself", () => {
    expect(findCycle([], "a", "a")).toEqual(["a", "a"]);
  });

  it("catches a two-step loop", () => {
    // b already requires a. Making a require b closes it.
    expect(findCycle([edge("b", "a")], "a", "b")).toEqual(["a", "b", "a"]);
  });

  /** The case the schema's own check cannot see. */
  it("catches a long loop", () => {
    const chain = [edge("e", "d"), edge("d", "c"), edge("c", "b"), edge("b", "a")];

    expect(findCycle(chain, "a", "e")).toEqual(["a", "e", "d", "c", "b", "a"]);
  });

  /** A diamond is not a loop: two paths to the same ancestor are legitimate. */
  it("allows a diamond", () => {
    const diamond = [edge("b", "a"), edge("c", "a")];

    expect(findCycle(diamond, "d", "b")).toBeNull();
    expect(findCycle([...diamond, edge("d", "b")], "d", "c")).toBeNull();
  });
});

describe("missingTechnologyModules", () => {
  const options = [
    { track_id: "t1", technology_id: "react", name: "React" },
    { track_id: "t1", technology_id: "vue", name: "Vue" },
  ];

  /** §6.2 renders this as "Vue has no module for State." */
  it("names a technology with no module for a concept skill", () => {
    const skills = [
      {
        layer: "concept",
        trackId: "t1",
        name: "State",
        modules: [{ kind: "technology", technologyId: "react" }],
      },
    ];

    expect(missingTechnologyModules(skills, options)).toEqual([
      { trackId: "t1", technology: "Vue", skill: "State" },
    ]);
  });

  it("warns about nothing when both are covered", () => {
    const skills = [
      {
        layer: "concept",
        trackId: "t1",
        name: "State",
        modules: [
          { kind: "technology", technologyId: "react" },
          { kind: "technology", technologyId: "vue" },
        ],
      },
    ];

    expect(missingTechnologyModules(skills, options)).toEqual([]);
  });

  /** A core skill has no technology options, so it cannot be missing one. */
  it("ignores core skills", () => {
    const skills = [{ layer: "core", trackId: null, name: "JavaScript", modules: [] }];

    expect(missingTechnologyModules(skills, options)).toEqual([]);
  });

  /** A concept module is not a technology module and does not cover an option. */
  it("does not count a concept module as covering a technology", () => {
    const skills = [
      {
        layer: "concept",
        trackId: "t1",
        name: "State",
        modules: [{ kind: "concept", technologyId: null }],
      },
    ];

    expect(missingTechnologyModules(skills, options)).toHaveLength(2);
  });
});

let db: TestDb;
let app: Express;
let adminCookie: string;
let learnerCookie: string;
let pathId: string;
let pathSkillId: string;
let modA: string;
let modB: string;

const one = async (sql: string, params: unknown[] = []) =>
  (await db.pool.query<{ id: string }>(sql, params)).rows[0].id;

const setRequires = (moduleId: string, requires: string[], cookie = adminCookie) =>
  request(app)
    .put(`/admin/paths/${pathId}/modules/${moduleId}/prerequisites`)
    .set("Cookie", cookie)
    .set("Origin", "http://localhost:5173")
    .send({ requires });

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

  pathId = await one(
    `insert into career_paths (slug, title, status) values ('jwd','Junior Web Developer','published') returning id`,
  );
  const skill = await one(`insert into skills (slug, name) values ('js','JavaScript') returning id`);
  pathSkillId = await one(
    `insert into path_skills (career_path_id, skill_id, layer, sort_order)
     values ($1,$2,'core',0) returning id`,
    [pathId, skill],
  );
  modA = await one(
    `insert into modules (skill_id, kind, slug, status) values ($1,'core','js-basics','published') returning id`,
    [skill],
  );
  modB = await one(
    `insert into modules (skill_id, kind, slug, status) values ($1,'core','js-functions','published') returning id`,
    [skill],
  );
  await db.pool.query(
    `insert into path_skill_modules (path_skill_id, module_id, sort_order) values ($1,$2,0),($1,$3,1)`,
    [pathSkillId, modA, modB],
  );
});

describe("prerequisites over HTTP", () => {
  it("sets them", async () => {
    const res = await setRequires(modB, [modA]);

    expect(res.status).toBe(200);
    expect(db.rows("module_prerequisites")).toHaveLength(1);
  });

  /** §9: say what happened, in the author's own terms. */
  it("refuses a loop and names the path round it", async () => {
    await setRequires(modB, [modA]);

    const res = await setRequires(modA, [modB]);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/creates a loop/i);
    expect(res.body.error).toContain("js-basics");
    expect(res.body.error).toContain("js-functions");
  });

  /** Nothing is half-written: the author did not ask for a partial set. */
  it("writes none of them when one would loop", async () => {
    await setRequires(modB, [modA]);
    const before = db.rows("module_prerequisites").length;

    await setRequires(modA, [modB]);

    expect(db.rows("module_prerequisites")).toHaveLength(before);
  });

  /**
   * The graph is judged without this module's own current edges, so replacing
   * one prerequisite with another is possible. Otherwise an author could never
   * undo a loop they had just been allowed to make.
   */
  it("lets a module's own prerequisites be replaced", async () => {
    await setRequires(modB, [modA]);

    const res = await setRequires(modB, []);

    expect(res.status).toBe(200);
    expect(db.rows("module_prerequisites")).toHaveLength(0);
  });

  it("refuses a module that is not on this path", async () => {
    const other = await one(
      `insert into modules (skill_id, kind, slug, status)
       values ((select id from skills limit 1),'core','elsewhere','published') returning id`,
    );

    expect((await setRequires(other, [modA])).status).toBe(404);
  });

  it("answers 404 to a learner", async () => {
    expect((await setRequires(modB, [modA], learnerCookie)).status).toBe(404);
    expect(db.rows("module_prerequisites")).toHaveLength(0);
  });
});

describe("certificate rules", () => {
  const setRequired = (required: boolean, cookie = adminCookie) =>
    patch(app, `/admin/paths/${pathId}/skills/${pathSkillId}/modules/${modA}`)
      .set("Cookie", cookie)
      .send({ requiredForCertificate: required });

  it("marks a module optional", async () => {
    const res = await setRequired(false);

    expect(res.status).toBe(200);
    const row = db.rows("path_skill_modules").find((r) => r.module_id === modA)!;
    expect(row.required_for_certificate).toBe(false);
  });

  /**
   * §6.1 step 5: this changes what a learner has to finish, including learners
   * already part-way through, so it is never done without a record of who did it.
   */
  it("logs the change", async () => {
    await setRequired(false);

    const log = db.rows("admin_activity_log");
    expect(log).toHaveLength(1);
    expect(log[0].action).toBe("certificate_requirement.removed");
    expect(log[0].target_id).toBe(modA);
  });

  it("logs adding a requirement too", async () => {
    await setRequired(false);
    await setRequired(true);

    expect(db.rows("admin_activity_log").map((l) => l.action)).toEqual([
      "certificate_requirement.removed",
      "certificate_requirement.added",
    ]);
  });

  it("answers 404 to a learner", async () => {
    expect((await setRequired(false, learnerCookie)).status).toBe(404);
    const row = db.rows("path_skill_modules").find((r) => r.module_id === modA)!;
    expect(row.required_for_certificate).toBe(true);
  });
});

describe("reading the path", () => {
  it("returns its skills and the modules under them", async () => {
    const res = await request(app).get(`/admin/paths/${pathId}`).set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    expect(res.body.skills).toHaveLength(1);
    expect(res.body.skills[0].modules.map((m: { slug: string }) => m.slug).sort()).toEqual([
      "js-basics",
      "js-functions",
    ]);
  });

  it("lists the paths", async () => {
    const res = await request(app).get("/admin/paths").set("Cookie", adminCookie);

    expect(res.body.paths[0].title).toBe("Junior Web Developer");
    expect(res.body.paths[0].skills).toBe(1);
  });

  it("answers 404 to a learner", async () => {
    expect(
      (await request(app).get(`/admin/paths/${pathId}`).set("Cookie", learnerCookie)).status,
    ).toBe(404);
  });
});
