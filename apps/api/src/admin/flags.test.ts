import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../app.js";
import { createTestDb, type TestDb } from "@first-commit/test-db";
import { post } from "../test/http.js";
import type { Mailer } from "../mail/index.js";
import { config } from "../config.js";

const silentMailer: Mailer = { name: "test", async send() {} };

/**
 * **The first admin route, so this is the first test of §6.1 step 5.**
 *
 * `requireAdmin` has existed since the middleware was written and no route used
 * it, which means the role check and `admin_activity_log` were both untested
 * until now. The API fails open — a forgotten check silently serves data — so
 * the role assertions below are the point of this file as much as the feature
 * is.
 */

let db: TestDb;
let app: Express;
let admin: { id: string; cookie: string };
let learner: { id: string; cookie: string };
let flagId: string;
let outputId: string;

/** Planted in the output. An admin *may* see it; a learner never may. */
const RUBRIC = "RUBRIC-ONLY-NOTE";

async function signUp(email: string) {
  const res = await post(app, "/auth/signup").send({
    fullName: `Name of ${email}`,
    email,
    password: "a-good-password",
  });
  const cookie = (res.headers["set-cookie"] as unknown as string[])[0].split(";")[0];
  const id = (
    await db.pool.query<{ id: string }>(`select id from users where email = $1`, [email])
  ).rows[0].id;
  return { id, cookie };
}

const as = (who: { cookie: string }) => ({
  get: (path: string) => request(app).get(path).set("Cookie", who.cookie),
  patch: (path: string) =>
    request(app).patch(path).set("Cookie", who.cookie).set("Origin", config.appOrigin),
});

async function flagOf(userId: string, source = "code_feedback", reason = "It told me nonsense.") {
  const output = (
    await db.pool.query<{ id: string }>(
      `insert into ai_outputs (user_id, source_type, source_id, content)
       values ($1, $2, gen_random_uuid(), $3) returning id`,
      [userId, source, JSON.stringify({ summary: "Start at index 0.", rubric: RUBRIC })],
    )
  ).rows[0].id;
  const flag = (
    await db.pool.query<{ id: string }>(
      `insert into ai_feedback_flags (ai_output_id, user_id, reason)
       values ($1, $2, $3) returning id`,
      [output, userId, reason],
    )
  ).rows[0].id;
  return { output, flag };
}

beforeEach(async () => {
  db = createTestDb();
  app = createApp({ pool: db.pool, mailer: silentMailer });

  learner = await signUp("learner@example.com");
  admin = await signUp("admin@example.com");
  /**
   * §6 rule 8: no endpoint updates `users.role`, so there is no request that
   * could make this account an admin. `npm run db:accounts` is the sanctioned
   * path in development; here it is direct SQL, the same way the first real
   * admin is made.
   */
  await db.pool.query(`update users set role = 'admin' where id = $1`, [admin.id]);

  const made = await flagOf(learner.id);
  flagId = made.flag;
  outputId = made.output;
});

describe("§6.1 step 5 — the role is checked on every admin route", () => {
  const ROUTES: [method: "get" | "patch", path: string][] = [
    ["get", "/admin/flags"],
    ["get", "/admin/flags/FLAG"],
    ["patch", "/admin/flags/FLAG"],
  ];

  const fill = (path: string) => path.replace("FLAG", flagId);
  const ruling = { status: "confirmed_wrong" as const };

  it.each(ROUTES)("%s %s refuses a caller with no session", async (method, path) => {
    const res = await request(app)
      [method](fill(path))
      .set("Origin", config.appOrigin)
      .send(ruling);

    expect(res.status, `${method} ${path} answered ${res.status}`).toBe(401);
  });

  /**
   * **404, not 403.** §4.3 sends a signed-in learner who opens an admin page
   * back to `/app`; the API's job is not to confirm the route exists to
   * somebody who should not know it does.
   */
  it.each(ROUTES)("%s %s answers 404 for a learner", async (method, path) => {
    const res = await as(learner)[method](fill(path)).send(ruling);

    expect(res.status, `${method} ${path} answered ${res.status}`).toBe(404);
  });

  it("changes nothing when a learner tries to rule on a flag", async () => {
    await as(learner).patch(`/admin/flags/${flagId}`).send({ status: "confirmed_correct" });

    const row = db.rows("ai_feedback_flags")[0];
    expect(row.status).toBe("open");
    expect(row.reviewed_by).toBeNull();
    expect(db.rows("admin_activity_log")).toHaveLength(0);
  });

  /** §6.1 step 2: a suspended account is rejected before anything else. */
  it("refuses a suspended admin", async () => {
    await db.pool.query(`update users set status = 'suspended' where id = $1`, [admin.id]);

    const res = await as(admin).get("/admin/flags");

    expect(res.status).toBe(403);
  });
});

describe("GET /admin/flags — §6.8's list", () => {
  it("serves every learner's flags, which is the point of the screen", async () => {
    const other = await signUp("other@example.com");
    await flagOf(other.id, "roadmap_generation", "Wrong track for me.");

    const res = await as(admin).get("/admin/flags");

    expect(res.status).toBe(200);
    expect(res.body.flags).toHaveLength(2);
    expect(res.body.flags.map((f: { learner: { fullName: string } }) => f.learner.fullName)).toEqual(
      expect.arrayContaining(["Name of learner@example.com", "Name of other@example.com"]),
    );
  });

  it("carries the learner's reason and the AI output beside it", async () => {
    const [flag] = (await as(admin).get("/admin/flags")).body.flags;

    expect(flag.reason).toBe("It told me nonsense.");
    expect(flag.source).toBe("code_feedback");
    expect(flag.output.summary).toBe("Start at index 0.");
  });

  /**
   * §6 rule 2 keeps a rubric from *learners*. Judging the model means seeing
   * all of its output, so an admin response carries it — and that difference
   * is the reason this screen is admin-only.
   */
  it("includes the parts a learner never receives", async () => {
    const res = await as(admin).get("/admin/flags");
    expect(JSON.stringify(res.body)).toContain(RUBRIC);
  });

  it("puts open flags first", async () => {
    const older = await flagOf(learner.id, "resume_generation", "Invented a job.");
    await db.pool.query(`update ai_feedback_flags set status = 'confirmed_correct' where id = $1`, [
      flagId,
    ]);

    const { flags } = (await as(admin).get("/admin/flags")).body;
    expect(flags[0].id).toBe(older.flag);
    expect(flags[0].status).toBe("open");
  });

  it("filters by source", async () => {
    await flagOf(learner.id, "roadmap_generation", "Wrong track.");

    const res = await as(admin).get("/admin/flags?source=roadmap_generation");

    expect(res.body.flags).toHaveLength(1);
    expect(res.body.flags[0].source).toBe("roadmap_generation");
  });

  it("filters by status", async () => {
    await flagOf(learner.id, "code_feedback", "Also wrong.");
    await db.pool.query(`update ai_feedback_flags set status = 'confirmed_wrong' where id = $1`, [
      flagId,
    ]);

    const res = await as(admin).get("/admin/flags?status=confirmed_wrong");

    expect(res.body.flags).toHaveLength(1);
    expect(res.body.flags[0].id).toBe(flagId);
  });

  it.each(["not-a-source", "users"])("refuses %s as a source", async (source) => {
    expect((await as(admin).get(`/admin/flags?source=${source}`)).status).toBe(400);
  });

  /** §6.9's "share of flags confirmed as wrong" reads these. */
  it("counts flags by status across all of them, not just the filtered page", async () => {
    await flagOf(learner.id, "code_feedback", "Second one.");
    await db.pool.query(`update ai_feedback_flags set status = 'confirmed_wrong' where id = $1`, [
      flagId,
    ]);

    const res = await as(admin).get("/admin/flags?status=open");

    expect(res.body.flags).toHaveLength(1);
    expect(res.body.counts).toEqual({ open: 1, confirmed_wrong: 1 });
  });
});

describe("PATCH /admin/flags/:id — §6.8's ruling", () => {
  it("records the ruling, the notes, and who made it", async () => {
    const res = await as(admin)
      .patch(`/admin/flags/${flagId}`)
      .send({ status: "confirmed_wrong", notes: "The hint pointed at the wrong line." });

    expect(res.status).toBe(200);
    expect(res.body.flag.status).toBe("confirmed_wrong");
    expect(res.body.flag.reviewedBy).toBe("Name of admin@example.com");

    const row = db.rows("ai_feedback_flags")[0];
    expect(row.status).toBe("confirmed_wrong");
    expect(row.admin_notes).toBe("The hint pointed at the wrong line.");
    expect(row.reviewed_by).toBe(admin.id);
    expect(row.reviewed_at).not.toBeNull();
  });

  /**
   * §6.1 step 5, and the half that is easiest to forget: the check without the
   * log leaves a decision nobody can account for.
   */
  it("writes an admin_activity_log row naming the action and the target", async () => {
    await as(admin)
      .patch(`/admin/flags/${flagId}`)
      .send({ status: "confirmed_wrong", notes: "Wrong line." });

    const log = db.rows("admin_activity_log");
    expect(log).toHaveLength(1);
    expect(log[0].admin_id).toBe(admin.id);
    expect(log[0].action).toBe("ai_flag.confirmed_wrong");
    expect(log[0].target_type).toBe("ai_feedback_flag");
    expect(log[0].target_id).toBe(flagId);
    expect(log[0].reason).toBe("Wrong line.");
    expect((log[0].details as { learnerId: string }).learnerId).toBe(learner.id);
    expect((log[0].details as { aiOutputId: string }).aiOutputId).toBe(outputId);
  });

  /** "The feedback was fine" is a decision too — it closes a learner's complaint. */
  it("logs a ruling that the feedback was correct", async () => {
    await as(admin).patch(`/admin/flags/${flagId}`).send({ status: "confirmed_correct" });

    expect(db.rows("admin_activity_log")[0].action).toBe("ai_flag.confirmed_correct");
  });

  /**
   * §6 rule 10: admins cannot mark modules passed or edit scores. A flag is a
   * judgement about the model, so ruling on one must move no evidence at all.
   */
  it("touches no evidence", async () => {
    await as(admin).patch(`/admin/flags/${flagId}`).send({ status: "confirmed_wrong" });

    expect(db.rows("module_completions")).toHaveLength(0);
    expect(db.rows("assessment_attempts")).toHaveLength(0);
    expect(db.rows("code_submissions")).toHaveLength(0);
    // And the output itself is evidence of what the model said. It stands.
    expect(db.rows("ai_outputs")).toHaveLength(1);
    expect(JSON.stringify(db.rows("ai_outputs")[0].content)).toContain("Start at index 0.");
  });

  it("refuses to reopen a ruling", async () => {
    await as(admin).patch(`/admin/flags/${flagId}`).send({ status: "confirmed_wrong" });

    const res = await as(admin).patch(`/admin/flags/${flagId}`).send({ status: "open" });

    expect(res.status).toBe(400);
    expect(db.rows("ai_feedback_flags")[0].status).toBe("confirmed_wrong");
  });

  it.each(["reason", "reviewedBy", "userId", "aiOutputId"])(
    "refuses a body carrying %s",
    async (field) => {
      const res = await as(admin)
        .patch(`/admin/flags/${flagId}`)
        .send({ status: "confirmed_wrong", [field]: "meddling" });

      expect(res.status).toBe(400);
      expect(db.rows("ai_feedback_flags")[0].status).toBe("open");
      expect(db.rows("admin_activity_log")).toHaveLength(0);
    },
  );

  it("does not overwrite the learner's own reason", async () => {
    await as(admin)
      .patch(`/admin/flags/${flagId}`)
      .send({ status: "confirmed_wrong", notes: "Admin's words." });

    expect(db.rows("ai_feedback_flags")[0].reason).toBe("It told me nonsense.");
  });

  it("answers 404 for a flag that does not exist", async () => {
    const res = await as(admin)
      .patch("/admin/flags/00000000-0000-0000-0000-000000000000")
      .send({ status: "confirmed_wrong" });

    expect(res.status).toBe(404);
    expect(db.rows("admin_activity_log")).toHaveLength(0);
  });

  it("answers 404 for a malformed id rather than failing on the cast", async () => {
    const res = await as(admin).patch("/admin/flags/not-a-uuid").send({ status: "confirmed_wrong" });
    expect(res.status).toBe(404);
  });
});

describe("GET /admin/flags/:id — §6.8's detail view", () => {
  it("serves one flag with its output and its learner", async () => {
    const res = await as(admin).get(`/admin/flags/${flagId}`);

    expect(res.status).toBe(200);
    expect(res.body.flag.id).toBe(flagId);
    expect(res.body.flag.learner.fullName).toBe("Name of learner@example.com");
    expect(res.body.flag.reason).toBe("It told me nonsense.");
  });

  it("answers 404 for a flag that does not exist", async () => {
    expect(
      (await as(admin).get("/admin/flags/00000000-0000-0000-0000-000000000000")).status,
    ).toBe(404);
  });
});
