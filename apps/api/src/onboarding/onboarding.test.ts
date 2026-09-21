import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../app.js";
import { createTestDb, type TestDb } from "../test/db.js";
import { post } from "../test/http.js";
import type { Mailer } from "../mail/index.js";
import { config } from "../config.js";

const silentMailer: Mailer = { name: "test", async send() {} };

const ACCOUNT = {
  fullName: "Jan Kevin Gerona",
  email: "learner@example.com",
  password: "a-good-password",
};

let db: TestDb;
let app: Express;
let cookie: string;
let pathId: string;

/** Supertest's `put` needs the same Origin a browser sends (the CSRF guard). */
const put = (path: string) =>
  request(app).put(path).set("Origin", config.appOrigin).set("Cookie", cookie);
const send = (path: string) =>
  request(app).post(path).set("Origin", config.appOrigin).set("Cookie", cookie);
const read = (path: string) => request(app).get(path).set("Cookie", cookie);

beforeEach(async () => {
  db = createTestDb();
  app = createApp({ pool: db.pool, mailer: silentMailer });

  const signUp = await post(app, "/auth/signup").send(ACCOUNT);
  cookie = (signUp.headers["set-cookie"] as unknown as string[])[0].split(";")[0];

  const path = await db.pool.query<{ id: string }>(
    `insert into career_paths (slug, title, description, status)
     values ('junior-web-developer','Junior Web Developer','Build websites and web apps','published')
     returning id`,
  );
  pathId = path.rows[0].id;
});

describe("GET /career-paths", () => {
  it("lists published paths", async () => {
    const res = await read("/career-paths");
    expect(res.status).toBe(200);
    expect(res.body.careerPaths).toHaveLength(1);
    expect(res.body.careerPaths[0].title).toBe("Junior Web Developer");
  });

  /** §6.2: draft content is admin-only. A learner must not see it. */
  it("hides drafts and archived paths", async () => {
    await db.pool.query(
      `insert into career_paths (slug, title, status) values
        ('draft-path','Draft','draft'), ('old-path','Archived','archived')`,
    );
    const res = await read("/career-paths");
    expect(res.body.careerPaths).toHaveLength(1);
  });

  it("needs a session", async () => {
    const res = await request(app).get("/career-paths");
    expect(res.status).toBe(401);
  });
});

describe("GET /onboarding", () => {
  it("starts a fresh learner at the first step with nothing answered", async () => {
    const res = await read("/onboarding");
    expect(res.status).toBe(200);
    expect(res.body.step).toBe("about");
    expect(res.body.about).toBeNull();
    expect(res.body.careerPathId).toBeNull();
  });

  /** §5.4: "Back returns to the previous step with the earlier answers still filled in." */
  it("returns saved answers so Back can refill them", async () => {
    await put("/onboarding/about").send({
      experienceLevel: "some",
      goal: "company_job",
      weeklyHours: 10,
    });

    const res = await read("/onboarding");
    expect(res.body.step).toBe("target");
    expect(res.body.about).toEqual({
      experienceLevel: "some",
      goal: "company_job",
      weeklyHours: 10,
    });
  });
});

describe("PUT /onboarding/about", () => {
  it("saves the answers and advances", async () => {
    const res = await put("/onboarding/about").send({
      experienceLevel: "none",
      goal: "freelance",
      weeklyHours: 5,
    });

    expect(res.status).toBe(200);
    expect(res.body.next).toBe("/onboarding/target");

    const profile = db.rows("learner_profiles")[0];
    expect(profile.experience_level).toBe("none");
    expect(profile.goal).toBe("freelance");
    expect(profile.weekly_hours).toBe(5);
    expect(profile.onboarding_step).toBe("target");
  });

  /** design.md §9: "Enter weekly hours as a number between 1 and 40." */
  it.each([0, 41, -3])("rejects %s weekly hours with a message that explains", async (hours) => {
    const res = await put("/onboarding/about").send({
      experienceLevel: "none",
      goal: "freelance",
      weeklyHours: hours,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/between 1 and 40/i);
  });

  it("rejects an experience level it does not know", async () => {
    const res = await put("/onboarding/about").send({
      experienceLevel: "expert",
      goal: "freelance",
      weeklyHours: 5,
    });
    expect(res.status).toBe(400);
  });

  /** Redoing an earlier step must not drag a further-along learner backwards. */
  it("does not move a later learner back to target", async () => {
    await put("/onboarding/about").send({
      experienceLevel: "none", goal: "freelance", weeklyHours: 5,
    });
    await put("/onboarding/target").send({ careerPathId: pathId });

    const res = await put("/onboarding/about").send({
      experienceLevel: "some", goal: "company_job", weeklyHours: 12,
    });

    expect(res.body.step).toBe("placement");
    expect(db.rows("learner_profiles")[0].experience_level).toBe("some");
  });
});

describe("PUT /onboarding/target", () => {
  beforeEach(async () => {
    await put("/onboarding/about").send({
      experienceLevel: "none", goal: "freelance", weeklyHours: 5,
    });
  });

  it("records the choice and advances", async () => {
    const res = await put("/onboarding/target").send({ careerPathId: pathId });

    expect(res.status).toBe(200);
    expect(res.body.next).toBe("/onboarding/placement");
    expect(db.rows("learner_profiles")[0].onboarding_step).toBe("placement");
  });

  it("refuses a path that is not published", async () => {
    const draft = await db.pool.query<{ id: string }>(
      `insert into career_paths (slug, title, status) values ('d','Draft','draft') returning id`,
    );
    const res = await put("/onboarding/target").send({ careerPathId: draft.rows[0].id });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/isn't available/i);
  });

  it("refuses a path that does not exist", async () => {
    const res = await put("/onboarding/target").send({
      careerPathId: "00000000-0000-0000-0000-000000000000",
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /onboarding/placement", () => {
  beforeEach(async () => {
    await put("/onboarding/about").send({
      experienceLevel: "none", goal: "freelance", weeklyHours: 5,
    });
    await put("/onboarding/target").send({ careerPathId: pathId });
  });

  it("records the result and queues the roadmap job", async () => {
    const res = await send("/onboarding/placement").send({
      careerPathId: pathId,
      results: { html: "confident", css: "unsure" },
    });

    expect(res.status).toBe(200);
    expect(res.body.next).toBe("/onboarding/generating");
    expect(db.rows("placement_results")).toHaveLength(1);

    const job = db.rows("ai_jobs")[0];
    expect(job.type).toBe("roadmap_generation");
    expect(job.status).toBe("queued");
  });

  /**
   * The worker fills in a roadmap; it does not decide whose it is. The API
   * creates the row from the session and hands the worker its id, so a job can
   * never be pointed at another learner's roadmap by anything the browser sent.
   */
  it("creates the roadmap and points the job at it", async () => {
    const res = await send("/onboarding/placement").send({ careerPathId: pathId, results: {} });

    const roadmap = db.rows("roadmaps")[0];
    const learner = db.rows("users").find((u) => u.email === ACCOUNT.email)!;
    expect(roadmap.user_id).toBe(learner.id);
    expect(roadmap.career_path_id).toBe(pathId);
    expect(res.body.roadmapId).toBe(roadmap.id);

    // source_id is documented as the roadmap id, and the worker refuses a job
    // without one it can verify.
    expect(db.rows("ai_jobs")[0].source_id).toBe(roadmap.id);
  });

  /** §5.5 shows "about 14 weeks at 6 hours a week", which needs the hours stored. */
  it("carries the learner's weekly hours onto the roadmap", async () => {
    await send("/onboarding/placement").send({ careerPathId: pathId, results: {} });
    expect(db.rows("roadmaps")[0].weekly_hours).toBe(5);
  });

  /** §5.4: "I don't know yet" is always available, so an empty result is valid. */
  it("accepts an empty result", async () => {
    const res = await send("/onboarding/placement").send({ careerPathId: pathId, results: {} });
    expect(res.status).toBe(200);
    expect(db.rows("ai_jobs")).toHaveLength(1);
  });
});

/**
 * §5.4: "a learner cannot open /onboarding/placement before finishing the
 * earlier steps". The browser guard is for the experience; this is the check
 * that counts.
 */
describe("step order is enforced by the API", () => {
  it("refuses target before about", async () => {
    const res = await put("/onboarding/target").send({ careerPathId: pathId });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/earlier steps/i);
  });

  it("refuses placement before target", async () => {
    await put("/onboarding/about").send({
      experienceLevel: "none", goal: "freelance", weeklyHours: 5,
    });
    const res = await send("/onboarding/placement").send({ careerPathId: pathId, results: {} });
    expect(res.status).toBe(409);
    expect(db.rows("ai_jobs")).toHaveLength(0);
  });
});

describe("§6.1 — writes are scoped to the session", () => {
  it("updates only the caller's profile, whatever the body says", async () => {
    const other = await db.pool.query<{ id: string }>(
      `insert into users (email, password_hash, full_name)
       values ('other@example.com','h','Other') returning id`,
    );
    const otherId = other.rows[0].id;
    await db.pool.query(`insert into learner_profiles (user_id) values ($1)`, [otherId]);

    await put("/onboarding/about").send({
      experienceLevel: "comfortable",
      goal: "company_job",
      weeklyHours: 20,
      // Ignored: the user id comes from the session, never the body.
      userId: otherId,
      user_id: otherId,
    });

    const theirs = db.rows("learner_profiles").find((r) => r.user_id === otherId)!;
    expect(theirs.experience_level).toBeNull();
    expect(theirs.onboarding_step).toBe("about");
  });

  it("needs a session on every onboarding route", async () => {
    for (const [method, path] of [
      ["get", "/onboarding"],
      ["put", "/onboarding/about"],
      ["put", "/onboarding/target"],
      ["post", "/onboarding/placement"],
    ] as const) {
      const res = await request(app)[method](path).set("Origin", config.appOrigin).send({});
      expect(res.status, `${method} ${path}`).toBe(401);
    }
  });
});
