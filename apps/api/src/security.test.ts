import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "./app.js";
import { createTestDb, type TestDb } from "@first-commit/test-db";
import { post } from "./test/http.js";
import type { Mailer } from "./mail/index.js";
import { config } from "./config.js";

/**
 * The security tests `project-proposal.md` §9.2 commits to.
 *
 * **These are deliberately enumerable rather than per-endpoint.** Every other
 * test file covers the endpoint it is about, and those checks are good — but
 * they only exist for endpoints somebody remembered to write them for. The
 * database no longer knows who is asking (`database-schema.md` §6): the API is
 * the only thing between an account and other people's data, and **it fails
 * open**, so a forgotten ownership check silently serves the wrong learner's
 * records.
 *
 * So the lists below are the point. Adding a learner endpoint without a
 * session check, or a learner-owned id without an ownership check, fails here —
 * which is a different guarantee from "the endpoints we tested are fine".
 *
 * §9.2 asks for five things. Four are enumerated here. The fifth — login and
 * reset rate limiting, and reset links expiring and working once — is covered
 * in `auth/rate-limit.test.ts` and `auth/tokens-flow.test.ts`, both
 * mutation-tested, and is not duplicated.
 */

const silentMailer: Mailer = { name: "test", async send() {} };

let db: TestDb;
let app: Express;

/** The learner under test, and somebody else whose data they must not reach. */
let mine: Learner;
let theirs: Learner;
let ids: Record<string, string>;

interface Learner {
  id: string;
  cookie: string;
  roadmapId: string;
  /** Their own submission, so the owned-id list can point at somebody else's. */
  submissionId: string;
  /** Their own AI output, for the same reason. */
  aiOutputId: string;
}

/**
 * Values planted in secret columns. If one reaches a response, that leaked.
 *
 * Note what is *not* planted: an option's text, and an option's id. Both have
 * to reach the browser — a learner cannot choose an answer they cannot see.
 * The secret is **which** option is the right one, so that is what the
 * assertions below look for.
 */
const PLANTED = {
  explanation: "PLANTED-EXPLANATION",
  /** §6 rule 2 names all three: hidden test cases, reference solutions, rubrics. */
  hiddenCase: "PLANTED-HIDDEN-CASE",
  hiddenCode: "PLANTED-HIDDEN-CODE",
  solution: "PLANTED-REFERENCE-SOLUTION",
};

const as = (learner: Learner) => ({
  get: (path: string) => request(app).get(path).set("Cookie", learner.cookie),
  post: (path: string) =>
    request(app).post(path).set("Cookie", learner.cookie).set("Origin", config.appOrigin),
  patch: (path: string) =>
    request(app).patch(path).set("Cookie", learner.cookie).set("Origin", config.appOrigin),
  put: (path: string) =>
    request(app).put(path).set("Cookie", learner.cookie).set("Origin", config.appOrigin),
});

async function signUp(email: string): Promise<{ id: string; cookie: string }> {
  const res = await post(app, "/auth/signup").send({
    fullName: "Test Learner",
    email,
    password: "a-good-password",
  });
  const cookie = (res.headers["set-cookie"] as unknown as string[])[0].split(";")[0];
  const row = await db.pool.query<{ id: string }>(
    `select id from users where lower(email) = lower($1)`,
    [email],
  );
  return { id: row.rows[0].id, cookie };
}

/** Published content, with a real answer key and explanation to plant in. */
async function seedContent(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const one = async (sql: string, values: unknown[] = []) => {
    const r = await db.pool.query<{ id: string }>(sql, values);
    return r.rows[0].id;
  };

  out.path = await one(
    `insert into career_paths (slug, title, description, status)
     values ('jwd','Junior Web Developer','','published') returning id`,
  );
  out.track = await one(
    `insert into tracks (career_path_id, title, status)
     values ($1,'Frontend','published') returning id`,
    [out.path],
  );
  out.skill = await one(`insert into skills (slug, name) values ('html','HTML') returning id`);
  out.pathSkill = await one(
    `insert into path_skills (career_path_id, skill_id, layer) values ($1,$2,'core') returning id`,
    [out.path, out.skill],
  );
  out.module = await one(
    `insert into modules (skill_id, kind, slug, status) values ($1,'core','html-basics','published') returning id`,
    [out.skill],
  );
  out.version = await one(
    `insert into module_versions (module_id, version_no, title, estimated_hours, status)
     values ($1,1,'HTML basics',4,'published') returning id`,
    [out.module],
  );
  await db.pool.query(
    `insert into path_skill_modules (path_skill_id, module_id, sort_order) values ($1,$2,0)`,
    [out.pathSkill, out.module],
  );
  out.lesson = await one(
    `insert into lessons (module_version_id, sort_order, title, content)
     values ($1,0,'What a page is made of','{"blocks":[]}') returning id`,
    [out.version],
  );

  out.assessment = await one(
    `insert into assessments (module_version_id, type, title, passing_score)
     values ($1,'quiz','HTML basics quiz',70) returning id`,
    [out.version],
  );
  out.question = await one(
    `insert into quiz_questions (assessment_id, sort_order, prompt, explanation, linked_lesson_id)
     values ($1,0,'Which element is a heading?',$2,$3) returning id`,
    [out.assessment, PLANTED.explanation, out.lesson],
  );
  // Two options; the key names one of them, and the key is the planted value.
  out.right = await one(
    `insert into quiz_options (question_id, sort_order, text) values ($1,0,'A heading') returning id`,
    [out.question],
  );
  out.wrong = await one(
    `insert into quiz_options (question_id, sort_order, text) values ($1,1,'A paragraph') returning id`,
    [out.question],
  );
  await db.pool.query(
    `insert into quiz_answer_keys (question_id, correct_option_id) values ($1,$2)`,
    [out.question, out.right],
  );

  out.decision = await one(
    `insert into technology_decisions (track_id, title) values ($1,'Choose your framework') returning id`,
    [out.track],
  );
  out.exercise = await one(
    `insert into assessments (module_version_id, type, title, runtime, starter_files, passing_score)
     values ($1,'code','Sum of even numbers','javascript','[{"path":"script.js","content":"x"}]',100) returning id`,
    [out.version],
  );
  await db.pool.query(
    `insert into test_cases (assessment_id, sort_order, name, test_code, is_visible) values
       ($1,0,'Sums the evens','visible-code',true),
       ($1,1,$2,$3,false)`,
    [out.exercise, PLANTED.hiddenCase, PLANTED.hiddenCode],
  );
  await db.pool.query(
    `insert into reference_solutions (assessment_id, files) values ($1, $2)`,
    [out.exercise, JSON.stringify([{ path: "script.js", content: PLANTED.solution }])],
  );

  out.technology = await one(
    `insert into technologies (slug, name, description) values ('react','React','') returning id`,
  );
  await db.pool.query(
    `insert into decision_options (decision_id, technology_id, status) values ($1,$2,'published')`,
    [out.decision, out.technology],
  );
  return out;
}

async function giveRoadmap(userId: string): Promise<string> {
  const r = await db.pool.query<{ id: string }>(
    `insert into roadmaps (user_id, career_path_id, track_id, weekly_hours, status, ai_rationale)
     values ($1,$2,$3,6,'active','Because you want a job.') returning id`,
    [userId, ids.path, ids.track],
  );
  await db.pool.query(
    `insert into roadmap_items (roadmap_id, module_id, sort_order, source) values ($1,$2,0,'generated')`,
    [r.rows[0].id, ids.module],
  );
  await db.pool.query(
    `insert into roadmap_technology_choices (roadmap_id, decision_id) values ($1,$2)`,
    [r.rows[0].id, ids.decision],
  );
  await db.pool.query(
    `update learner_profiles set onboarding_step = 'done' where user_id = $1`,
    [userId],
  );
  return r.rows[0].id;
}

async function giveSubmission(userId: string): Promise<string> {
  const r = await db.pool.query<{ id: string }>(
    `insert into code_submissions (user_id, assessment_id, files)
     values ($1, $2, '[{"path":"script.js","content":"mine"}]') returning id`,
    [userId, ids.exercise],
  );
  return r.rows[0].id;
}

async function giveAiOutput(userId: string, roadmapId: string): Promise<string> {
  const r = await db.pool.query<{ id: string }>(
    `insert into ai_outputs (user_id, source_type, source_id, content)
     values ($1, 'roadmap_generation', $2, $3) returning id`,
    [userId, roadmapId, JSON.stringify({ explanation: PLANTED.explanation })],
  );
  return r.rows[0].id;
}

beforeEach(async () => {
  db = createTestDb();
  app = createApp({ pool: db.pool, mailer: silentMailer });
  ids = await seedContent();

  const a = await signUp("mine@example.com");
  const b = await signUp("theirs@example.com");
  const mineRoadmap = await giveRoadmap(a.id);
  const theirsRoadmap = await giveRoadmap(b.id);
  mine = {
    ...a,
    roadmapId: mineRoadmap,
    submissionId: await giveSubmission(a.id),
    aiOutputId: await giveAiOutput(a.id, mineRoadmap),
  };
  theirs = {
    ...b,
    roadmapId: theirsRoadmap,
    submissionId: await giveSubmission(b.id),
    aiOutputId: await giveAiOutput(b.id, theirsRoadmap),
  };
});

/**
 * §6.1 step 1: every request resolves the session first. An endpoint that
 * forgets `requireAuth` serves a stranger.
 *
 * **This list is the test.** A learner endpoint added without one is a line
 * missing from here, and adding the line is what surfaces it.
 */
const LEARNER_ROUTES: [method: "get" | "post" | "put" | "patch", path: string][] = [
  ["get", "/auth/me"],
  ["get", "/career-paths"],
  ["get", "/onboarding"],
  ["put", "/onboarding/about"],
  ["put", "/onboarding/target"],
  ["post", "/onboarding/placement"],
  ["post", "/onboarding/generating/retry"],
  ["get", "/home"],
  ["get", "/roadmaps"],
  ["get", "/roadmaps/ROADMAP"],
  ["patch", "/roadmaps/ROADMAP"],
  ["get", "/roadmaps/ROADMAP/decisions/DECISION"],
  ["post", "/roadmaps/ROADMAP/decisions/DECISION"],
  ["get", "/modules/MODULE"],
  ["post", "/modules/MODULE/start"],
  ["post", "/lessons/LESSON/complete"],
  ["get", "/assessments/ASSESSMENT"],
  ["post", "/assessments/ASSESSMENT/attempts"],
  ["get", "/exercises/EXERCISE"],
  ["post", "/exercises/EXERCISE/submissions"],
  ["get", "/submissions/SUBMISSION"],
  ["post", "/ai-outputs/AI_OUTPUT/flags"],
];

/**
 * Every route the app has actually registered.
 *
 * **Express 5 moved this.** `app._router` was Express 4; in 5 it is
 * `app.router`, and reading the old one gives an empty list — which made the
 * guard below pass while guarding nothing. Mutation-testing found that:
 * adding an unlisted route did not fail until this was fixed. Both names are
 * read so a major-version bump surfaces as a failure rather than as silence,
 * and an empty table is treated as a bug.
 */
function routeTable(): { method: string; path: string }[] {
  const router = (app as unknown as {
    router?: { stack: unknown[] };
    _router?: { stack: unknown[] };
  });
  const stack = router.router?.stack ?? router._router?.stack ?? [];

  const out: { method: string; path: string }[] = [];
  const walk = (layers: unknown[]) => {
    for (const layer of layers as {
      route?: { path: string; methods?: Record<string, boolean> };
      handle?: { stack?: unknown[] };
    }[]) {
      if (layer.route) {
        for (const method of Object.keys(layer.route.methods ?? {})) {
          out.push({ method, path: layer.route.path });
        }
      } else if (layer.handle?.stack) walk(layer.handle.stack);
    }
  };
  walk(stack);

  if (out.length === 0) {
    throw new Error(
      "No routes found on the Express app. The router moved again — this guard is not guarding anything.",
    );
  }
  return out;
}

/** Substitutes real ids into a route template. */
const fill = (path: string, learner: Learner) =>
  path
    .replace("ROADMAP", learner.roadmapId)
    .replace("DECISION", ids.decision)
    .replace("MODULE", ids.module)
    .replace("LESSON", ids.lesson)
    .replace("ASSESSMENT", ids.assessment)
    .replace("EXERCISE", ids.exercise)
    .replace("SUBMISSION", learner.submissionId)
    .replace("AI_OUTPUT", learner.aiOutputId);

/** A body the owner's request would be allowed to send. */
const choice = () => ({ technologyId: ids.technology });

describe("§9.2 — every learner endpoint resolves a session", () => {
  it.each(LEARNER_ROUTES)("%s %s refuses a caller with no session", async (method, path) => {
    const res = await request(app)
      [method](fill(path, mine))
      .set("Origin", config.appOrigin)
      .send({});

    expect(res.status, `${method} ${path} answered ${res.status}`).toBe(401);
  });

  it("covers every route the app actually registers", () => {
    /**
     * Guards the list above against going stale. `_router.stack` is Express's
     * own registry, so a route added to the app and not to `LEARNER_ROUTES`
     * shows up here rather than being quietly untested.
     */
    const registered = new Set(
      routeTable().map(({ method, path }) => `${method} ${path}`),
    );

    // Public and internal routes are out of scope: they are meant to be
    // reachable without a learner session, and each has its own tests.
    const exempt = [
      "/auth/signup",
      "/auth/login",
      "/auth/logout",
      "/auth/verify-email",
      "/auth/verification/resend",
      "/auth/password/forgot",
      "/auth/password/reset",
      "/internal/events",
      "/events",
      "/health",
      "/health/db",
      /**
       * Admin routes are out of scope for `LEARNER_ROUTES` — they are not
       * learner endpoints, and they are covered by `src/admin/flags.test.ts`,
       * which asserts the §6.1 step 5 role check on each one and that a
       * learner gets a 404. Listing them here would assert the wrong thing.
       */
      "/admin/flags",
      "/admin/flags/:id",
    ];

    const listed = new Set(
      LEARNER_ROUTES.map(([m, p]) =>
        `${m} ${p
          .replace("ROADMAP", ":id")
          .replace("DECISION", ":decisionId")
          .replace("MODULE", ":moduleId")
          .replace("LESSON", ":lessonId")
          .replace("SUBMISSION", ":id")
          .replace("EXERCISE", ":id")
          .replace("ASSESSMENT", ":assessmentId")
          .replace("AI_OUTPUT", ":id")}`,
      ),
    );
    // The roadmap decision routes name their first param differently.
    listed.add("get /roadmaps/:roadmapId/decisions/:decisionId");
    listed.add("post /roadmaps/:roadmapId/decisions/:decisionId");

    const missing = [...registered].filter((route) => {
      const path = route.slice(route.indexOf(" ") + 1);
      if (exempt.includes(path)) return false;
      if (listed.has(route)) return false;
      // The decision routes above, listed under the other param name.
      return !route.includes("/decisions/");
    });

    expect(missing, "these routes are not in LEARNER_ROUTES").toEqual([]);
  });
});

/**
 * §9.2: "A learner cannot read or change another learner's roadmap,
 * submissions, project, or certificates."
 *
 * Submissions, projects and certificates have no endpoints yet. The roadmap
 * ones are here, and the shape is the one to copy when the rest arrive.
 *
 * **404, not 403.** Telling someone a record exists but is not theirs confirms
 * the record — which is itself the leak (`design.md` §5.3's reasoning, applied
 * to ids).
 */
const OWNED_ROUTES: [method: "get" | "post" | "patch", path: string, body: unknown][] = [
  ["get", "/roadmaps/ROADMAP", {}],
  ["patch", "/roadmaps/ROADMAP", { weeklyHours: 30 }],
  ["get", "/roadmaps/ROADMAP/decisions/DECISION", {}],
  ["post", "/roadmaps/ROADMAP/decisions/DECISION", "CHOICE"],
  ["get", "/submissions/SUBMISSION", {}],
  ["post", "/ai-outputs/AI_OUTPUT/flags", { reason: "not right" }],
];

describe("§9.2 — a learner cannot reach another learner's records", () => {
  it.each(OWNED_ROUTES)(
    "%s %s answers 404 for somebody else's roadmap",
    async (method, path, body) => {
      const res = await as(mine)
        [method](fill(path, theirs))
        .send(body === "CHOICE" ? choice() : (body as object));

      expect(res.status, `${method} ${path} answered ${res.status}`).toBe(404);
      expect(JSON.stringify(res.body)).not.toContain(theirs.roadmapId);
    },
  );

  it("changes nothing on the other learner's roadmap", async () => {
    const before = db.rows("roadmaps").find((r) => r.id === theirs.roadmapId)!;

    for (const [method, path, body] of OWNED_ROUTES) {
      await as(mine)
        [method](fill(path, theirs))
        .send(body === "CHOICE" ? choice() : (body as object));
    }

    const after = db.rows("roadmaps").find((r) => r.id === theirs.roadmapId)!;
    expect(after).toEqual(before);
    expect(db.rows("module_completions")).toHaveLength(0);
  });

  /** Their own roadmap still works — a 404 for everything would also pass above. */
  it.each(OWNED_ROUTES)("%s %s still serves the learner's own", async (method, path, body) => {
    const res = await as(mine)
      [method](fill(path, mine))
      .send(body === "CHOICE" ? choice() : (body as object));
    expect(res.status, `${method} ${path} answered ${res.status}`).toBeLessThan(400);
  });

  /** §6.1 step 3: the id comes from the session, never from the body. */
  it("ignores a user id in the body", async () => {
    await as(mine)
      .put("/onboarding/about")
      .send({
        experienceLevel: "comfortable",
        goal: "company_job",
        weeklyHours: 20,
        userId: theirs.id,
        user_id: theirs.id,
      });

    const other = db.rows("learner_profiles").find((r) => r.user_id === theirs.id)!;
    expect(other.experience_level).toBeNull();
  });
});

/**
 * §9.2: "Quiz answer keys, hidden test cases, reference solutions, and rubrics
 * never appear in learner responses."
 *
 * The planted values are the test. A field name can be renamed and a test that
 * checks field names would keep passing; a value that was only ever in a secret
 * column cannot appear in a response by accident.
 */
describe("§9.2 — no learner response carries a secret", () => {
  const LEARNER_GETS = [
    "/auth/me",
    "/career-paths",
    "/onboarding",
    "/home",
    "/roadmaps",
    "/roadmaps/ROADMAP",
    "/roadmaps/ROADMAP/decisions/DECISION",
    "/modules/MODULE",
    "/assessments/ASSESSMENT",
    "/exercises/EXERCISE",
    "/submissions/SUBMISSION",
  ];

  it.each(LEARNER_GETS)("%s does not contain the explanation", async (path) => {
    const res = await as(mine).get(fill(path, mine));

    // Withheld until the learner answers correctly (§5.10), so it must not
    // arrive alongside the questions.
    const body = JSON.stringify(res.body);
    expect(body, `${path} leaked the explanation`).not.toContain(PLANTED.explanation);
    expect(body, `${path} leaked a hidden test case`).not.toContain(PLANTED.hiddenCase);
    expect(body, `${path} leaked a hidden assertion`).not.toContain(PLANTED.hiddenCode);
    expect(body, `${path} leaked the reference solution`).not.toContain(PLANTED.solution);
  });

  it.each(LEARNER_GETS)("%s names no answer-key field", async (path) => {
    const res = await as(mine).get(fill(path, mine));
    const body = JSON.stringify(res.body);

    for (const field of ["correctOptionId", "correct_option_id", "answerKey", "answer_key"]) {
      expect(body, `${path} names ${field}`).not.toContain(field);
    }
  });

  /**
   * The one place a key may be returned, and only for a question the learner
   * already answered correctly (§5.10) — so a retake still means something.
   */
  /**
   * The strongest form of "the answer key never leaks": after a **wrong**
   * answer, nothing in the response says which option was right — not the
   * explanation, and not the correct option's id.
   */
  it("says nothing about the right answer after a wrong one", async () => {
    const wrong = await as(mine)
      .post(`/assessments/${ids.assessment}/attempts`)
      .send({ answers: { [ids.question]: ids.wrong } });

    const body = JSON.stringify(wrong.body);
    expect(body).not.toContain(PLANTED.explanation);
    expect(body, "the correct option id came back after a wrong answer").not.toContain(ids.right);
  });

  /** And it does arrive once earned, so a pass is worth something. */
  it("returns the explanation for a question answered correctly", async () => {
    const right = await as(mine)
      .post(`/assessments/${ids.assessment}/attempts`)
      .send({ answers: { [ids.question]: ids.right } });

    expect(JSON.stringify(right.body)).toContain(PLANTED.explanation);
  });
});

/**
 * §9.2: "Completions, scores, and certificates cannot be set from a request
 * body." AGENT.md §6 rule 1 in its strongest form — every mutating learner
 * endpoint, with progress in the body, and nothing written.
 */
describe("§9.2 — progress cannot be set from a request body", () => {
  const MUTATIONS: [method: "post" | "put" | "patch", path: string, valid: object][] = [
    ["put", "/onboarding/about", { experienceLevel: "none", goal: "freelance", weeklyHours: 5 }],
    ["put", "/onboarding/target", { careerPathId: "PATH" }],
    ["post", "/onboarding/placement", { careerPathId: "PATH", ratings: {} }],
    ["post", "/onboarding/generating/retry", {}],
    ["patch", "/roadmaps/ROADMAP", { weeklyHours: 6 }],
    ["post", "/roadmaps/ROADMAP/decisions/DECISION", { technologyId: "TECHNOLOGY" }],
    ["post", "/modules/MODULE/start", {}],
    ["post", "/lessons/LESSON/complete", {}],
    ["post", "/assessments/ASSESSMENT/attempts", { answers: {} }],
    ["post", "/exercises/EXERCISE/submissions", { files: [{ path: "a.js", content: "x" }] }],
    ["post", "/ai-outputs/AI_OUTPUT/flags", { reason: "not right" }],
  ];

  const POISON = {
    passed: true,
    score: 100,
    method: "passed",
    completed: true,
    moduleId: "MODULE",
    certificateId: "forged",
  };

  it.each(MUTATIONS)("%s %s writes no completion from a poisoned body", async (method, path, valid) => {
    const body = JSON.parse(
      JSON.stringify({ ...valid, ...POISON })
        .replace(/"PATH"/g, `"${ids.path}"`)
        .replace(/"TECHNOLOGY"/g, `"${ids.technology}"`)
        .replace(/"MODULE"/g, `"${ids.module}"`),
    );

    await as(mine)[method](fill(path, mine)).send(body);

    /**
     * A completion may legitimately exist — passing the quiz writes one — so
     * what matters is that none of them carries the forged score or method.
     */
    for (const row of db.rows("module_completions")) {
      expect(row.score, `${method} ${path} took a score from the body`).not.toBe(100);
      expect(row.method, `${method} ${path} took a method from the body`).not.toBe("passed");
    }
    expect(db.rows("certificates"), `${method} ${path} wrote a certificate`).toHaveLength(0);
  });

  /**
   * The attempt body is `.strict()`, so a score in it is **refused** rather
   * than ignored — a client that tries is told, not quietly disbelieved.
   */
  it("refuses an attempt whose body carries a score", async () => {
    const res = await as(mine)
      .post(`/assessments/${ids.assessment}/attempts`)
      .send({ answers: { [ids.question]: ids.right }, score: 0, passed: false });

    expect(res.status).toBe(400);
    expect(db.rows("module_completions")).toHaveLength(0);
  });

  /** And a clean body is graded on the server, from the key. */
  it("writes a completion only from server-side grading", async () => {
    const res = await as(mine)
      .post(`/assessments/${ids.assessment}/attempts`)
      .send({ answers: { [ids.question]: ids.right } });

    expect(res.status).toBe(200);
    expect(res.body.result.score).toBe(100);
    const done = db.rows("module_completions");
    expect(done).toHaveLength(1);
    expect(Number(done[0].score)).toBe(100);
  });
});

/**
 * §9.2: "A learner cannot reach admin endpoints."
 *
 * **Every registered `/admin` route is walked**, rather than a hand-kept list.
 * The previous version of this asserted there were none — `requireAdmin`
 * existed and no route used it — with a message saying to replace it the day
 * one appeared. `/admin/flags` is that day.
 *
 * Reading the route table means a new admin endpoint is covered the moment it
 * is mounted, which is the property that matters: the API fails open, so an
 * admin route nobody remembered to list is an admin route serving every
 * learner's data to anyone.
 */
describe("§9.2 — admin endpoints", () => {
  const adminRoutes = () =>
    routeTable().filter((r) => r.path.startsWith("/admin"));

  it("registers at least one, so this suite is actually checking something", () => {
    expect(adminRoutes().length).toBeGreaterThan(0);
  });

  it("answers 404 on every admin route for a learner", async () => {
    const routes = adminRoutes();

    for (const { method, path } of routes) {
      const url = path.replace(/:[A-Za-z]+/g, "00000000-0000-0000-0000-000000000000");
      const res = await as(mine)
        [method as "get" | "post" | "patch" | "put"](url)
        .send({});

      expect(res.status, `${method} ${path} answered ${res.status} for a learner`).toBe(404);
    }
  });

  it("answers 401 on every admin route with no session", async () => {
    for (const { method, path } of adminRoutes()) {
      const url = path.replace(/:[A-Za-z]+/g, "00000000-0000-0000-0000-000000000000");
      const res = await request(app)
        [method as "get" | "post" | "patch" | "put"](url)
        .set("Origin", config.appOrigin)
        .send({});

      expect(res.status, `${method} ${path} answered ${res.status} unauthenticated`).toBe(401);
    }
  });

  /** §6 rule 8: there is no request that can make an account an admin. */
  it("gives a learner no way to become one", async () => {
    for (const body of [{ role: "admin" }, { user: { role: "admin" } }]) {
      await as(mine).patch(`/roadmaps/${mine.roadmapId}`).send({ weeklyHours: 6, ...body });
      await as(mine).post(`/ai-outputs/${mine.aiOutputId}/flags`).send({ reason: "x", ...body });
    }

    expect(db.rows("users").find((u) => u.id === mine.id)!.role).toBe("learner");
  });

  /** The middleware itself works; `middleware/session.test.ts` mutation-tested it. */
  it("keeps a learner out of an admin-guarded route", async () => {
    const res = await as(mine).get("/home");
    expect(res.status).toBe(200);
    expect(db.rows("users").find((u) => u.id === mine.id)!.role).toBe("learner");
  });
});
