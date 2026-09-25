import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../app.js";
import { createTestDb, type TestDb } from "@first-commit/test-db";
import { post } from "../test/http.js";
import type { Mailer } from "../mail/index.js";
import { config } from "../config.js";

const silentMailer: Mailer = { name: "test", async send() {} };

let db: TestDb;
let app: Express;
let cookie: string;
let learnerId: string;
let outputId: string;

const send = (path: string) =>
  request(app).post(path).set("Cookie", cookie).set("Origin", config.appOrigin);

const newUser = async (email: string) =>
  (
    await db.pool.query<{ id: string }>(
      `insert into users (email, password_hash, full_name) values ($1,'h','Other') returning id`,
      [email],
    )
  ).rows[0].id;

const newOutput = async (userId: string) =>
  (
    await db.pool.query<{ id: string }>(
      `insert into ai_outputs (user_id, source_type, source_id, content)
       values ($1,'roadmap_generation', gen_random_uuid(), '{"explanation":"because"}')
       returning id`,
      [userId],
    )
  ).rows[0].id;

beforeEach(async () => {
  db = createTestDb();
  app = createApp({ pool: db.pool, mailer: silentMailer });

  const signUp = await post(app, "/auth/signup").send({
    fullName: "Jan Kevin Gerona",
    email: "learner@example.com",
    password: "a-good-password",
  });
  cookie = (signUp.headers["set-cookie"] as unknown as string[])[0].split(";")[0];
  learnerId = (
    await db.pool.query<{ id: string }>(`select id from users where email = 'learner@example.com'`)
  ).rows[0].id;

  outputId = await newOutput(learnerId);
});

describe("POST /ai-outputs/:id/flags", () => {
  it("records the flag against the learner's own output", async () => {
    const res = await send(`/ai-outputs/${outputId}/flags`).send({
      reason: "I already know React, it put me on the Vue track.",
    });

    expect(res.status).toBe(201);
    expect(res.body.flag.status).toBe("open");

    const row = db.rows("ai_feedback_flags")[0];
    expect(row.user_id).toBe(learnerId);
    expect(row.ai_output_id).toBe(outputId);
    expect(row.reason).toContain("already know React");
    // The admin's half of the row is theirs to fill in.
    expect(row.reviewed_by).toBeNull();
    expect(row.reviewed_at).toBeNull();
  });

  /** §6.1 step 4, and 404 rather than 403 so the id is not confirmed. */
  it("answers 404 for another learner's output", async () => {
    const theirs = await newOutput(await newUser("other@example.com"));

    const res = await send(`/ai-outputs/${theirs}/flags`).send({ reason: "wrong" });

    expect(res.status).toBe(404);
    expect(db.rows("ai_feedback_flags")).toHaveLength(0);
  });

  it("answers 404 for an output that does not exist", async () => {
    const res = await send(
      `/ai-outputs/00000000-0000-0000-0000-000000000000/flags`,
    ).send({ reason: "wrong" });
    expect(res.status).toBe(404);
  });

  it("answers 404 for a malformed id rather than failing on the cast", async () => {
    expect((await send("/ai-outputs/not-a-uuid/flags").send({ reason: "x" })).status).toBe(404);
  });

  it("refuses an empty reason", async () => {
    const res = await send(`/ai-outputs/${outputId}/flags`).send({ reason: "   " });
    expect(res.status).toBe(400);
    expect(db.rows("ai_feedback_flags")).toHaveLength(0);
  });

  /**
   * §6 rule 10 in spirit: judging a flag is the admin's, and a logged one. A
   * body carrying `status` must not be able to skip that.
   */
  it.each(["status", "reviewedBy", "adminNotes", "userId"])(
    "refuses a body carrying %s",
    async (field) => {
      const res = await send(`/ai-outputs/${outputId}/flags`).send({
        reason: "wrong",
        [field]: field === "status" ? "confirmed_wrong" : "x",
      });

      expect(res.status).toBe(400);
      expect(db.rows("ai_feedback_flags")).toHaveLength(0);
    },
  );

  it("rewrites the reason rather than failing when flagged twice", async () => {
    await send(`/ai-outputs/${outputId}/flags`).send({ reason: "first go" });
    const res = await send(`/ai-outputs/${outputId}/flags`).send({ reason: "said better" });

    expect(res.status).toBe(200);
    const rows = db.rows("ai_feedback_flags");
    expect(rows).toHaveLength(1);
    expect(rows[0].reason).toBe("said better");
  });

  /** A reviewed flag keeps the admin's verdict; re-flagging does not reopen it. */
  it("leaves a reviewed flag alone", async () => {
    await send(`/ai-outputs/${outputId}/flags`).send({ reason: "first go" });
    await db.pool.query(
      `update ai_feedback_flags
          set status = 'confirmed_correct', admin_notes = 'checked, it is right'`,
    );

    const res = await send(`/ai-outputs/${outputId}/flags`).send({ reason: "still wrong" });

    expect(res.status).toBe(200);
    expect(res.body.flag.status).toBe("confirmed_correct");
    const row = db.rows("ai_feedback_flags")[0];
    expect(row.reason).toBe("first go");
    expect(row.admin_notes).toBe("checked, it is right");
  });

  it("tells a learner nothing about the admin's review", async () => {
    await send(`/ai-outputs/${outputId}/flags`).send({ reason: "first go" });
    await db.pool.query(
      `update ai_feedback_flags set status = 'confirmed_wrong', admin_notes = 'ADMIN-ONLY-NOTE'`,
    );

    const res = await send(`/ai-outputs/${outputId}/flags`).send({ reason: "again" });
    expect(JSON.stringify(res.body)).not.toContain("ADMIN-ONLY-NOTE");
  });

  it("requires a session", async () => {
    const res = await request(app)
      .post(`/ai-outputs/${outputId}/flags`)
      .set("Origin", config.appOrigin)
      .send({ reason: "wrong" });

    expect(res.status).toBe(401);
    expect(db.rows("ai_feedback_flags")).toHaveLength(0);
  });
});
