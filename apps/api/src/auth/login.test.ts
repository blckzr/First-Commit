import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../app.js";
import { createTestDb, type TestDb } from "../test/db.js";
import { post, postFrom } from "../test/http.js";
import type { Mailer } from "../mail/index.js";
import { SESSION_COOKIE } from "./sessions.js";

const silentMailer: Mailer = { name: "test", async send() {} };

let db: TestDb;
let app: Express;

const ACCOUNT = {
  fullName: "Jan Kevin Gerona",
  email: "learner@example.com",
  password: "a-good-password",
};

async function signUp(): Promise<string> {
  const res = await post(app, "/auth/signup").send(ACCOUNT);
  return (res.headers["set-cookie"] as unknown as string[])[0].split(";")[0];
}

beforeEach(() => {
  db = createTestDb();
  app = createApp({ pool: db.pool, mailer: silentMailer });
});

describe("POST /auth/login", () => {
  it("signs in with the right password and issues a new session", async () => {
    await signUp();
    await db.pool.query(`delete from sessions`); // as if the cookie had expired

    const res = await post(app, "/auth/login").send({
      email: ACCOUNT.email,
      password: ACCOUNT.password,
    });

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(ACCOUNT.email);
    expect(res.body.user.role).toBe("learner");
    expect(db.rows("sessions")).toHaveLength(1);
  });

  it("accepts the email in any case", async () => {
    await signUp();
    const res = await post(app, "/auth/login").send({
      email: "LEARNER@Example.COM",
      password: ACCOUNT.password,
    });
    expect(res.status).toBe(200);
  });

  it("records last_login_at", async () => {
    await signUp();
    expect(db.rows("users")[0].last_login_at).toBeNull();

    await post(app, "/auth/login").send({ email: ACCOUNT.email, password: ACCOUNT.password });
    expect(db.rows("users")[0].last_login_at).not.toBeNull();
  });

  /**
   * §6.3: "Messages must not leak accounts." A wrong password and an address
   * that was never registered must be indistinguishable — same status, same
   * message — or this endpoint becomes a way to enumerate learners.
   */
  it("answers a wrong password and an unknown address identically", async () => {
    await signUp();

    const wrongPassword = await post(app, "/auth/login").send({
      email: ACCOUNT.email,
      password: "not-the-password",
    });
    const unknownAddress = await post(app, "/auth/login").send({
      email: "nobody@example.com",
      password: ACCOUNT.password,
    });

    expect(wrongPassword.status).toBe(401);
    expect(unknownAddress.status).toBe(401);
    expect(wrongPassword.body).toEqual(unknownAddress.body);
    expect(wrongPassword.body.error).toBe("Email or password is incorrect.");
  });

  it("issues no session when the password is wrong", async () => {
    await signUp();
    await db.pool.query(`delete from sessions`);

    const res = await post(app, "/auth/login").send({
      email: ACCOUNT.email,
      password: "not-the-password",
    });

    expect(res.headers["set-cookie"]).toBeUndefined();
    expect(db.rows("sessions")).toHaveLength(0);
  });

  /**
   * Suspension is reported only once the password checked out, so it tells the
   * caller nothing they had not already proved.
   */
  it("refuses a suspended account, but only after the password is right", async () => {
    await signUp();
    await db.pool.query(`update users set status = 'suspended'`);

    const right = await post(app, "/auth/login").send({
      email: ACCOUNT.email,
      password: ACCOUNT.password,
    });
    expect(right.status).toBe(403);
    expect(right.body.error).toMatch(/suspended/i);

    const wrong = await post(app, "/auth/login").send({
      email: ACCOUNT.email,
      password: "not-the-password",
    });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error).toBe("Email or password is incorrect.");
  });

  it("never returns the password hash", async () => {
    await signUp();
    const res = await post(app, "/auth/login").send({
      email: ACCOUNT.email,
      password: ACCOUNT.password,
    });
    expect(JSON.stringify(res.body)).not.toMatch(/argon2|password/i);
  });

  /** design.md §5.3 — where the browser goes next. */
  describe("next destination", () => {
    it("sends a learner mid-onboarding back to their step", async () => {
      await signUp();
      await db.pool.query(`update learner_profiles set onboarding_step = 'placement'`);

      const res = await post(app, "/auth/login").send({
        email: ACCOUNT.email,
        password: ACCOUNT.password,
      });
      expect(res.body.next).toBe("/onboarding/placement");
    });

    it("sends a finished learner to the app", async () => {
      await signUp();
      await db.pool.query(`update learner_profiles set onboarding_step = 'done'`);

      const res = await post(app, "/auth/login").send({
        email: ACCOUNT.email,
        password: ACCOUNT.password,
      });
      expect(res.body.next).toBe("/app");
    });

    it("sends an admin to the admin area", async () => {
      await signUp();
      await db.pool.query(`update users set role = 'admin'`);

      const res = await post(app, "/auth/login").send({
        email: ACCOUNT.email,
        password: ACCOUNT.password,
      });
      expect(res.body.next).toBe("/admin");
    });
  });
});

describe("POST /auth/logout", () => {
  it("ends the session and clears the cookie", async () => {
    const cookie = await signUp();
    expect(db.rows("sessions")).toHaveLength(1);

    const res = await post(app, "/auth/logout").set("Cookie", cookie);

    expect(res.status).toBe(204);
    expect(db.rows("sessions")).toHaveLength(0);

    const after = await request(app).get("/auth/me").set("Cookie", cookie);
    expect(after.status).toBe(401);
  });

  /** Log out is not a place to tell someone whether their cookie was real. */
  it("answers 204 with no session at all", async () => {
    const res = await post(app, "/auth/logout");
    expect(res.status).toBe(204);
  });

  it("ends only the session presented, not every session for the user", async () => {
    const first = await signUp();
    await post(app, "/auth/login").send({ email: ACCOUNT.email, password: ACCOUNT.password });
    expect(db.rows("sessions")).toHaveLength(2);

    await post(app, "/auth/logout").set("Cookie", first);
    expect(db.rows("sessions")).toHaveLength(1);
  });
});

/**
 * §6.3 requires a CSRF defense. In production the cookie is `sameSite=none`,
 * so a cross-site HTML form post would carry it — and unlike a cross-origin
 * `fetch`, a form post is a simple request with no preflight for CORS to stop.
 */
describe("CSRF guard", () => {
  it("refuses a state-changing request from another origin", async () => {
    const cookie = await signUp();
    const res = await postFrom(app, "/auth/logout", "https://evil.example").set("Cookie", cookie);

    expect(res.status).toBe(403);
    expect(db.rows("sessions")).toHaveLength(1); // the session survived
  });

  it("refuses a state-changing request with no Origin, as a form post would send", async () => {
    const cookie = await signUp();
    const res = await postFrom(app, "/auth/logout", null).set("Cookie", cookie);

    expect(res.status).toBe(403);
    expect(db.rows("sessions")).toHaveLength(1);
  });

  it("accepts a same-origin Referer when Origin is absent", async () => {
    const cookie = await signUp();
    const res = await postFrom(app, "/auth/logout", null)
      .set("Referer", "http://localhost:5173/app/settings")
      .set("Cookie", cookie);

    expect(res.status).toBe(204);
  });

  it("leaves safe methods alone", async () => {
    const cookie = await signUp();
    const res = await request(app).get("/auth/me").set("Cookie", cookie);
    expect(res.status).toBe(200);
  });

  it("guards sign up and log in too", async () => {
    for (const path of ["/auth/signup", "/auth/login"]) {
      const res = await postFrom(app, path, "https://evil.example").send(ACCOUNT);
      expect(res.status, `${path} should be guarded`).toBe(403);
    }
  });
});

describe("session cookie", () => {
  it("is httpOnly and scoped to the whole site", async () => {
    const res = await post(app, "/auth/signup").send(ACCOUNT);
    const cookie = (res.headers["set-cookie"] as unknown as string[])[0];

    expect(cookie).toContain(`${SESSION_COOKIE}=`);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Path=\//i);
    // NODE_ENV is "test", so this is the development shape.
    expect(cookie).toMatch(/SameSite=Lax/i);
  });
});
