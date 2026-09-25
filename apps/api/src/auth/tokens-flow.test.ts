import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Express } from "express";
import { createApp } from "../app.js";
import { createTestDb, type TestDb } from "@first-commit/test-db";
import { post } from "../test/http.js";
import type { Mailer, MailMessage } from "../mail/index.js";
import { hashToken } from "./tokens.js";
import { verifyPassword } from "./passwords.js";

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

const ACCOUNT = {
  fullName: "Jan Kevin Gerona",
  email: "learner@example.com",
  password: "a-good-password",
};

/** The token out of the most recent email. */
function lastToken(): string {
  const link = /https?:\/\/\S+/.exec(mailer.sent.at(-1)!.text)![0];
  return new URL(link).searchParams.get("token")!;
}

async function signUp(): Promise<{ cookie: string; token: string }> {
  const res = await post(app, "/auth/signup").send(ACCOUNT);
  return {
    cookie: (res.headers["set-cookie"] as unknown as string[])[0].split(";")[0],
    token: lastToken(),
  };
}

beforeEach(() => {
  db = createTestDb();
  mailer = recordingMailer();
  app = createApp({ pool: db.pool, mailer });
});

describe("POST /auth/verify-email", () => {
  it("confirms the address and marks the token used", async () => {
    const { token } = await signUp();
    expect(db.rows("users")[0].email_verified_at).toBeNull();

    const res = await post(app, "/auth/verify-email").send({ token });

    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(true);
    expect(db.rows("users")[0].email_verified_at).not.toBeNull();
    expect(db.rows("email_verification_tokens")[0].used_at).not.toBeNull();
  });

  /** §6.3: single use. The second attempt must fail, not be idempotent. */
  it("refuses the same link twice", async () => {
    const { token } = await signUp();
    await post(app, "/auth/verify-email").send({ token });

    const second = await post(app, "/auth/verify-email").send({ token });
    expect(second.status).toBe(400);
    expect(second.body.error).toMatch(/expired or has already been used/i);
  });

  it("refuses an expired link, judged by the database clock", async () => {
    const { token } = await signUp();
    await db.pool.query(
      `update email_verification_tokens set expires_at = now() - interval '1 minute'`,
    );

    const res = await post(app, "/auth/verify-email").send({ token });
    expect(res.status).toBe(400);
    expect(db.rows("users")[0].email_verified_at).toBeNull();
  });

  it("refuses an invented token", async () => {
    await signUp();
    const res = await post(app, "/auth/verify-email").send({ token: "made-up" });
    expect(res.status).toBe(400);
    expect(db.rows("users")[0].email_verified_at).toBeNull();
  });

  /** Knowing the stored hash must not be enough to spend the token. */
  it("refuses the stored hash presented as the token", async () => {
    await signUp();
    const stored = db.rows("email_verification_tokens")[0].token_hash as string;

    const res = await post(app, "/auth/verify-email").send({ token: stored });
    expect(res.status).toBe(400);
  });

  it("gives the same answer for expired, used, and never-valid", async () => {
    const { token } = await signUp();
    await post(app, "/auth/verify-email").send({ token });

    const used = await post(app, "/auth/verify-email").send({ token });
    const invented = await post(app, "/auth/verify-email").send({ token: "made-up" });
    expect(used.body).toEqual(invented.body);
  });
});

describe("POST /auth/verification/resend", () => {
  it("issues a new link and invalidates the previous one", async () => {
    const { cookie, token: first } = await signUp();

    const res = await post(app, "/auth/verification/resend").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.sent).toBe(true);

    const second = lastToken();
    expect(second).not.toBe(first);

    // The old link is dead; the new one works.
    expect((await post(app, "/auth/verify-email").send({ token: first })).status).toBe(400);
    expect((await post(app, "/auth/verify-email").send({ token: second })).status).toBe(200);
  });

  it("requires a session, so it cannot be used to probe addresses", async () => {
    await signUp();
    const res = await post(app, "/auth/verification/resend");
    expect(res.status).toBe(401);
  });

  /**
   * §6.1 step 2: suspended accounts are refused before anything else. This is
   * the difference between `requireAuth` and a bare `sessionUser()` call, so
   * without this test the guard could be dropped from the route unnoticed.
   */
  it("refuses a suspended account", async () => {
    const { cookie } = await signUp();
    await db.pool.query(`update users set status = 'suspended'`);
    mailer.sent.length = 0;

    const res = await post(app, "/auth/verification/resend").set("Cookie", cookie);
    expect(res.status).toBe(403);
    expect(mailer.sent).toHaveLength(0);
  });

  it("does nothing when the address is already verified", async () => {
    const { cookie, token } = await signUp();
    await post(app, "/auth/verify-email").send({ token });
    mailer.sent.length = 0;

    const res = await post(app, "/auth/verification/resend").set("Cookie", cookie);
    expect(res.body).toEqual({ sent: false, reason: "already-verified" });
    expect(mailer.sent).toHaveLength(0);
  });

  /** The caller asked for an email, so a failure is theirs to know about. */
  it("reports a provider failure, unlike sign up", async () => {
    const { cookie } = await signUp();
    vi.spyOn(console, "error").mockImplementation(() => {});
    mailer.fail = true;

    const res = await post(app, "/auth/verification/resend").set("Cookie", cookie);
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/couldn't send/i);
  });
});

describe("POST /auth/password/forgot", () => {
  /** §6.3: the reply must not reveal whether an address is registered. */
  it("answers identically for a known and an unknown address", async () => {
    await signUp();

    const known = await post(app, "/auth/password/forgot").send({ email: ACCOUNT.email });
    const unknown = await post(app, "/auth/password/forgot").send({ email: "nobody@example.com" });

    expect(known.status).toBe(unknown.status);
    expect(known.body).toEqual(unknown.body);
    expect(known.body.message).toMatch(/if that email has an account/i);
  });

  it("mails a link only for a real account", async () => {
    await signUp();
    mailer.sent.length = 0;

    await post(app, "/auth/password/forgot").send({ email: "nobody@example.com" });
    expect(mailer.sent).toHaveLength(0);

    await post(app, "/auth/password/forgot").send({ email: ACCOUNT.email });
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0].subject).toMatch(/password/i);
  });

  it("stores the reset token only as a hash", async () => {
    await signUp();
    await post(app, "/auth/password/forgot").send({ email: ACCOUNT.email });

    const token = lastToken();
    const stored = db.rows("password_reset_tokens")[0].token_hash as string;
    expect(stored).not.toBe(token);
    expect(stored).toBe(hashToken(token));
  });

  /** A provider outage must not become a way to tell that an address exists. */
  it("still answers normally when mail fails", async () => {
    await signUp();
    vi.spyOn(console, "error").mockImplementation(() => {});
    mailer.fail = true;

    const res = await post(app, "/auth/password/forgot").send({ email: ACCOUNT.email });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/if that email has an account/i);
  });

  it("sends nothing to a suspended account", async () => {
    await signUp();
    await db.pool.query(`update users set status = 'suspended'`);
    mailer.sent.length = 0;

    const res = await post(app, "/auth/password/forgot").send({ email: ACCOUNT.email });
    expect(res.status).toBe(200);
    expect(mailer.sent).toHaveLength(0);
  });
});

describe("POST /auth/password/reset", () => {
  async function requestReset(): Promise<string> {
    await post(app, "/auth/password/forgot").send({ email: ACCOUNT.email });
    return lastToken();
  }

  it("sets the new password and lets the learner log in with it", async () => {
    await signUp();
    const token = await requestReset();

    const res = await post(app, "/auth/password/reset").send({
      token,
      password: "a-brand-new-password",
    });
    expect(res.status).toBe(200);
    expect(res.body.next).toBe("/login");

    const hash = db.rows("users")[0].password_hash as string;
    expect(await verifyPassword(hash, "a-brand-new-password")).toBe(true);
    expect(await verifyPassword(hash, ACCOUNT.password)).toBe(false);

    const login = await post(app, "/auth/login").send({
      email: ACCOUNT.email,
      password: "a-brand-new-password",
    });
    expect(login.status).toBe(200);
  });

  /**
   * §6.3: sessions are cleared on password change. An attacker holding a
   * stolen cookie is signed out by the reset that was prompted by their theft.
   */
  it("signs out every existing session", async () => {
    const { cookie } = await signUp();
    await post(app, "/auth/login").send({ email: ACCOUNT.email, password: ACCOUNT.password });
    expect(db.rows("sessions").length).toBeGreaterThanOrEqual(2);

    const token = await requestReset();
    await post(app, "/auth/password/reset").send({ token, password: "a-brand-new-password" });

    expect(db.rows("sessions")).toHaveLength(0);
    const after = await post(app, "/auth/logout").set("Cookie", cookie);
    expect(after.status).toBe(204); // the cookie is now inert
  });

  it("refuses the same link twice", async () => {
    await signUp();
    const token = await requestReset();
    await post(app, "/auth/password/reset").send({ token, password: "a-brand-new-password" });

    const second = await post(app, "/auth/password/reset").send({
      token,
      password: "another-password-again",
    });
    expect(second.status).toBe(400);

    // The second attempt changed nothing.
    const hash = db.rows("users")[0].password_hash as string;
    expect(await verifyPassword(hash, "a-brand-new-password")).toBe(true);
  });

  it("refuses an expired link and leaves the password alone", async () => {
    await signUp();
    const token = await requestReset();
    await db.pool.query(`update password_reset_tokens set expires_at = now() - interval '1 minute'`);

    const res = await post(app, "/auth/password/reset").send({ token, password: "new-password-here" });
    expect(res.status).toBe(400);

    const hash = db.rows("users")[0].password_hash as string;
    expect(await verifyPassword(hash, ACCOUNT.password)).toBe(true);
  });

  it("asking again invalidates the earlier link", async () => {
    await signUp();
    const first = await requestReset();
    const second = await requestReset();
    expect(second).not.toBe(first);

    expect(
      (await post(app, "/auth/password/reset").send({ token: first, password: "new-password-here" }))
        .status,
    ).toBe(400);
    expect(
      (await post(app, "/auth/password/reset").send({ token: second, password: "new-password-here" }))
        .status,
    ).toBe(200);
  });

  it("enforces the minimum length", async () => {
    await signUp();
    const token = await requestReset();

    const res = await post(app, "/auth/password/reset").send({ token, password: "short" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/8 characters/i);
    // A rejected password must not burn the link.
    expect(db.rows("password_reset_tokens")[0].used_at).toBeNull();
  });

  /** Following an emailed link proves inbox control, the same as verifying. */
  it("also confirms the email address", async () => {
    await signUp();
    expect(db.rows("users")[0].email_verified_at).toBeNull();

    const token = await requestReset();
    await post(app, "/auth/password/reset").send({ token, password: "a-brand-new-password" });

    expect(db.rows("users")[0].email_verified_at).not.toBeNull();
  });
});
