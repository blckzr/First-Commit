import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../app.js";
import { createTestDb, type TestDb } from "@first-commit/test-db";
import { post } from "../test/http.js";
import type { Mailer } from "../mail/index.js";

const silentMailer: Mailer = { name: "test", async send() {} };

/**
 * Analytics (design.md §6.9).
 *
 * Every fixture here is built so that a **wrong** query returns a *different*
 * number, not the same one. That is the whole discipline of this file: a funnel
 * fed one learner at one stage passes against almost any implementation, and
 * the mistakes worth catching — counting attempts instead of learners, counting
 * current state instead of stages reached, reporting an unanswerable question
 * as zero — all produce a plausible figure rather than an error.
 */

let db: TestDb;
let app: Express;
let adminCookie: string;
let learnerCookie: string;
let pathId: string;
let trackId: string;

const one = async (sql: string, params: unknown[] = []) =>
  (await db.pool.query<{ id: string }>(sql, params)).rows[0].id;

const read = (path: string, cookie = adminCookie) =>
  request(app).get(`/admin/analytics/${path}`).set("Cookie", cookie);

/** A learner, their roadmap, and nothing else. */
async function learner(email: string) {
  const id = await one(
    `insert into users (email, password_hash, full_name, email_verified_at)
     values ($1, 'x', $2, now()) returning id`,
    [email, email.split("@")[0]],
  );
  const roadmapId = await one(
    `insert into roadmaps (user_id, career_path_id, track_id, status)
     values ($1,$2,$3,'active') returning id`,
    [id, pathId, trackId],
  );
  return { id, roadmapId };
}

async function coreModule(slug: string, required = true) {
  const skillId = await one(
    `insert into skills (slug, name) values ($1, $1) returning id`,
    [`skill-${slug}`],
  );
  const moduleId = await one(
    `insert into modules (skill_id, kind, slug, status)
     values ($1,'core',$2,'published') returning id`,
    [skillId, slug],
  );
  const versionId = await one(
    `insert into module_versions (module_id, version_no, title, status)
     values ($1,1,$2,'published') returning id`,
    [moduleId, slug],
  );
  const pathSkillId = await one(
    `insert into path_skills (career_path_id, skill_id, layer) values ($1,$2,'core') returning id`,
    [pathId, skillId],
  );
  await db.pool.query(
    `insert into path_skill_modules (path_skill_id, module_id, required_for_certificate)
     values ($1,$2,$3)`,
    [pathSkillId, moduleId, required],
  );
  return { moduleId, versionId };
}

const pass = (userId: string, moduleId: string, versionId: string) =>
  db.pool.query(
    `insert into module_completions (user_id, module_id, module_version_id, method, score)
     values ($1,$2,$3,'passed',90)`,
    [userId, moduleId, versionId],
  );

beforeEach(async () => {
  db = createTestDb();
  app = createApp({ pool: db.pool, mailer: silentMailer });

  const l = await post(app, "/auth/signup").send({
    fullName: "A Learner",
    email: "learner@example.com",
    password: "a-good-password",
  });
  learnerCookie = (l.headers["set-cookie"] as unknown as string[])[0].split(";")[0];

  const admin = await post(app, "/auth/signup").send({
    fullName: "An Admin",
    email: "admin@example.com",
    password: "a-good-password",
  });
  adminCookie = (admin.headers["set-cookie"] as unknown as string[])[0].split(";")[0];
  // §6 rule 8: no endpoint sets `users.role`.
  await db.pool.query(`update users set role = 'admin' where email = 'admin@example.com'`);

  pathId = await one(
    `insert into career_paths (slug, title, status)
     values ('jwd','Junior Web Developer','published') returning id`,
  );
  trackId = await one(
    `insert into tracks (career_path_id, title, status)
     values ($1,'Frontend','published') returning id`,
    [pathId],
  );
});

describe("the journey funnel", () => {
  const stage = (body: { stages: { key: string; learners: number }[] }, key: string) =>
    body.stages.find((s) => s.key === key)!.learners;

  /**
   * **Finishing core means every required core module, not some of them.**
   *
   * Two learners, two required modules: one passed both, one passed one. A
   * query that counted learners with *any* completion would answer 2, which is
   * the plausible wrong number.
   */
  it("counts a learner as finishing core only when every required module is passed", async () => {
    const a = await coreModule("html");
    const b = await coreModule("css");
    const finished = await learner("finished@example.com");
    const partway = await learner("partway@example.com");

    await pass(finished.id, a.moduleId, a.versionId);
    await pass(finished.id, b.moduleId, b.versionId);
    await pass(partway.id, a.moduleId, a.versionId);

    const res = await read(`funnel?path=${pathId}`);

    expect(res.status).toBe(200);
    expect(stage(res.body, "started")).toBe(2);
    expect(stage(res.body, "finished_core")).toBe(1);
  });

  /** A module marked optional is not part of "finished core". */
  it("ignores a module the path does not require for the certificate", async () => {
    const required = await coreModule("html");
    await coreModule("branching", false);
    const only = await learner("one@example.com");

    await pass(only.id, required.moduleId, required.versionId);

    expect(stage((await read(`funnel?path=${pathId}`)).body, "finished_core")).toBe(1);
  });

  /**
   * **Reaching a stage is permanent.**
   *
   * A funnel of *current* states would show a learner who earned a certificate
   * as having left the earlier stages, and every stage would shrink for the
   * wrong reason. Here one learner has done everything: every stage is 1.
   */
  it("keeps a learner in every stage they reached", async () => {
    const a = await coreModule("html");
    const done = await learner("done@example.com");
    await pass(done.id, a.moduleId, a.versionId);

    const technologyId = await one(
      `insert into technologies (slug, name) values ('react','React') returning id`,
    );
    const decisionId = await one(
      `insert into technology_decisions (track_id, title)
       values ($1,'Choose a framework') returning id`,
      [trackId],
    );
    await db.pool.query(
      `insert into decision_options (decision_id, technology_id, status)
       values ($1,$2,'published')`,
      [decisionId, technologyId],
    );
    await db.pool.query(
      `insert into roadmap_technology_choices (roadmap_id, decision_id, technology_id, chosen_at)
       values ($1,$2,$3, now())`,
      [done.roadmapId, decisionId, technologyId],
    );

    const briefId = await one(
      `insert into capstone_briefs (track_id, slug, status)
       values ($1,'task-tracker','published') returning id`,
      [trackId],
    );
    const briefVersionId = await one(
      `insert into capstone_brief_versions (brief_id, version_no, title, status, published_at)
       values ($1,1,'Task tracker','published', now()) returning id`,
      [briefId],
    );
    const projectId = await one(
      `insert into capstone_projects (user_id, roadmap_id, brief_version_id, technology_id, status)
       values ($1,$2,$3,$4,'completed') returning id`,
      [done.id, done.roadmapId, briefVersionId, technologyId],
    );
    await db.pool.query(
      `insert into certificates (public_code, user_id, type, roadmap_id, recipient_name, title)
       values ('FC-AAAA-1111',$1,'completion',$2,'done','JWD')`,
      [done.id, done.roadmapId],
    );
    await db.pool.query(
      `insert into certificates (public_code, user_id, type, roadmap_id, project_id, recipient_name, title)
       values ('FC-BBBB-2222',$1,'project',$2,$3,'done','Task tracker')`,
      [done.id, done.roadmapId, projectId],
    );

    const res = await read(`funnel?path=${pathId}`);

    expect(res.body.stages.map((s: { learners: number }) => s.learners)).toEqual([
      1, 1, 1, 1, 1, 1,
    ]);
  });

  /** A revoked certificate is not an earned one. */
  it("does not count a revoked certificate", async () => {
    const who = await learner("revoked@example.com");
    await db.pool.query(
      `insert into certificates
         (public_code, user_id, type, roadmap_id, recipient_name, title, status, revoked_reason)
       values ('FC-CCCC-3333',$1,'completion',$2,'revoked','JWD','revoked','Plagiarised')`,
      [who.id, who.roadmapId],
    );

    expect(stage((await read(`funnel?path=${pathId}`)).body, "certificate_completion")).toBe(0);
  });

  it("refuses a path id it cannot read, and 404s one that does not exist", async () => {
    expect((await read("funnel?path=not-a-uuid")).status).toBe(400);
    expect(
      (await read("funnel?path=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")).status,
    ).toBe(404);
  });

  it("answers 404 to a learner", async () => {
    expect((await read(`funnel?path=${pathId}`, learnerCookie)).status).toBe(404);
    expect((await read("paths", learnerCookie)).status).toBe(404);
  });
});

describe("modules", () => {
  /**
   * **Per learner, never per attempt.**
   *
   * One learner fails twice and passes on the third try. Counting attempts
   * gives a 33% pass rate and sends an author to rewrite a module that worked;
   * counting learners gives 100%, which is the truth. Three failures from the
   * same person is the fixture that tells the two apart.
   */
  it("counts a learner who eventually passed as a pass", async () => {
    const m = await coreModule("js");
    const assessmentId = await one(
      `insert into assessments (module_version_id, type, title, passing_score)
       values ($1,'quiz','Check',70) returning id`,
      [m.versionId],
    );
    const three = await Promise.all(
      ["a", "b", "c"].map((n) => learner(`${n}@example.com`)),
    );
    for (const [i, who] of three.entries()) {
      await db.pool.query(
        `insert into assessment_attempts (user_id, assessment_id, attempt_no, score, passed)
         values ($1,$2,1,40,false), ($1,$2,2,50,false), ($1,$2,3,90,true)`,
        [who.id, assessmentId],
      );
      expect(i).toBeLessThan(3);
    }

    const res = await read("modules");
    const js = res.body.modules.find((x: { slug: string }) => x.slug === "js");

    expect(js.attempted).toBe(3);
    expect(js.passed).toBe(3);
    expect(js.passRate).toBe(1);
  });

  /**
   * **Drop-off and pass rate are different questions**, and a module can be
   * fine on one and terrible on the other. Here three learners started, one
   * finished, and the only learner who reached the quiz passed it: 100% pass
   * rate beside 67% drop-off. A screen showing one number could not say that.
   */
  it("reports drop-off separately from pass rate", async () => {
    const m = await coreModule("js");
    const three = await Promise.all(
      ["a", "b", "c"].map((n) => learner(`${n}@example.com`)),
    );
    for (const who of three) {
      await db.pool.query(
        `insert into module_enrollments (user_id, module_id, module_version_id)
         values ($1,$2,$3)`,
        [who.id, m.moduleId, m.versionId],
      );
    }
    await pass(three[0].id, m.moduleId, m.versionId);

    const js = (await read("modules")).body.modules.find(
      (x: { slug: string }) => x.slug === "js",
    );

    expect(js.started).toBe(3);
    expect(js.completed).toBe(1);
    expect(js.droppedOff).toBe(2);
    expect(js.dropOffRate).toBeCloseTo(2 / 3);
  });

  /**
   * **A rate needs a denominator worth having.** One learner is not a trend, so
   * below the threshold the rate is null and the screen says "too few to say"
   * rather than printing 0%.
   */
  it("returns no rate below the threshold, rather than a misleading one", async () => {
    const m = await coreModule("js");
    const assessmentId = await one(
      `insert into assessments (module_version_id, type, title, passing_score)
       values ($1,'quiz','Check',70) returning id`,
      [m.versionId],
    );
    const only = await learner("only@example.com");
    await db.pool.query(
      `insert into assessment_attempts (user_id, assessment_id, attempt_no, score, passed)
       values ($1,$2,1,10,false)`,
      [only.id, assessmentId],
    );

    const js = (await read("modules")).body.modules.find(
      (x: { slug: string }) => x.slug === "js",
    );

    expect(js.attempted).toBe(1);
    expect(js.passed).toBe(0);
    expect(js.passRate).toBeNull();
    expect((await read("modules")).body.enoughLearners).toBe(3);
  });

  it("counts a code submission as well as a quiz attempt", async () => {
    const m = await coreModule("js");
    const assessmentId = await one(
      `insert into assessments (module_version_id, type, title, passing_score, runtime)
       values ($1,'code','Exercise',100,'javascript') returning id`,
      [m.versionId],
    );
    const three = await Promise.all(
      ["a", "b", "c"].map((n) => learner(`${n}@example.com`)),
    );
    for (const who of three) {
      await db.pool.query(
        `insert into code_submissions (user_id, assessment_id, files, status, passed)
         values ($1,$2,'[]','completed',true)`,
        [who.id, assessmentId],
      );
    }

    const js = (await read("modules")).body.modules.find(
      (x: { slug: string }) => x.slug === "js",
    );

    expect(js.attempted).toBe(3);
    expect(js.passRate).toBe(1);
  });

  /** A submission still running is not an answer either way. */
  it("ignores a submission that has not finished", async () => {
    const m = await coreModule("js");
    const assessmentId = await one(
      `insert into assessments (module_version_id, type, title, passing_score, runtime)
       values ($1,'code','Exercise',100,'javascript') returning id`,
      [m.versionId],
    );
    const who = await learner("queued@example.com");
    await db.pool.query(
      `insert into code_submissions (user_id, assessment_id, files, status)
       values ($1,$2,'[]','queued')`,
      [who.id, assessmentId],
    );

    const js = (await read("modules")).body.modules.find(
      (x: { slug: string }) => x.slug === "js",
    );

    expect(js.attempted).toBe(0);
  });

  it("filters by technology", async () => {
    await coreModule("js");
    const technologyId = await one(
      `insert into technologies (slug, name) values ('react','React') returning id`,
    );
    const skillId = await one(
      `insert into skills (slug, name) values ('components','Components') returning id`,
    );
    await one(
      `insert into modules (skill_id, kind, technology_id, slug, status)
       values ($1,'technology',$2,'react-state','published') returning id`,
      [skillId, technologyId],
    );

    const all = await read("modules");
    expect(all.body.modules).toHaveLength(2);

    const filtered = await read(`modules?technology=${technologyId}`);
    expect(filtered.body.modules.map((m: { slug: string }) => m.slug)).toEqual(["react-state"]);
  });
});

describe("milestones", () => {
  let milestoneId: string;
  let briefVersionId: string;
  let technologyId: string;

  beforeEach(async () => {
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
    milestoneId = await one(
      `insert into milestones (brief_version_id, sort_order, title)
       values ($1,0,'Set up repository') returning id`,
      [briefVersionId],
    );
  });

  const project = async (email: string) => {
    const who = await learner(email);
    return one(
      `insert into capstone_projects (user_id, roadmap_id, brief_version_id, technology_id, status)
       values ($1,$2,$3,$4,'in_progress') returning id`,
      [who.id, who.roadmapId, briefVersionId, technologyId],
    );
  };

  /**
   * **Only projects that reached a milestone count against it.** A project that
   * has not got there is not stuck on it. Here four projects exist and three
   * attempted the milestone — a query counting every project would answer 4
   * attempted, making milestone one look like it stopped everybody still
   * connecting a repository.
   */
  it("counts only the projects that attempted it", async () => {
    const attempted = await Promise.all(["a", "b", "c"].map((n) => project(`${n}@example.com`)));
    await project("never@example.com");

    for (const [i, projectId] of attempted.entries()) {
      await db.pool.query(
        `insert into milestone_attempts (project_id, milestone_id, commit_sha, status)
         values ($1,$2,$3,$4)`,
        [projectId, milestoneId, `sha${i}`, i === 0 ? "complete" : "failed"],
      );
    }

    const res = await read("milestones");
    const m = res.body.milestones[0];

    expect(m.title).toBe("Set up repository");
    expect(m.briefTitle).toBe("Task tracker");
    expect(m.attempted).toBe(3);
    expect(m.complete).toBe(1);
    expect(m.stuck).toBe(2);
    expect(m.stuckRate).toBeCloseTo(2 / 3);
  });

  /** A milestone nobody has reached: counts of zero, and no rate to report. */
  it("reports a milestone with no attempts without inventing a rate", async () => {
    const res = await read("milestones");

    expect(res.body.milestones[0]).toMatchObject({ attempted: 0, stuck: 0, stuckRate: null });
  });

  it("answers 404 to a learner", async () => {
    expect((await read("milestones", learnerCookie)).status).toBe(404);
  });
});

describe("technology choices", () => {
  /**
   * **§6.9 asks for "switches between options" and the schema cannot answer
   * it.** `roadmap_technology_choices` is keyed `(roadmap_id, decision_id)`, so
   * changing a choice overwrites `technology_id` and leaves nothing behind.
   *
   * This test exists because the tempting implementation returns
   * `switches: 0` — a number that reads as "nobody switches", which is a claim
   * this platform cannot make. The response says the history is not recorded,
   * and the screen prints that sentence.
   */
  it("says switches are not recorded rather than reporting zero", async () => {
    const res = await read("technologies");

    expect(res.status).toBe(200);
    expect(res.body.switchesRecorded).toBe(false);
    expect(res.body.switchesReason).toMatch(/overwrites|nothing records/i);
    expect(res.body).not.toHaveProperty("switches");
  });

  it("reports the share taking each option, and who was recommended it", async () => {
    const react = await one(
      `insert into technologies (slug, name) values ('react','React') returning id`,
    );
    const vue = await one(
      `insert into technologies (slug, name) values ('vue','Vue') returning id`,
    );
    const decisionId = await one(
      `insert into technology_decisions (track_id, title)
       values ($1,'Choose a framework') returning id`,
      [trackId],
    );
    await db.pool.query(
      `insert into decision_options (decision_id, technology_id, status)
       values ($1,$2,'published'),($1,$3,'published')`,
      [decisionId, react, vue],
    );

    const choices: [string, string | null][] = [
      [react, react],
      [react, react],
      [vue, react],
      [null, react],
    ];
    for (const [i, [chosen, recommended]] of choices.entries()) {
      const who = await learner(`c${i}@example.com`);
      await db.pool.query(
        `insert into roadmap_technology_choices
           (roadmap_id, decision_id, technology_id, recommended_technology_id)
         values ($1,$2,$3,$4)`,
        [who.roadmapId, decisionId, chosen, recommended],
      );
    }

    const res = await read("technologies");
    const decision = res.body.decisions[0];

    expect(decision.title).toBe("Choose a framework");
    expect(decision.options).toEqual([
      { technology: "React", learners: 2, recommendedTo: 2 },
      { technology: "Vue", learners: 1, recommendedTo: 0 },
    ]);
    /** Null until chosen — a roadmap that reached the decision and stopped. */
    expect(decision.undecided).toBe(1);
  });
});

describe("AI quality", () => {
  let outputIds: string[];

  beforeEach(async () => {
    outputIds = [];
    for (let i = 0; i < 4; i += 1) {
      const who = await learner(`ai${i}@example.com`);
      outputIds.push(
        await one(
          `insert into ai_outputs (user_id, source_type, source_id, content)
           values ($1,'code_feedback',$2,'{}') returning id`,
          [who.id, who.roadmapId],
        ),
      );
    }
  });

  const flag = async (index: number, status: string) => {
    const userId = (
      await db.pool.query<{ user_id: string }>(
        `select user_id from ai_outputs where id = $1`,
        [outputIds[index]],
      )
    ).rows[0].user_id;
    await db.pool.query(
      `insert into ai_feedback_flags (ai_output_id, user_id, reason, status)
       values ($1,$2,'It told me the answer',$3)`,
      [outputIds[index], userId, status],
    );
  };

  /**
   * **The flag rate's denominator is AI outputs.** "2 flags" means nothing
   * without how much output there was to flag. Four outputs and two flags is
   * 50%; a query dividing by learners, roadmaps or flags would give a different
   * number, which is why those counts differ in this fixture.
   */
  it("reports the flag rate against the output that could be flagged", async () => {
    await flag(0, "confirmed_wrong");
    await flag(1, "open");

    const res = await read("ai");
    const source = res.body.sources[0];

    expect(source.outputs).toBe(4);
    expect(source.flags).toBe(2);
    expect(source.flagRate).toBe(0.5);
  });

  /**
   * **The share confirmed wrong is of *ruled* flags, not of all of them.** An
   * open flag is a question nobody has answered; counting it as "not wrong"
   * makes the model look better the further behind an admin falls. One wrong,
   * one correct and one open: the answer is 1/2, and dividing by 3 is the
   * mistake this catches.
   */
  it("measures the wrong share over ruled flags only", async () => {
    await flag(0, "confirmed_wrong");
    await flag(1, "confirmed_correct");
    await flag(2, "open");

    const source = (await read("ai")).body.sources[0];

    expect(source.confirmedWrong).toBe(1);
    expect(source.confirmedCorrect).toBe(1);
    expect(source.open).toBe(1);
    expect(source.wrongShare).toBe(0.5);
  });

  it("reports no wrong share while nothing has been ruled on", async () => {
    await flag(0, "open");

    expect((await read("ai")).body.sources[0].wrongShare).toBeNull();
  });

  it("answers 404 to a learner", async () => {
    expect((await read("ai", learnerCookie)).status).toBe(404);
  });
});

describe("certificates over time", () => {
  it("groups by month and type, counting revocations within the month issued", async () => {
    const who = await learner("cert@example.com");
    await db.pool.query(
      `insert into certificates
         (public_code, user_id, type, roadmap_id, recipient_name, title, issued_at)
       values ('FC-AAAA-1111',$1,'completion',$2,'cert','JWD', now())`,
      [who.id, who.roadmapId],
    );
    const second = await learner("cert2@example.com");
    await db.pool.query(
      `insert into certificates
         (public_code, user_id, type, roadmap_id, recipient_name, title, issued_at,
          status, revoked_reason)
       values ('FC-BBBB-2222',$1,'completion',$2,'cert2','JWD', now(),'revoked','Plagiarised')`,
      [second.id, second.roadmapId],
    );

    const res = await read("certificates");

    expect(res.status).toBe(200);
    expect(res.body.months).toHaveLength(1);
    expect(res.body.months[0]).toMatchObject({ type: "completion", issued: 2, revoked: 1 });
  });

  it("answers 404 to a learner", async () => {
    expect((await read("certificates", learnerCookie)).status).toBe(404);
  });
});
