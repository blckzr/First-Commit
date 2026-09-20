import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../app.js";
import { createTestDb, type TestDb } from "../test/db.js";
import type { Mailer, MailMessage } from "../mail/index.js";
import { verifyPassword } from "./passwords.js";
import { hashToken } from "./tokens.js";
import { SESSION_COOKIE } from "./sessions.js";

function recordingMailer(): Mailer & { sent: MailMessage[]; fail: boolean } {
  const sent: MailMessage[] = [];
  return {
    name: "test",
    sent,
    fail: false,
    async send(message) {
      if (this.fail) throw new Error("provider is down");
      sent.push(message);
    },
  };
}

let db: TestDb;
let mailer: ReturnType<typeof recordingMailer>;
let app: Express;

const VALID = {
  fullName: "Jan Kevin Gerona",
  email: "learner@example.com",
  password: "a-good-password",
};

beforeEach(() => {
  db = createTestDb();
  mailer = recordingMailer();
  app = createApp({ pool: db.pool, mailer });
});

describe("POST /auth/signup", () => {
  it("creates the account, its learner profile, and a session", async () => {
    const res = await request(app).post("/auth/signup").send(VALID);

    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({
      fullName: VALID.fullName,
      email: VALID.email,
      role: "learner",
      emailVerified: false,
    });
    // design.md §5.2: on success the learner lands on the first onboarding page.
    expect(res.body.next).toBe("/onboarding/about");

    expect(db.rows("users")).toHaveLength(1);
    expect(db.rows("learner_profiles")).toHaveLength(1);
    expect(db.rows("sessions")).toHaveLength(1);
  });

  it("sets an httpOnly session cookie", async () => {
    const res = await request(app).post("/auth/signup").send(VALID);
    const cookie = (res.headers["set-cookie"] as unknown as string[])[0];
    expect(cookie).toContain(`${SESSION_COOKIE}=`);
    expect(cookie).toMatch(/HttpOnly/i);
  });

  /** §6.3: the database stores only a hash, so a copy cannot be replayed. */
  it("stores the session token only as a hash", async () => {
    const res = await request(app).post("/auth/signup").send(VALID);
    const cookie = (res.headers["set-cookie"] as unknown as string[])[0];
    const token = /fc_session=([^;]+)/.exec(cookie)![1];

    const stored = db.rows("sessions")[0].token_hash as string;
    expect(stored).not.toBe(token);
    expect(stored).toBe(hashToken(token));
  });

  /** §6.3: argon2id, and the password itself is never stored. */
  it("stores the password only as an argon2id hash", async () => {
    await request(app).post("/auth/signup").send(VALID);
    const hash = db.rows("users")[0].password_hash as string;

    expect(hash).not.toContain(VALID.password);
    expect(hash.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword(hash, VALID.password)).toBe(true);
    expect(await verifyPassword(hash, "not-the-password")).toBe(false);
  });

  it("never returns the password hash", async () => {
    const res = await request(app).post("/auth/signup").send(VALID);
    expect(JSON.stringify(res.body)).not.toMatch(/argon2|password_hash|passwordHash/i);
  });

  it("issues a hashed, expiring verification token and mails the link", async () => {
    await request(app).post("/auth/signup").send(VALID);

    expect(mailer.sent).toHaveLength(1);
    const link = /https?:\/\/\S+/.exec(mailer.sent[0].text)![0];
    const token = new URL(link).searchParams.get("token")!;

    const row = db.rows("email_verification_tokens")[0];
    expect(row.token_hash).toBe(hashToken(token));
    expect(row.token_hash).not.toBe(token);
    expect(row.used_at).toBeNull();
    expect(new Date(row.expires_at as string).getTime()).toBeGreaterThan(Date.now());
  });

  /**
   * AGENT.md §6 rule 8 and the sign-up doc comment: the browser cannot choose
   * its own role. This is the test that would catch a privilege escalation.
   */
  it("ignores a role or status sent by the browser", async () => {
    await request(app)
      .post("/auth/signup")
      .send({ ...VALID, role: "admin", status: "suspended", id: "00000000-0000-0000-0000-000000000000" });

    const user = db.rows("users")[0];
    expect(user.role).toBe("learner");
    expect(user.status).toBe("active");
    expect(user.id).not.toBe("00000000-0000-0000-0000-000000000000");
  });

  it("rejects a duplicate email, case-insensitively, without creating anything", async () => {
    await request(app).post("/auth/signup").send(VALID);

    const res = await request(app)
      .post("/auth/signup")
      .send({ ...VALID, email: "LEARNER@EXAMPLE.COM", fullName: "Someone Else" });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already registered/i);
    expect(db.rows("users")).toHaveLength(1);
    expect(db.rows("learner_profiles")).toHaveLength(1);
  });

  it.each([
    [{ ...VALID, email: "not-an-email" }, /email address/i],
    [{ ...VALID, password: "short" }, /8 characters/i],
    [{ ...VALID, fullName: "  " }, /name/i],
    [{}, /./],
  ])("rejects invalid input with a message that explains", async (body, expected) => {
    const res = await request(app).post("/auth/signup").send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(expected);
    // design.md §9: errors explain and direct, never "Invalid input".
    expect(res.body.error).not.toMatch(/^invalid input$/i);
  });

  /**
   * The account exists either way and the learner can ask for another link, so
   * a provider outage must not fail the request or leave a half-made account.
   */
  it("still succeeds when the mail provider is down", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mailer.fail = true;

    const res = await request(app).post("/auth/signup").send(VALID);

    expect(res.status).toBe(201);
    expect(db.rows("users")).toHaveLength(1);
    expect(db.rows("sessions")).toHaveLength(1);
  });
});
