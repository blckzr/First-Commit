import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import { createTestDb, type TestDb } from "@first-commit/test-db";
import { post } from "../test/http.js";
import { createApp } from "../app.js";
import { SESSION_COOKIE } from "../auth/sessions.js";
import { hashToken } from "../auth/tokens.js";
import { attachSession, requireAdmin, requireAuth, assertOwned } from "./session.js";
import { errorHandler } from "./errors.js";
import type { Mailer } from "../mail/index.js";

const silentMailer: Mailer = { name: "test", async send() {} };

let db: TestDb;
let app: Express;

const VALID = {
  fullName: "Jan Kevin Gerona",
  email: "learner@example.com",
  password: "a-good-password",
};

/** Signs up and returns the session cookie, the way a browser would hold it. */
async function signUp(as: Express = app): Promise<string> {
  const res = await post(as, "/auth/signup").send(VALID);
  const cookies = res.headers["set-cookie"] as unknown as string[];
  return cookies[0].split(";")[0];
}

beforeEach(() => {
  db = createTestDb();
  app = createApp({ pool: db.pool, mailer: silentMailer });
});

describe("§6.1 step 1 — resolve the session", () => {
  it("answers /auth/me for a signed-in caller", async () => {
    const cookie = await signUp();
    const res = await request(app).get("/auth/me").set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(VALID.email);
    expect(res.body.user.role).toBe("learner");
    expect(res.body.user.emailVerified).toBe(false);
  });

  /** design.md §4.3: the guards need the onboarding step on every request. */
  it("reports where the learner stopped in onboarding", async () => {
    const cookie = await signUp();

    const fresh = await request(app).get("/auth/me").set("Cookie", cookie);
    expect(fresh.body.onboardingStep).toBe("about");

    await db.pool.query(`update learner_profiles set onboarding_step = 'placement'`);
    const mid = await request(app).get("/auth/me").set("Cookie", cookie);
    expect(mid.body.onboardingStep).toBe("placement");

    await db.pool.query(`update learner_profiles set onboarding_step = 'done'`);
    const done = await request(app).get("/auth/me").set("Cookie", cookie);
    expect(done.body.onboardingStep).toBeNull();
  });

  it("never returns the password hash", async () => {
    const cookie = await signUp();
    const res = await request(app).get("/auth/me").set("Cookie", cookie);
    expect(JSON.stringify(res.body)).not.toMatch(/argon2|password/i);
  });

  it("rejects a request with no cookie", async () => {
    const res = await request(app).get("/auth/me");
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/signed in/i);
  });

  it("rejects a forged cookie", async () => {
    await signUp();
    const res = await request(app)
      .get("/auth/me")
      .set("Cookie", `${SESSION_COOKIE}=not-a-real-token`);
    expect(res.status).toBe(401);
  });

  /**
   * The session row holds only a hash, so knowing it must not be enough to
   * sign in. This is the test that would catch someone comparing the raw
   * cookie against the stored column.
   */
  it("rejects the stored hash presented as a token", async () => {
    await signUp();
    const storedHash = db.rows("sessions")[0].token_hash as string;
    const res = await request(app)
      .get("/auth/me")
      .set("Cookie", `${SESSION_COOKIE}=${storedHash}`);
    expect(res.status).toBe(401);
  });

  it("rejects an expired session, judged by the database clock", async () => {
    const cookie = await signUp();
    const token = cookie.split("=")[1];

    await db.pool.query(`update sessions set expires_at = now() - interval '1 day' where token_hash = $1`, [
      hashToken(token),
    ]);

    const res = await request(app).get("/auth/me").set("Cookie", cookie);
    expect(res.status).toBe(401);
  });
});

describe("§6.1 step 2 — reject suspended accounts", () => {
  it("refuses a suspended account before doing anything else", async () => {
    const cookie = await signUp();
    await db.pool.query(`update users set status = 'suspended'`);

    const res = await request(app).get("/auth/me").set("Cookie", cookie);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/suspended/i);
  });
});

describe("§6.1 step 5 — role on admin routes", () => {
  /** Built here rather than on the real app, which has no admin route yet. */
  function appWithAdminRoute(): Express {
    const a = express();
    a.use(express.json());
    a.use(cookieParser());
    a.use(attachSession(db.pool));
    a.post("/auth/signup", () => {}); // unused; signUp() targets the real app
    a.get("/admin/thing", requireAuth, requireAdmin, (_req, res) => {
      res.json({ ok: true });
    });
    a.use(errorHandler);
    return a;
  }

  it("lets an admin through", async () => {
    const cookie = await signUp();
    await db.pool.query(`update users set role = 'admin'`);

    const res = await request(appWithAdminRoute()).get("/admin/thing").set("Cookie", cookie);
    expect(res.status).toBe(200);
  });

  /**
   * A learner gets 404, not 403. Answering "forbidden" would confirm the route
   * exists, which is itself a leak about the admin surface.
   */
  it("answers a learner with 404, not 403", async () => {
    const cookie = await signUp();
    const res = await request(appWithAdminRoute()).get("/admin/thing").set("Cookie", cookie);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Not found");
  });

  it("answers a signed-out caller with 401", async () => {
    const res = await request(appWithAdminRoute()).get("/admin/thing");
    expect(res.status).toBe(401);
  });
});

describe("§6.1 step 4 — assertOwned", () => {
  it("passes when a row matched", () => {
    expect(() => assertOwned(1)).not.toThrow();
  });

  /** 404 rather than 403: confirming the record exists is the leak. */
  it.each([[0], [null]])("throws 404 when nothing matched (%s)", (count) => {
    expect(() => assertOwned(count)).toThrowError(
      expect.objectContaining({ status: 404, message: "Not found" }),
    );
  });
});
