import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../app.js";
import { createTestDb, type TestDb } from "@first-commit/test-db";
import { post } from "../test/http.js";
import type { Mailer } from "../mail/index.js";
import { flagProject } from "./integrity.js";

const silentMailer: Mailer = { name: "test", async send() {} };

/**
 * Integrity signals (§6.7, `project-proposal.md` §6).
 *
 * Two things carry most of the weight here.
 *
 * **A flag is a question, not a verdict.** Everything it touches must stay
 * untouched for the learner: the milestone still passed, the certificate is
 * still issued, and nothing on their screen moves. Withholding a certificate on
 * suspicion would punish the many people who simply work in an unusual order.
 *
 * **§6 rule 2 names integrity flags explicitly** as admin-only. A learner must
 * not be able to learn they were flagged — not from the capstone screen, not
 * from their certificates, not from the admin route.
 */

let db: TestDb;
let app: Express;
let learnerCookie: string;
let adminCookie: string;
let learnerId: string;
let projectId: string;

const asLearner = (path: string) => request(app).get(path).set("Cookie", learnerCookie);
const asAdmin = (path: string) => request(app).get(path).set("Cookie", adminCookie);

/** A finished project with a brief, milestones and a commit history. */
async function seedFinishedProject(options: {
  commits: number;
  milestones: number;
  explanationAnswer?: string | null;
}): Promise<void> {
  const one = async (sql: string, values: unknown[] = []) =>
    (await db.pool.query<{ id: string }>(sql, values)).rows[0].id;

  const path = await one(
    `insert into career_paths (slug, title, status) values ('jwd','Junior Web Developer','published') returning id`,
  );
  const track = await one(
    `insert into tracks (career_path_id, title, status) values ($1,'Frontend','published') returning id`,
    [path],
  );
  const tech = await one(`insert into technologies (slug, name) values ('react','React') returning id`);
  const roadmap = await one(
    `insert into roadmaps (user_id, career_path_id, track_id, status) values ($1,$2,$3,'active') returning id`,
    [learnerId, path, track],
  );
  const brief = await one(
    `insert into capstone_briefs (track_id, slug, status) values ($1,'task-tracker','published') returning id`,
    [track],
  );
  const version = await one(
    `insert into capstone_brief_versions (brief_id, version_no, title, status)
     values ($1,1,'Task tracker','published') returning id`,
    [brief],
  );

  projectId = await one(
    `insert into capstone_projects
       (user_id, roadmap_id, brief_version_id, technology_id, status, repo_full_name, completed_at)
     values ($1,$2,$3,$4,'completed','learner/task-tracker', now()) returning id`,
    [learnerId, roadmap, version, tech],
  );

  for (let i = 0; i < options.milestones; i += 1) {
    // Only the first milestone asks a question, so the explanation signal has
    // exactly one thing to find.
    const milestone = await one(
      `insert into milestones (brief_version_id, sort_order, title, explanation_question)
       values ($1,$2,$3,$4) returning id`,
      [version, i, `Milestone ${i + 1}`, i === 0 ? "How does your form stop an empty task?" : null],
    );
    await db.pool.query(
      `insert into milestone_attempts (project_id, milestone_id, commit_sha, status, explanation_answer)
       values ($1,$2,$3,'complete',$4)`,
      [projectId, milestone, `sha${i}`, i === 0 ? (options.explanationAnswer ?? null) : null],
    );
  }

  for (let i = 0; i < options.commits; i += 1) {
    await db.pool.query(
      `insert into project_commits (project_id, sha, message, pushed_at)
       values ($1,$2,$3, now())`,
      [projectId, `commit-sha-${i}`, `Commit ${i}`],
    );
  }
}

beforeEach(async () => {
  db = createTestDb();
  app = createApp({ pool: db.pool, mailer: silentMailer });

  const signUp = await post(app, "/auth/signup").send({
    fullName: "Jan Kevin Gerona",
    email: "learner@example.com",
    password: "a-good-password",
  });
  learnerCookie = (signUp.headers["set-cookie"] as unknown as string[])[0].split(";")[0];
  learnerId = (
    await db.pool.query<{ id: string }>(`select id from users where email = 'learner@example.com'`)
  ).rows[0].id;

  const adminSignUp = await post(app, "/auth/signup").send({
    fullName: "An Admin",
    email: "admin@example.com",
    password: "a-good-password",
  });
  adminCookie = (adminSignUp.headers["set-cookie"] as unknown as string[])[0].split(";")[0];
  // §6 rule 8: no endpoint sets `users.role`. Direct SQL is the sanctioned way.
  await db.pool.query(`update users set role = 'admin' where email = 'admin@example.com'`);
});

describe("what gets flagged", () => {
  /**
   * **The most common innocent case in the whole feature.** Somebody who builds
   * offline for a week and pushes once looks identical from here to somebody who
   * pasted a finished repository — which is exactly why this raises a question
   * for a person rather than deciding anything.
   */
  it("flags a five-milestone project built in one push", async () => {
    await seedFinishedProject({ commits: 1, milestones: 5 });

    const found = await flagProject(db.pool, projectId);

    expect(found.map((f) => f.type)).toContain("single_commit");
    expect(db.rows("integrity_flags")).toHaveLength(1);
  });

  it("does not flag a project with a commit per milestone", async () => {
    await seedFinishedProject({ commits: 6, milestones: 5 });

    expect(await flagProject(db.pool, projectId)).toEqual([]);
    expect(db.rows("integrity_flags")).toHaveLength(0);
  });

  /** A short brief built in two pushes is not odd, and must not be treated as it. */
  it("does not flag a two-milestone project built in one push", async () => {
    await seedFinishedProject({ commits: 1, milestones: 2 });

    expect(await flagProject(db.pool, projectId)).toEqual([]);
  });

  it("flags an explanation that does not answer", async () => {
    await seedFinishedProject({ commits: 6, milestones: 5, explanationAnswer: "idk" });

    const found = await flagProject(db.pool, projectId);

    expect(found.map((f) => f.type)).toContain("weak_explanation");
  });

  it("accepts a real answer", async () => {
    await seedFinishedProject({
      commits: 6,
      milestones: 5,
      explanationAnswer:
        "The handler trims the value first and returns early when it is empty, so nothing is added.",
    });

    expect(await flagProject(db.pool, projectId)).toEqual([]);
  });

  /**
   * The detection runs on the read that finishes a project, which may be read
   * again. A second row for the same signal would be a second thing for an admin
   * to dismiss about one fact.
   */
  it("raises each signal once however often it runs", async () => {
    await seedFinishedProject({ commits: 1, milestones: 5, explanationAnswer: "no" });

    await flagProject(db.pool, projectId);
    await flagProject(db.pool, projectId);
    await flagProject(db.pool, projectId);

    expect(db.rows("integrity_flags")).toHaveLength(2);
  });

  /** Reopening a decided flag would undo an admin's judgement silently. */
  it("does not reopen a flag an admin has already decided", async () => {
    await seedFinishedProject({ commits: 1, milestones: 5 });
    await flagProject(db.pool, projectId);
    await db.pool.query(
      `update integrity_flags set status = 'cleared', decision_reason = 'Built offline, history checks out'`,
    );

    await flagProject(db.pool, projectId);

    const flags = db.rows("integrity_flags");
    expect(flags).toHaveLength(1);
    expect(flags[0].status).toBe("cleared");
  });
});

describe("a flag changes nothing for the learner", () => {
  /**
   * §6 rule 2 names integrity flags among the things that never reach a learner
   * response. If this ever fails, a learner can find out they are under
   * suspicion from a page that is supposed to be about their project.
   */
  it("is invisible on the capstone screen", async () => {
    await seedFinishedProject({ commits: 1, milestones: 5, explanationAnswer: "no" });
    await flagProject(db.pool, projectId);

    const res = await asLearner("/capstone");

    const body = JSON.stringify(res.body).toLowerCase();
    expect(body).not.toContain("integrity");
    expect(body).not.toContain("single_commit");
    expect(body).not.toContain("flag");
  });

  /** The certificate still stands. Suspicion is not a finding. */
  it("does not stop the Project Certificate being issued", async () => {
    await seedFinishedProject({ commits: 1, milestones: 5, explanationAnswer: "no" });
    await flagProject(db.pool, projectId);

    const res = await asLearner("/certificates");

    expect(res.body.projectCertificate).toEqual({ available: true });
    expect(db.rows("certificates").filter((c) => c.type === "project")).toHaveLength(1);
  });

  it("refuses the admin route to a learner with a 404, not a 403", async () => {
    await seedFinishedProject({ commits: 1, milestones: 5 });
    await flagProject(db.pool, projectId);

    // 403 would confirm the route exists to somebody who should not know it does.
    expect((await asLearner("/admin/integrity")).status).toBe(404);
  });
});

describe("an admin ruling", () => {
  async function flagged(): Promise<string> {
    await seedFinishedProject({ commits: 1, milestones: 5, explanationAnswer: "no" });
    await flagProject(db.pool, projectId);
    return db.rows("integrity_flags")[0].id as string;
  }

  it("lists flags with the project and the learner", async () => {
    await flagged();

    const res = await asAdmin("/admin/integrity");

    expect(res.status).toBe(200);
    expect(res.body.flags.length).toBeGreaterThan(0);
    expect(res.body.flags[0].project.briefTitle).toBe("Task tracker");
    expect(res.body.flags[0].learner.name).toBe("Jan Kevin Gerona");
  });

  /**
   * §5.14: the explanation answer "is saved for admin review if the project is
   * flagged". This is the only endpoint that returns one.
   */
  it("shows the commit history and the explanation answers", async () => {
    const flagId = await flagged();

    const res = await asAdmin(`/admin/integrity/${flagId}`);

    expect(res.body.commits).toHaveLength(1);
    expect(res.body.explanations[0].answer).toBe("no");
    expect(res.body.explanations[0].question).toMatch(/empty task/i);
  });

  it("records the ruling and logs it", async () => {
    const flagId = await flagged();

    const res = await request(app)
      .patch(`/admin/integrity/${flagId}`)
      .set("Cookie", adminCookie)
      .set("Origin", "http://localhost:5173")
      .send({ status: "cleared", reason: "Built offline; the history is consistent." });

    expect(res.status).toBe(200);

    // By id, not by position: a row's place in the table is not stable across
    // an update, and asserting on `[0]` was reading a different flag.
    const flag = db.rows("integrity_flags").find((f) => f.id === flagId)!;
    expect(flag.status).toBe("cleared");
    expect(flag.decision_reason).toMatch(/built offline/i);

    // §6.1 step 5: the ruling and its log entry are one transaction.
    const logged = db.rows("admin_activity_log");
    expect(logged).toHaveLength(1);
    expect(logged[0].action).toBe("integrity.cleared");
  });

  /**
   * §6 rule 10: an admin's correction is a logged override **with a required
   * reason**. The schema says so too — the two say the same thing in two places
   * on purpose.
   */
  it("refuses a ruling with no reason", async () => {
    const flagId = await flagged();

    const res = await request(app)
      .patch(`/admin/integrity/${flagId}`)
      .set("Cookie", adminCookie)
      .set("Origin", "http://localhost:5173")
      .send({ status: "rejected" });

    expect(res.status).toBe(400);
    expect(db.rows("integrity_flags").find((f) => f.id === flagId)!.status).toBe("open");
    expect(db.rows("admin_activity_log")).toHaveLength(0);
  });

  it("refuses a learner's ruling", async () => {
    const flagId = await flagged();

    const res = await request(app)
      .patch(`/admin/integrity/${flagId}`)
      .set("Cookie", learnerCookie)
      .set("Origin", "http://localhost:5173")
      .send({ status: "cleared", reason: "Looks fine to me" });

    expect(res.status).toBe(404);
    expect(db.rows("integrity_flags").find((f) => f.id === flagId)!.status).toBe("open");
  });

  it("refuses a ruling with no session", async () => {
    const flagId = await flagged();
    const res = await request(app)
      .patch(`/admin/integrity/${flagId}`)
      .set("Origin", "http://localhost:5173")
      .send({ status: "cleared", reason: "x" });
    expect(res.status).toBe(401);
  });

  /**
   * §6.6: "Rejecting a project revokes its Project Certificate and notifies the
   * learner with the reason."
   *
   * An earlier version of this endpoint deliberately kept the two apart. That
   * reasoning holds for the other three outcomes and fails for this one — a
   * rejected project with a valid certificate is a state the platform should
   * never be able to reach.
   */
  it("revokes the Project Certificate when the project is rejected", async () => {
    const flagId = await flagged();
    await asLearner("/certificates");
    expect(db.rows("certificates").find((c) => c.type === "project")!.status).toBe("valid");

    await request(app)
      .patch(`/admin/integrity/${flagId}`)
      .set("Cookie", adminCookie)
      .set("Origin", "http://localhost:5173")
      .send({ status: "rejected", reason: "The repository was copied." });

    const certificate = db.rows("certificates").find((c) => c.type === "project")!;
    expect(certificate.status).toBe("revoked");
    expect(certificate.revoked_reason).toMatch(/copied/i);

    // Two things happened to the learner, so two log entries.
    const actions = db.rows("admin_activity_log").map((l) => l.action);
    expect(actions).toContain("integrity.rejected");
    expect(actions).toContain("certificate.revoked");
  });

  /**
   * The other three outcomes leave it standing. The project still stands while
   * the question is open, and withdrawing on suspicion would punish the many
   * learners who simply work in an unusual order.
   */
  it.each(["cleared", "explanation_requested", "redo_requested"])(
    "leaves the certificate valid when the ruling is %s",
    async (status) => {
      const flagId = await flagged();
      await asLearner("/certificates");

      await request(app)
        .patch(`/admin/integrity/${flagId}`)
        .set("Cookie", adminCookie)
        .set("Origin", "http://localhost:5173")
        .send({ status, reason: "Asking the learner about the history." });

      expect(db.rows("certificates").find((c) => c.type === "project")!.status).toBe("valid");
    },
  );
});
