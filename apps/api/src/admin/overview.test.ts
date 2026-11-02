import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../app.js";
import { createTestDb, type TestDb } from "@first-commit/test-db";
import { post } from "../test/http.js";
import type { Mailer } from "../mail/index.js";

const silentMailer: Mailer = { name: "test", async send() {} };

/**
 * The admin overview (design.md §6.1).
 *
 * **Every number here is counted, never estimated**, and most of these tests are
 * about *how* it counts. A page whose job is to say what needs attention is
 * worse than useless when its figures drift: an admin learns not to trust them
 * and stops acting on them.
 *
 * The two counting rules worth pinning are that a module's pass rate is **per
 * learner, not per attempt**, and that a milestone's stuck rate counts only
 * projects that actually reached it.
 */

let db: TestDb;
let app: Express;
let adminCookie: string;
let learnerCookie: string;
let learnerId: string;
let ids: Record<string, string> = {};

const overview = (cookie: string) =>
  request(app).get("/admin/overview").set("Cookie", cookie);

const one = async (sql: string, params: unknown[] = []) =>
  (await db.pool.query<{ id: string }>(sql, params)).rows[0].id;

beforeEach(async () => {
  db = createTestDb();
  app = createApp({ pool: db.pool, mailer: silentMailer });
  ids = {};

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

  ids.skill = await one(
    `insert into skills (slug, name) values ('js','JavaScript') returning id`,
  );
  ids.module = await one(
    `insert into modules (skill_id, kind, slug, status)
     values ($1,'core','arrays','published') returning id`,
    [ids.skill],
  );
});

describe("who may read it", () => {
  it("answers an admin", async () => {
    const res = await overview(adminCookie);
    expect(res.status).toBe(200);
  });

  /** §6.1 step 5: 404, not 403 — a 403 confirms the route exists. */
  it("answers 404 to a learner", async () => {
    const res = await overview(learnerCookie);
    expect(res.status).toBe(404);
  });

  it("requires a session", async () => {
    expect((await request(app).get("/admin/overview")).status).toBe(401);
  });
});

describe("needs review", () => {
  it("counts only open flags", async () => {
    const version = await one(
      `insert into module_versions (module_id, version_no, title, status)
       values ($1,1,'Arrays','published') returning id`,
      [ids.module],
    );
    const job = await one(
      `insert into ai_jobs (type, user_id, payload, status)
       values ('code_feedback',$1,'{}','completed') returning id`,
      [learnerId],
    );
    const output = await one(
      `insert into ai_outputs (job_id, user_id, source_type, source_id, content)
       values ($1,$2,'code_feedback',$3,'{}') returning id`,
      [job, learnerId, version],
    );
    await db.pool.query(
      `insert into ai_feedback_flags (ai_output_id, user_id, reason, status)
       values ($1,$2,'wrong','open')`,
      [output, learnerId],
    );

    const open = await overview(adminCookie);
    expect(open.body.openAiFlags).toBe(1);

    await db.pool.query(`update ai_feedback_flags set status = 'confirmed_wrong'`);

    const decided = await overview(adminCookie);
    expect(decided.body.openAiFlags).toBe(0);
  });

  it("starts at zero rather than omitting the count", async () => {
    const res = await overview(adminCookie);

    expect(res.body.openAiFlags).toBe(0);
    expect(res.body.openProjectFlags).toBe(0);
  });
});

describe("content gaps", () => {
  it("counts unpublished module versions and names the newest", async () => {
    await db.pool.query(
      `insert into module_versions (module_id, version_no, title, status)
       values ($1,1,'Published one','published'), ($1,2,'A draft','draft')`,
      [ids.module],
    );

    const res = await overview(adminCookie);

    expect(res.body.draftCount).toBe(1);
    expect(res.body.drafts[0].title).toBe("A draft");
    expect(res.body.drafts[0].moduleSlug).toBe("arrays");
  });
});

describe("struggling modules", () => {
  const attempt = async (assessment: string, user: string, passed: boolean, no = 1) =>
    db.pool.query(
      `insert into assessment_attempts (user_id, assessment_id, attempt_no, score, passed)
       values ($1,$2,$3,$4,$5)`,
      [user, assessment, no, passed ? 100 : 0, passed],
    );

  const learners = async (count: number) => {
    const out: string[] = [];
    for (let i = 0; i < count; i++) {
      out.push(
        await one(
          `insert into users (email, password_hash, full_name)
           values ($1,'x','L') returning id`,
          [`l${i}@example.com`],
        ),
      );
    }
    return out;
  };

  const seedAssessment = async () => {
    const version = await one(
      `insert into module_versions (module_id, version_no, title, status)
       values ($1,1,'Arrays and objects','published') returning id`,
      [ids.module],
    );
    return one(
      `insert into assessments (module_version_id, type, title, passing_score)
       values ($1,'quiz','Quiz',70) returning id`,
      [version],
    );
  };

  /**
   * **Per learner, not per attempt.** One learner failing six times and passing
   * on the seventh got there. Counting attempts reads that as a 14% pass rate
   * and sends an admin to rewrite a module that works.
   */
  it("counts a learner who eventually passed as a pass", async () => {
    const assessment = await seedAssessment();
    const [a, b, c] = await learners(3);

    for (let i = 1; i <= 6; i++) await attempt(assessment, a, false, i);
    await attempt(assessment, a, true, 7);
    await attempt(assessment, b, true);
    await attempt(assessment, c, true);

    const res = await overview(adminCookie);

    // Everybody passed, so nothing is struggling.
    expect(res.body.strugglingModules).toEqual([]);
  });

  it("reports a module most learners have not passed", async () => {
    const assessment = await seedAssessment();
    const [a, b, c, d] = await learners(4);

    await attempt(assessment, a, true);
    for (const user of [b, c, d]) await attempt(assessment, user, false);

    const res = await overview(adminCookie);

    expect(res.body.strugglingModules).toHaveLength(1);
    expect(res.body.strugglingModules[0].slug).toBe("arrays");
    expect(res.body.strugglingModules[0].learners).toBe(4);
    expect(res.body.strugglingModules[0].passRate).toBeCloseTo(0.25);
  });

  /**
   * One learner failing once is a 0% pass rate. Showing that at the top of the
   * page would bury the module fifteen people are actually stuck on.
   */
  it("ignores a module too few learners have attempted", async () => {
    const assessment = await seedAssessment();
    const [a, b] = await learners(2);

    await attempt(assessment, a, false);
    await attempt(assessment, b, false);

    const res = await overview(adminCookie);
    expect(res.body.strugglingModules).toEqual([]);
  });
});

describe("the month's certificates", () => {
  const giveCertificate = async (code: string, status: string, issuedAt: string) => {
    const path = await one(
      `insert into career_paths (slug, title, status) values ($1,'JWD','published') returning id`,
      [`jwd-${code}`],
    );
    const roadmap = await one(
      `insert into roadmaps (user_id, career_path_id, status)
       values ($1,$2,'active') returning id`,
      [learnerId, path],
    );
    await db.pool.query(
      `insert into certificates (public_code, user_id, type, roadmap_id, recipient_name, title,
                                 status, issued_at, revoked_at, revoked_reason)
       values ($1,$2,'completion',$3,'A Learner','JWD',$4,$5,$6,$7)`,
      [
        code,
        learnerId,
        roadmap,
        status,
        issuedAt,
        // The schema requires both, or neither, on a revoked certificate.
        status === "revoked" ? issuedAt : null,
        status === "revoked" ? "Withdrawn for this test." : null,
      ],
    );
  };

  it("counts this month's, and separates the revoked", async () => {
    await giveCertificate("FC-AAAA-0001", "valid", new Date().toISOString());
    await giveCertificate("FC-AAAA-0002", "revoked", new Date().toISOString());
    await giveCertificate("FC-AAAA-0003", "valid", "2020-01-05T00:00:00Z");

    const res = await overview(adminCookie);

    expect(res.body.certificatesThisMonth).toBe(1);
    expect(res.body.revokedThisMonth).toBe(1);
  });
});

/**
 * §6.1's "Learners struggling" second row — **a panel that had no test at all
 * until §6.9 was built**, which is how its milestone title could come back as
 * the brief's title under pg-mem without anything noticing.
 *
 * Two assertions, and the first one is the point: the **labels**, because the
 * figure was never wrong. `milestones.title` and
 * `capstone_brief_versions.title` share a column name, and under `group by`
 * pg-mem resolves two aliases of the same name to the same value — so §6.1's
 * "Milestone 4: Save tasks — 38% stuck" would have read "Task tracker — 38%
 * stuck", correct in production and wrong in every test.
 */
describe("struggling milestones", () => {
  let briefVersionId: string;
  let technologyId: string;
  let pathId: string;
  let trackId: string;

  beforeEach(async () => {
    pathId = await one(
      `insert into career_paths (slug, title, status) values ('jwd','JWD','published') returning id`,
    );
    trackId = await one(
      `insert into tracks (career_path_id, title, status)
       values ($1,'Frontend','published') returning id`,
      [pathId],
    );
    technologyId = await one(
      `insert into technologies (slug, name) values ('react','React') returning id`,
    );
    const briefId = await one(
      `insert into capstone_briefs (track_id, slug, status)
       values ($1,'task-tracker','published') returning id`,
      [trackId],
    );
    briefVersionId = await one(
      `insert into capstone_brief_versions (brief_id, version_no, title, status, published_at)
       values ($1,1,'Task tracker','published', now()) returning id`,
      [briefId],
    );
  });

  const project = async (email: string) => {
    const userId = await one(
      `insert into users (email, password_hash, full_name) values ($1,'x',$1) returning id`,
      [email],
    );
    const roadmapId = await one(
      `insert into roadmaps (user_id, career_path_id, track_id, status)
       values ($1,$2,$3,'active') returning id`,
      [userId, pathId, trackId],
    );
    return one(
      `insert into capstone_projects (user_id, roadmap_id, brief_version_id, technology_id, status)
       values ($1,$2,$3,$4,'in_progress') returning id`,
      [userId, roadmapId, briefVersionId, technologyId],
    );
  };

  /** The milestone's own title, not the brief's. */
  it("names the milestone and the brief separately", async () => {
    const milestoneId = await one(
      `insert into milestones (brief_version_id, sort_order, title)
       values ($1,0,'Save tasks') returning id`,
      [briefVersionId],
    );
    for (const n of ["a", "b", "c", "d"]) {
      const projectId = await project(`${n}@example.com`);
      await db.pool.query(
        `insert into milestone_attempts (project_id, milestone_id, commit_sha, status)
         values ($1,$2,$3,'failed')`,
        [projectId, milestoneId, `sha-${n}`],
      );
    }

    const res = await overview(adminCookie);

    expect(res.body.strugglingMilestones[0].title).toBe("Save tasks");
    expect(res.body.strugglingMilestones[0].briefTitle).toBe("Task tracker");
  });

  /**
   * **Stuck means tried and not finished**, counted per project. A project
   * that has not reached a milestone is not stuck on it — here five projects
   * exist and four attempted, so a query counting every project would put the
   * rate at 4/5 rather than 3/4.
   */
  it("counts only the projects that reached the milestone", async () => {
    const milestoneId = await one(
      `insert into milestones (brief_version_id, sort_order, title)
       values ($1,0,'Save tasks') returning id`,
      [briefVersionId],
    );
    for (const [i, n] of ["a", "b", "c", "d"].entries()) {
      const projectId = await project(`${n}@example.com`);
      await db.pool.query(
        `insert into milestone_attempts (project_id, milestone_id, commit_sha, status)
         values ($1,$2,$3,$4)`,
        [projectId, milestoneId, `sha-${n}`, i === 0 ? "complete" : "failed"],
      );
    }
    await project("never@example.com");

    const res = await overview(adminCookie);

    expect(res.body.strugglingMilestones[0].attempted).toBe(4);
    expect(res.body.strugglingMilestones[0].stuckRate).toBeCloseTo(0.75);
  });

  /** One project is not a trend. The overview's threshold applies here too. */
  it("says nothing about a milestone too few projects have reached", async () => {
    const milestoneId = await one(
      `insert into milestones (brief_version_id, sort_order, title)
       values ($1,0,'Save tasks') returning id`,
      [briefVersionId],
    );
    const projectId = await project("only@example.com");
    await db.pool.query(
      `insert into milestone_attempts (project_id, milestone_id, commit_sha, status)
       values ($1,$2,'sha','failed')`,
      [projectId, milestoneId],
    );

    const res = await overview(adminCookie);

    expect(res.body.strugglingMilestones).toHaveLength(0);
  });

  /** And a milestone nobody has reached is not a milestone anybody is stuck on. */
  it("does not report a milestone with no attempts", async () => {
    await one(
      `insert into milestones (brief_version_id, sort_order, title)
       values ($1,0,'Save tasks') returning id`,
      [briefVersionId],
    );

    const res = await overview(adminCookie);

    expect(res.body.strugglingMilestones).toHaveLength(0);
  });
});

/**
 * §6 rule 2: an admin surface reads more than a learner's, and still never
 * returns a secret. This page aggregates over `users` and `assessment_attempts`,
 * where a `select *` would be invisible in a JSON body nobody reads closely.
 */
describe("what it does not return", () => {
  it("returns no password hash, email or session token anywhere", async () => {
    const body = JSON.stringify((await overview(adminCookie)).body);

    expect(body).not.toMatch(/password_hash|passwordHash/i);
    expect(body).not.toMatch(/token_hash|tokenHash/i);
    expect(body).not.toContain("learner@example.com");
  });
});
