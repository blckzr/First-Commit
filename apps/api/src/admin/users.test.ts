import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { readFileSync } from "node:fs";
import { createApp } from "../app.js";
import { createTestDb, type TestDb } from "@first-commit/test-db";
import { post, patch } from "../test/http.js";
import type { Mailer } from "../mail/index.js";

const silentMailer: Mailer = { name: "test", async send() {} };

/**
 * Account administration (design.md §6.10).
 *
 * Three things are asserted, in descending order of how badly they would hurt:
 *
 * 1. **No endpoint makes an admin.** §6 rule 8. §6.10 asked for an invite flow
 *    and it was deliberately not built; this suite checks both that no request
 *    body can set `role` and that the string `set role` does not appear in the
 *    module. The second looks paranoid and is not: the first only covers the
 *    bodies a test thought to send.
 * 2. **Nothing here writes evidence.** §6.10's own sentence: "No action on this
 *    page can mark modules as passed or change scores." Row counts across a
 *    suspension prove it rather than a reading of the code.
 * 3. **The admin surface cannot be locked shut.** No endpoint can make a new
 *    admin, so suspending the last active one is unrecoverable without SQL
 *    against production.
 */

let db: TestDb;
let app: Express;
let adminCookie: string;
let learnerCookie: string;
let adminId: string;
let learnerId: string;

const one = async (sql: string, params: unknown[] = []) =>
  (await db.pool.query<{ id: string }>(sql, params)).rows[0].id;

const setStatus = (userId: string, body: unknown, cookie = adminCookie) =>
  patch(app, `/admin/users/${userId}/status`).set("Cookie", cookie).send(body);

const list = (query = "") =>
  request(app).get(`/admin/users${query}`).set("Cookie", adminCookie);

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
  adminId = (
    await db.pool.query<{ id: string }>(`select id from users where email = 'admin@example.com'`)
  ).rows[0].id;

  // A second admin, so suspending the first is not the last-admin case.
  await db.pool.query(
    `insert into users (email, password_hash, full_name, role)
     values ('admin2@example.com', 'x', 'Second Admin', 'admin')`,
  );
});

describe("§6 rule 8 — no endpoint updates users.role", () => {
  it("ignores a role in the status body", async () => {
    const res = await setStatus(learnerId, {
      status: "suspended",
      reason: "Spamming",
      role: "admin",
    });

    /** `.strict()` refuses the body outright rather than dropping the field. */
    expect(res.status).toBe(400);
    expect(db.rows("users").find((u) => u.id === learnerId)!.role).toBe("learner");
  });

  /**
   * **The source is checked, not only the behaviour.**
   *
   * A body-level test covers the bodies someone thought to send. This covers
   * the whole file, including an endpoint a future task adds — which is the
   * failure §6 rule 8 actually guards against, since nothing in the schema
   * stops a `role` write today (open question 7 proposes the trigger that
   * would).
   *
   * **Comments are stripped first.** The first version of this test failed on
   * `users.ts`'s own documentation, which quotes the statement it promises not
   * to contain. A test that cannot tell code from prose would either be
   * deleted or answered by rewording a comment, and neither makes the rule
   * safer.
   */
  it("does not write users.role anywhere in the module", () => {
    const code = readFileSync(new URL("./users.ts", import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*/g, "");

    expect(code).not.toMatch(/set\s+role/i);
    expect(code).not.toMatch(/update\s+users\s+set[^;]*role/is);
  });

  it("has no invite endpoint", async () => {
    const res = await post(app, "/admin/users")
      .set("Cookie", adminCookie)
      .send({ email: "new@example.com", role: "admin" });

    expect(res.status).toBe(404);
  });
});

describe("§6.10 — no action marks a module passed or changes a score", () => {
  /**
   * Counted, not read. §6.10 says it in one sentence; this is the sentence as a
   * test, over the four tables that hold evidence.
   */
  it("writes no evidence when suspending an account", async () => {
    const skillId = await one(`insert into skills (slug, name) values ('js','JS') returning id`);
    const moduleId = await one(
      `insert into modules (skill_id, kind, slug, status)
       values ($1,'core','js-basics','published') returning id`,
      [skillId],
    );
    const versionId = await one(
      `insert into module_versions (module_id, version_no, title, status)
       values ($1,1,'JavaScript basics','published') returning id`,
      [moduleId],
    );
    const assessmentId = await one(
      `insert into assessments (module_version_id, type, title, passing_score)
       values ($1,'quiz','Check',70) returning id`,
      [versionId],
    );
    await db.pool.query(
      `insert into assessment_attempts (user_id, assessment_id, attempt_no, score, passed)
       values ($1,$2,1,40,false)`,
      [learnerId, assessmentId],
    );

    const before = {
      completions: db.rows("module_completions").length,
      attempts: JSON.stringify(db.rows("assessment_attempts")),
      certificates: db.rows("certificates").length,
      milestones: db.rows("milestone_attempts").length,
    };

    expect((await setStatus(learnerId, { status: "suspended", reason: "Spamming" })).status).toBe(
      200,
    );

    expect(db.rows("module_completions")).toHaveLength(before.completions);
    expect(JSON.stringify(db.rows("assessment_attempts"))).toBe(before.attempts);
    expect(db.rows("certificates")).toHaveLength(before.certificates);
    expect(db.rows("milestone_attempts")).toHaveLength(before.milestones);
  });
});

describe("suspending and reactivating", () => {
  it("suspends with a reason and logs it in the same transaction", async () => {
    const res = await setStatus(learnerId, { status: "suspended", reason: "Shared answers" });

    expect(res.status).toBe(200);
    expect(db.rows("users").find((u) => u.id === learnerId)!.status).toBe("suspended");

    const entry = db.rows("admin_activity_log")[0];
    expect(entry.action).toBe("account.suspended");
    expect(entry.target_type).toBe("user");
    expect(entry.target_id).toBe(learnerId);
    expect(entry.reason).toBe("Shared answers");
  });

  /**
   * §6.10 says "with a reason" and means both directions. Letting someone back
   * in is as much a decision as locking them out, and §6.12 promises a record
   * of what was decided *and why*.
   */
  it("needs a reason to reactivate, not only to suspend", async () => {
    await setStatus(learnerId, { status: "suspended", reason: "Shared answers" });

    const res = await setStatus(learnerId, { status: "active" });

    expect(res.status).toBe(400);
    expect(db.rows("users").find((u) => u.id === learnerId)!.status).toBe("suspended");
  });

  it("reactivates with a reason", async () => {
    await setStatus(learnerId, { status: "suspended", reason: "Shared answers" });

    const res = await setStatus(learnerId, { status: "active", reason: "Explained themselves" });

    expect(res.status).toBe(200);
    expect(db.rows("users").find((u) => u.id === learnerId)!.status).toBe("active");
    expect(db.rows("admin_activity_log").map((l) => l.action)).toContain("account.reactivated");
  });

  /**
   * **A suspension ends the account's sessions.** §6.1 step 2 is what enforces
   * the lock-out on every request; this is `sessions` not holding live rows for
   * an account that cannot use them.
   */
  it("ends the suspended account's sessions", async () => {
    expect(db.rows("sessions").filter((s) => s.user_id === learnerId).length).toBeGreaterThan(0);

    await setStatus(learnerId, { status: "suspended", reason: "Shared answers" });

    expect(db.rows("sessions").filter((s) => s.user_id === learnerId)).toHaveLength(0);
  });

  /** And the suspension actually bites: §6.1 step 2, from the learner's side. */
  it("locks the suspended learner out", async () => {
    await setStatus(learnerId, { status: "suspended", reason: "Shared answers" });

    const res = await request(app).get("/auth/me").set("Cookie", learnerCookie);

    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  /**
   * **No log row for a change that did not happen.** The log is append-only, so
   * a suspension recorded against an already-suspended account could never be
   * taken back out.
   */
  it("records nothing when the account is already in that state", async () => {
    await setStatus(learnerId, { status: "suspended", reason: "Shared answers" });
    const entries = db.rows("admin_activity_log").length;

    const res = await setStatus(learnerId, { status: "suspended", reason: "Again" });

    expect(res.status).toBe(200);
    expect(res.body.changed).toBe(false);
    expect(db.rows("admin_activity_log")).toHaveLength(entries);
  });

  it("refuses a suspension with no reason", async () => {
    const res = await setStatus(learnerId, { status: "suspended" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/why/i);
  });

  it("answers 404 to a learner", async () => {
    const res = await setStatus(adminId, { status: "suspended", reason: "no" }, learnerCookie);

    expect(res.status).toBe(404);
    expect(db.rows("users").find((u) => u.id === adminId)!.status).toBe("active");
  });
});

describe("the admin surface cannot be locked shut", () => {
  /**
   * **This one refusal is the whole guard**, and the reasoning is worth keeping
   * beside the test.
   *
   * There is deliberately no separate "last active admin" check. The caller is
   * always an active admin — `requireAdmin` saw the role, §6.1 step 2 rejected
   * a suspended account — so for any target but the caller, at least one
   * active admin remains afterwards. A count of other active admins can never
   * reach zero here, so a guard on it would be a branch no test could reach.
   * Refusing self-suspension is what actually keeps anyone in the admin area,
   * given §6 rule 8 means no endpoint can make a new admin.
   */
  it("refuses to suspend your own account", async () => {
    const res = await setStatus(adminId, { status: "suspended", reason: "Testing" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/your own account/i);
    expect(db.rows("users").find((u) => u.id === adminId)!.status).toBe("active");
  });

  /** And the reason is in the message, not only in a comment. */
  it("says why, naming the thing that cannot be undone", async () => {
    const res = await setStatus(adminId, { status: "suspended", reason: "Testing" });

    expect(res.body.error).toMatch(/no endpoint can make a new admin/i);
  });

  /**
   * Suspending *another* admin is allowed. It has to be — §6.10 asks for it,
   * and an admin who leaves the team should lose access.
   */
  it("allows suspending another admin", async () => {
    const second = db.rows("users").find((u) => u.email === "admin2@example.com")!;

    const res = await setStatus(second.id as string, {
      status: "suspended",
      reason: "Left the team",
    });

    expect(res.status).toBe(200);
    expect(db.rows("users").find((u) => u.id === second.id)!.status).toBe("suspended");
  });

  /**
   * The caller remains, which is the invariant the self-refusal protects: after
   * suspending every other admin, there is still exactly one way in.
   */
  it("leaves at least one active admin however many are suspended", async () => {
    const second = db.rows("users").find((u) => u.email === "admin2@example.com")!;
    await setStatus(second.id as string, { status: "suspended", reason: "Left" });
    await setStatus(adminId, { status: "suspended", reason: "Trying anyway" });

    const active = db
      .rows("users")
      .filter((u) => u.role === "admin" && u.status === "active");
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe(adminId);
  });
});

describe("the list", () => {
  it("never returns a password hash", async () => {
    const res = await list();

    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toMatch(/password/i);
  });

  it("searches by name and by email", async () => {
    expect((await list("?q=Learner")).body.users).toHaveLength(1);
    expect((await list("?q=admin2@example.com")).body.users).toHaveLength(1);
    expect((await list("?q=nobody")).body.users).toHaveLength(0);
  });

  it("filters by role and by status", async () => {
    const learners = await list("?role=learner");
    expect(learners.body.users.map((u: { email: string }) => u.email)).toEqual([
      "learner@example.com",
    ]);

    await setStatus(learnerId, { status: "suspended", reason: "Spamming" });
    expect((await list("?status=suspended")).body.users).toHaveLength(1);
  });

  it("refuses a role that is not one of the two", async () => {
    expect((await list("?role=superuser")).status).toBe(400);
  });

  /** The screen needs it to explain the refusal before an admin meets it. */
  it("reports how many admins can still get in", async () => {
    expect((await list()).body.activeAdmins).toBe(2);

    const second = db.rows("users").find((u) => u.email === "admin2@example.com")!;
    await setStatus(second.id as string, { status: "suspended", reason: "Left" });

    expect((await list()).body.activeAdmins).toBe(1);
  });
});

describe("one learner's record", () => {
  it("shows roadmaps, completions, projects and certificates", async () => {
    const pathId = await one(
      `insert into career_paths (slug, title, status) values ('jwd','JWD','published') returning id`,
    );
    const roadmapId = await one(
      `insert into roadmaps (user_id, career_path_id, status) values ($1,$2,'active') returning id`,
      [learnerId, pathId],
    );
    const skillId = await one(`insert into skills (slug, name) values ('js','JS') returning id`);
    const moduleId = await one(
      `insert into modules (skill_id, kind, slug, status)
       values ($1,'core','js-basics','published') returning id`,
      [skillId],
    );
    const versionId = await one(
      `insert into module_versions (module_id, version_no, title, status)
       values ($1,1,'JavaScript basics','published') returning id`,
      [moduleId],
    );
    await db.pool.query(
      `insert into module_completions (user_id, module_id, module_version_id, method, score)
       values ($1,$2,$3,'passed',88)`,
      [learnerId, moduleId, versionId],
    );
    await db.pool.query(
      `insert into certificates (public_code, user_id, type, roadmap_id, recipient_name, title)
       values ('FC-7K2M-94QX',$1,'completion',$2,'A Learner','Junior Web Developer')`,
      [learnerId, roadmapId],
    );

    const res = await request(app).get(`/admin/users/${learnerId}`).set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    expect(res.body.user.fullName).toBe("A Learner");
    expect(res.body.roadmaps[0].pathTitle).toBe("JWD");
    expect(res.body.completions.passed).toBe(1);
    expect(res.body.certificates[0].publicCode).toBe("FC-7K2M-94QX");
  });

  /**
   * **Completions are split by method.** §6 rule 10 makes an `override` an
   * admin's correction rather than the learner's work, so one total would let a
   * corrected record read as a clean one.
   */
  it("separates an override from work the learner did", async () => {
    const skillId = await one(`insert into skills (slug, name) values ('js','JS') returning id`);
    const modules = await Promise.all(
      ["a", "b"].map(async (slug) => {
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
        return { moduleId, versionId };
      }),
    );
    await db.pool.query(
      `insert into module_completions (user_id, module_id, module_version_id, method, score)
       values ($1,$2,$3,'passed',88)`,
      [learnerId, modules[0].moduleId, modules[0].versionId],
    );
    await db.pool.query(
      `insert into module_completions (user_id, module_id, module_version_id, method, override_reason)
       values ($1,$2,$3,'override','Grading error')`,
      [learnerId, modules[1].moduleId, modules[1].versionId],
    );

    const res = await request(app).get(`/admin/users/${learnerId}`).set("Cookie", adminCookie);

    expect(res.body.completions).toEqual({ passed: 1, override: 1 });
  });

  /**
   * **Why an account is suspended is read back out of the append-only log.**
   * `users.status` holds the current state and no reason, so without this the
   * question has no answer at the point of decision.
   */
  it("shows why the account was suspended, from the log", async () => {
    await setStatus(learnerId, { status: "suspended", reason: "Shared answers" });

    const res = await request(app).get(`/admin/users/${learnerId}`).set("Cookie", adminCookie);

    expect(res.body.statusHistory[0]).toMatchObject({
      action: "account.suspended",
      reason: "Shared answers",
      by: "An Admin",
    });
  });

  it("never returns a password hash", async () => {
    const res = await request(app).get(`/admin/users/${learnerId}`).set("Cookie", adminCookie);

    expect(JSON.stringify(res.body)).not.toMatch(/password/i);
  });

  it("answers 404 to a learner", async () => {
    const res = await request(app).get(`/admin/users/${adminId}`).set("Cookie", learnerCookie);

    expect(res.status).toBe(404);
  });
});
