import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../app.js";
import { createTestDb, type TestDb } from "../test/db.js";
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

/**
 * A miniature career path: two core skills with two modules each, one Frontend
 * concept skill with one module, and a framework decision.
 *
 * Built through the real tables rather than a fixture object, so the builder is
 * exercised against the schema the seed loader writes to.
 */
async function buildContent(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const one = async (sql: string, values: unknown[] = []) =>
    (await db.pool.query<{ id: string }>(sql, values)).rows[0].id;

  out.path = await one(
    `insert into career_paths (slug, title, status) values ('jwd','Junior Web Developer','published') returning id`,
  );
  out.track = await one(
    `insert into tracks (career_path_id, title, status) values ($1,'Frontend','published') returning id`,
    [out.path],
  );
  out.react = await one(
    `insert into technologies (slug, name) values ('react','React') returning id`,
  );
  out.vue = await one(`insert into technologies (slug, name) values ('vue','Vue') returning id`);

  out.decision = await one(
    `insert into technology_decisions (track_id, title) values ($1,'Choose your framework') returning id`,
    [out.track],
  );
  for (const tech of [out.react, out.vue]) {
    await db.pool.query(
      `insert into decision_options (decision_id, technology_id, status) values ($1,$2,'published')`,
      [out.decision, tech],
    );
  }

  for (const [key, slug, name] of [
    ["htmlSkill", "html", "HTML"],
    ["jsSkill", "javascript", "JavaScript"],
    ["componentsSkill", "components", "Components"],
  ] as const) {
    out[key] = await one(`insert into skills (slug, name) values ($1,$2) returning id`, [slug, name]);
  }

  out.htmlPathSkill = await one(
    `insert into path_skills (career_path_id, track_id, skill_id, layer, sort_order)
     values ($1, null, $2, 'core', 0) returning id`,
    [out.path, out.htmlSkill],
  );
  out.jsPathSkill = await one(
    `insert into path_skills (career_path_id, track_id, skill_id, layer, sort_order)
     values ($1, null, $2, 'core', 1) returning id`,
    [out.path, out.jsSkill],
  );
  out.componentsPathSkill = await one(
    `insert into path_skills (career_path_id, track_id, skill_id, layer, sort_order)
     values ($1, $2, $3, 'concept', 0) returning id`,
    [out.path, out.track, out.componentsSkill],
  );

  const addModule = async (
    key: string,
    skill: string,
    pathSkill: string,
    slug: string,
    title: string,
    hours: number,
    sortOrder: number,
  ) => {
    out[key] = await one(
      `insert into modules (skill_id, kind, slug, status) values ($1,'core',$2,'published') returning id`,
      [skill, slug],
    );
    out[`${key}Version`] = await one(
      `insert into module_versions (module_id, version_no, title, estimated_hours, status)
       values ($1, 1, $2, $3, 'published') returning id`,
      [out[key], title, hours],
    );
    await db.pool.query(
      `insert into path_skill_modules (path_skill_id, module_id, sort_order) values ($1,$2,$3)`,
      [pathSkill, out[key], sortOrder],
    );
  };

  await addModule("htmlBasics", out.htmlSkill, out.htmlPathSkill, "html-basics", "HTML basics", 4, 0);
  await addModule("forms", out.htmlSkill, out.htmlPathSkill, "forms", "Forms and semantics", 5, 1);
  await addModule("jsBasics", out.jsSkill, out.jsPathSkill, "js-basics", "JavaScript basics", 8, 0);
  await addModule("arrays", out.jsSkill, out.jsPathSkill, "arrays", "Arrays and objects", 5, 1);
  await addModule("components", out.componentsSkill, out.componentsPathSkill, "components", "What are components", 3, 0);

  await db.pool.query(
    `insert into module_prerequisites (module_id, requires_module_id) values ($1,$2),($3,$4),($5,$6)`,
    [out.forms, out.htmlBasics, out.arrays, out.jsBasics, out.components, out.arrays],
  );

  return out;
}

async function buildRoadmapRow(userId: string): Promise<string> {
  const roadmap = await db.pool.query<{ id: string }>(
    `insert into roadmaps (user_id, career_path_id, track_id, weekly_hours, status, ai_rationale)
     values ($1,$2,$3,6,'active','Because you want a job at a company.') returning id`,
    [userId, ids.path, ids.track],
  );
  const roadmapId = roadmap.rows[0].id;

  const order = [ids.htmlBasics, ids.forms, ids.jsBasics, ids.arrays, ids.components];
  for (const [i, moduleId] of order.entries()) {
    await db.pool.query(
      `insert into roadmap_items (roadmap_id, module_id, sort_order, source) values ($1,$2,$3,'generated')`,
      [roadmapId, moduleId, i],
    );
  }
  await db.pool.query(
    `insert into roadmap_technology_choices (roadmap_id, decision_id) values ($1,$2)`,
    [roadmapId, ids.decision],
  );
  return roadmapId;
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

  ids = await buildContent();
});

describe("GET /roadmaps/:id — ownership", () => {
  /**
   * The check this whole file exists for. The API fails open (AGENT.md §6), so
   * a roadmap id in a URL is untrusted until it is proven to be the caller's.
   */
  it("does not serve another learner's roadmap", async () => {
    const other = await db.pool.query<{ id: string }>(
      `insert into users (email, password_hash, full_name)
       values ('other@example.com','h','Other') returning id`,
    );
    const theirs = await buildRoadmapRow(other.rows[0].id);

    const res = await read(`/roadmaps/${theirs}`);

    // 404, not 403: a 403 would confirm the roadmap exists.
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toMatch(/Junior Web Developer/);
  });

  it("needs a session", async () => {
    const mine = await buildRoadmapRow(learnerId);
    const res = await request(app).get(`/roadmaps/${mine}`);
    expect(res.status).toBe(401);
  });

  it("404s an id that does not exist", async () => {
    const res = await read("/roadmaps/00000000-0000-0000-0000-000000000000");
    expect(res.status).toBe(404);
  });

  /** A malformed id must not reach a uuid column and surface as a 500. */
  it("404s a malformed id", async () => {
    const res = await read("/roadmaps/not-a-uuid");
    expect(res.status).toBe(404);
  });

  it("lists only the caller's roadmaps", async () => {
    const other = await db.pool.query<{ id: string }>(
      `insert into users (email, password_hash, full_name)
       values ('other@example.com','h','Other') returning id`,
    );
    await buildRoadmapRow(other.rows[0].id);
    const mine = await buildRoadmapRow(learnerId);

    const res = await read("/roadmaps");
    expect(res.status).toBe(200);
    expect(res.body.roadmaps).toHaveLength(1);
    expect(res.body.roadmaps[0].id).toBe(mine);
  });
});

describe("the roadmap it returns", () => {
  let roadmapId: string;
  beforeEach(async () => {
    roadmapId = await buildRoadmapRow(learnerId);
  });

  /** design.md §13.3: one object drives both views, so it has to be complete. */
  it("is the shape the chart reads", async () => {
    const res = await read(`/roadmaps/${roadmapId}`);
    expect(res.status).toBe(200);

    const roadmap = res.body.roadmap;
    expect(roadmap.careerPathTitle).toBe("Junior Web Developer");
    expect(roadmap.trackTitle).toBe("Frontend");
    expect(roadmap.totalCount).toBe(5);
    expect(roadmap.passedCount).toBe(0);
    expect(roadmap.pathColor).toMatch(/^path-[1-4]$/);
  });

  /** §2.1: core skills, then the decision, then the track's concepts, then milestones. */
  it("orders the main path core → decision → concept → milestones", async () => {
    const { steps } = (await read(`/roadmaps/${roadmapId}`)).body.roadmap;
    expect(steps.map((s: { type: string }) => s.type)).toEqual([
      "skill",
      "skill",
      "decision",
      "skill",
      "certificate",
      "capstone",
      "project_certificate",
    ]);
  });

  it("groups modules under their skill", async () => {
    const { steps } = (await read(`/roadmaps/${roadmapId}`)).body.roadmap;
    const html = steps.find((s: { title: string }) => s.title === "HTML");
    expect(html.layer).toBe("core");
    expect(html.modules.map((m: { title: string }) => m.title)).toEqual([
      "HTML basics",
      "Forms and semantics",
    ]);
  });

  it("offers both technologies, with nothing chosen yet", async () => {
    const { steps } = (await read(`/roadmaps/${roadmapId}`)).body.roadmap;
    const decision = steps.find((s: { type: string }) => s.type === "decision");
    expect(decision.title).toBe("Choose your framework");
    expect(decision.options.map((o: { name: string }) => o.name).sort()).toEqual(["React", "Vue"]);
    expect(decision.chosenOptionId).toBeUndefined();
  });
});

describe("statuses", () => {
  let roadmapId: string;
  beforeEach(async () => {
    roadmapId = await buildRoadmapRow(learnerId);
  });

  const statuses = async () => {
    const { steps } = (await read(`/roadmaps/${roadmapId}`)).body.roadmap;
    const modules = steps.flatMap((s: { modules?: { title: string; status: string }[] }) => s.modules ?? []);
    return Object.fromEntries(modules.map((m: { title: string; status: string }) => [m.title, m.status]));
  };

  /** §8: the first thing a learner can start is "You are here". */
  it("starts the learner at the first unlocked module", async () => {
    expect(await statuses()).toEqual({
      "HTML basics": "current",
      "Forms and semantics": "locked",
      "JavaScript basics": "available",
      "Arrays and objects": "locked",
      "What are components": "locked",
    });
  });

  it("unlocks what a completion unlocks, and moves You are here", async () => {
    await db.pool.query(
      `insert into module_completions (user_id, module_id, module_version_id, method, score)
       values ($1,$2,$3,'passed',92)`,
      [learnerId, ids.htmlBasics, ids.htmlBasicsVersion],
    );

    expect(await statuses()).toEqual({
      "HTML basics": "passed",
      "Forms and semantics": "current",
      "JavaScript basics": "available",
      "Arrays and objects": "locked",
      "What are components": "locked",
    });
  });

  /** §8's own example: "Passed, 88%" — the score is part of the status. */
  it("carries the score from the completion, not from the browser", async () => {
    await db.pool.query(
      `insert into module_completions (user_id, module_id, module_version_id, method, score)
       values ($1,$2,$3,'passed',92)`,
      [learnerId, ids.htmlBasics, ids.htmlBasicsVersion],
    );
    const { steps } = (await read(`/roadmaps/${roadmapId}`)).body.roadmap;
    const html = steps.find((s: { title: string }) => s.title === "HTML");
    expect(html.modules[0].score).toBe(92);
    expect((await read(`/roadmaps/${roadmapId}`)).body.roadmap.passedCount).toBe(1);
  });

  it("tells tested out apart from passed", async () => {
    await db.pool.query(
      `insert into module_completions (user_id, module_id, module_version_id, method)
       values ($1,$2,$3,'tested_out')`,
      [learnerId, ids.htmlBasics, ids.htmlBasicsVersion],
    );
    expect((await statuses())["HTML basics"]).toBe("tested_out");
    // §8: both count as done.
    expect((await read(`/roadmaps/${roadmapId}`)).body.roadmap.passedCount).toBe(1);
  });

  it("makes an enrolled module the current one, wherever it sits", async () => {
    await db.pool.query(
      `insert into module_enrollments (user_id, module_id, module_version_id) values ($1,$2,$3)`,
      [learnerId, ids.jsBasics, ids.jsBasicsVersion],
    );
    const s = await statuses();
    expect(s["JavaScript basics"]).toBe("current");
    expect(s["HTML basics"]).toBe("available");
  });

  /** §6 rule 6: the learner keeps the version they took; a newer one is a notice. */
  it("flags a module whose published version moved on", async () => {
    await db.pool.query(
      `update module_versions set status = 'superseded' where id = $1`,
      [ids.htmlBasicsVersion],
    );
    const newVersion = await db.pool.query<{ id: string }>(
      `insert into module_versions (module_id, version_no, title, estimated_hours, status)
       values ($1, 2, 'HTML basics', 4, 'published') returning id`,
      [ids.htmlBasics],
    );
    await db.pool.query(
      `insert into module_enrollments (user_id, module_id, module_version_id) values ($1,$2,$3)`,
      [learnerId, ids.htmlBasics, ids.htmlBasicsVersion],
    );

    const { steps } = (await read(`/roadmaps/${roadmapId}`)).body.roadmap;
    const html = steps.find((s: { title: string }) => s.title === "HTML");
    expect(html.modules[0].hasUpdate).toBe(true);
    // The learner's own version number, not the newly published one.
    expect(html.modules[0].versionNo).toBe(1);
    expect(newVersion.rows[0].id).not.toBe(ids.htmlBasicsVersion);
  });

  /** §6 rule 7: a module shared with another path is tagged, and counts on both. */
  it("reports the other career paths a module also belongs to", async () => {
    const otherPath = await db.pool.query<{ id: string }>(
      `insert into career_paths (slug, title, status) values ('data','Data Analyst','published') returning id`,
    );
    const otherSkill = await db.pool.query<{ id: string }>(
      `insert into path_skills (career_path_id, track_id, skill_id, layer, sort_order)
       values ($1, null, $2, 'core', 0) returning id`,
      [otherPath.rows[0].id, ids.htmlSkill],
    );
    await db.pool.query(
      `insert into path_skill_modules (path_skill_id, module_id, sort_order) values ($1,$2,0)`,
      [otherSkill.rows[0].id, ids.htmlBasics],
    );

    const { steps } = (await read(`/roadmaps/${roadmapId}`)).body.roadmap;
    const html = steps.find((s: { title: string }) => s.title === "HTML");
    expect(html.modules[0].sharedWithPaths).toEqual([otherPath.rows[0].id]);
  });
});

describe("milestones", () => {
  it("locks the certificate until everything is passed", async () => {
    const roadmapId = await buildRoadmapRow(learnerId);
    const { steps } = (await read(`/roadmaps/${roadmapId}`)).body.roadmap;
    const certificate = steps.find((s: { type: string }) => s.type === "certificate");
    expect(certificate.status).toBe("locked");
    expect(certificate.certificateId).toBeUndefined();
  });

  it("reports an issued certificate as earned", async () => {
    const roadmapId = await buildRoadmapRow(learnerId);
    const certificate = await db.pool.query<{ id: string }>(
      `insert into certificates (public_code, user_id, type, roadmap_id, recipient_name, title)
       values ('FC-7K2M-94QX', $1, 'completion', $2, 'Jan Kevin Gerona', 'Junior Web Developer')
       returning id`,
      [learnerId, roadmapId],
    );

    const { steps } = (await read(`/roadmaps/${roadmapId}`)).body.roadmap;
    const step = steps.find((s: { type: string }) => s.type === "certificate");
    expect(step.status).toBe("earned");
    expect(step.certificateId).toBe(certificate.rows[0].id);
  });
});

describe("§6 rule 1 — the roadmap is read-only here", () => {
  /**
   * No endpoint accepts a completion, a score or a passed flag. This asserts
   * the absence: a browser cannot reach progress through the roadmap routes.
   */
  it.each([
    ["post", "/roadmaps"],
    ["put", "/roadmaps"],
    ["post", "/roadmaps/00000000-0000-0000-0000-000000000000"],
    ["put", "/roadmaps/00000000-0000-0000-0000-000000000000"],
    ["delete", "/roadmaps/00000000-0000-0000-0000-000000000000"],
  ] as const)("has no %s %s", async (method, path) => {
    // With the Origin a browser would send, so the CSRF guard passes and the
    // 404 proves there is no route — not merely that CSRF stopped it.
    const res = await request(app)
      [method](path)
      .set("Cookie", cookie)
      .set("Origin", config.appOrigin)
      .send({ passed: true, score: 100 });

    expect(res.status).toBe(404);
    expect(db.rows("module_completions")).toHaveLength(0);
  });

  /**
   * `PATCH` exists now, for §5.5's "Adjust weekly hours" — so the guarantee
   * moves from "there is no route" to "the route cannot carry progress".
   * `.strict()` makes that a rejection rather than a silent ignore.
   */
  it.each([{ passed: true }, { score: 100 }, { passedCount: 9 }, { trackId: "x" }])(
    "patch refuses a body carrying %o",
    async (body) => {
      const mine = await buildRoadmapRow(learnerId);
      const res = await request(app)
        .patch(`/roadmaps/${mine}`)
        .set("Cookie", cookie)
        .set("Origin", config.appOrigin)
        .send({ weeklyHours: 6, ...body });

      expect(res.status).toBe(400);
      expect(db.rows("module_completions")).toHaveLength(0);
    },
  );
});

describe("PATCH /roadmaps/:id — §5.5 adjust weekly hours", () => {
  let roadmapId: string;
  beforeEach(async () => {
    roadmapId = await buildRoadmapRow(learnerId);
  });

  const patch = (id: string, body: unknown) =>
    request(app).patch(`/roadmaps/${id}`).set("Cookie", cookie).set("Origin", config.appOrigin).send(body);

  it("updates the roadmap and the profile together", async () => {
    const res = await patch(roadmapId, { weeklyHours: 12 });

    expect(res.status).toBe(200);
    expect(res.body.roadmap.weeklyHours).toBe(12);
    // The AI reads the profile when planning the next roadmap, so the two
    // must not drift.
    const profile = db.rows("learner_profiles").find((r) => r.user_id === learnerId)!;
    expect(profile.weekly_hours).toBe(12);
  });

  /** §5.5: "16 modules, about 14 weeks at 6 hours a week". */
  it("recomputes the estimate from the hours", async () => {
    const slow = await patch(roadmapId, { weeklyHours: 2 });
    const fast = await patch(roadmapId, { weeklyHours: 20 });

    expect(slow.body.roadmap.estimatedWeeks).toBeGreaterThan(
      fast.body.roadmap.estimatedWeeks,
    );
  });

  it.each([0, 41, -1])("refuses %i hours with the sentence §9 gives", async (hours) => {
    const res = await patch(roadmapId, { weeklyHours: hours });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/between 1 and 40/);
  });

  /** §6.1 step 4: a roadmap id from the browser is confirmed to be theirs. */
  it("answers 404 for another learner's roadmap, and changes nothing", async () => {
    const other = await db.pool.query<{ id: string }>(
      `insert into users (email, password_hash, full_name) values ('other@example.com','h','Other') returning id`,
    );
    const theirs = await db.pool.query<{ id: string }>(
      `insert into roadmaps (user_id, career_path_id, weekly_hours, status)
       values ($1, $2, 5, 'active') returning id`,
      [other.rows[0].id, ids.path],
    );

    const res = await patch(theirs.rows[0].id, { weeklyHours: 30 });

    expect(res.status).toBe(404);
    const untouched = db.rows("roadmaps").find((r) => r.id === theirs.rows[0].id)!;
    expect(untouched.weekly_hours).toBe(5);
  });
});

/**
 * §5.4's flow ends at the review, not at Home — and the server says so, rather
 * than each guard working it out. An earlier version had a screen navigating
 * while a guard redirected elsewhere, and the two fought until the browser
 * throttled navigation.
 */
describe("GET /auth/me — where a learner belongs", () => {
  /** Onboarding takes precedence, so these cases start from a finished learner. */
  const finished = () =>
    db.pool.query(`update learner_profiles set onboarding_step = 'done' where user_id = $1`, [
      learnerId,
    ]);

  it("sends a learner with a fresh roadmap to its review", async () => {
    await finished();
    const roadmapId = await buildRoadmapRow(learnerId);
    const res = await read("/auth/me");

    expect(res.body.next).toBe(`/app/roadmap/${roadmapId}/review`);
  });

  /** Once a module has been opened, the review has been had. */
  it("sends them to the app once they have started a module", async () => {
    await finished();
    await buildRoadmapRow(learnerId);
    await db.pool.query(
      `insert into module_enrollments (user_id, module_id, module_version_id)
       values ($1, $2, (select id from module_versions where module_id = $2))`,
      [learnerId, ids.htmlBasics],
    );

    expect((await read("/auth/me")).body.next).toBe("/app");
  });

  it("sends a learner with no roadmap to the app", async () => {
    await finished();
    expect((await read("/auth/me")).body.next).toBe("/app");
  });

  it("keeps an unfinished learner in onboarding", async () => {
    await db.pool.query(
      `update learner_profiles set onboarding_step = 'target' where user_id = $1`,
      [learnerId],
    );
    expect((await read("/auth/me")).body.next).toBe("/onboarding/target");
  });
});
