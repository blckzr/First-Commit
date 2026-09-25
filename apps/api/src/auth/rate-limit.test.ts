import { beforeEach, describe, expect, it } from "vitest";
import type { Express } from "express";
import { createApp } from "../app.js";
import { createTestDb, type TestDb } from "@first-commit/test-db";
import { post } from "../test/http.js";
import type { Mailer } from "../mail/index.js";
import { RULES } from "./rate-limit.js";

const silentMailer: Mailer = { name: "test", async send() {} };

let db: TestDb;
let app: Express;

const ACCOUNT = {
  fullName: "Jan Kevin Gerona",
  email: "learner@example.com",
  password: "a-good-password",
};

const login = (email: string, password: string) =>
  post(app, "/auth/login").send({ email, password });

/** Attempts from a different machine, via the header `trust proxy` reads. */
const loginFrom = (ip: string, email: string, password: string) =>
  post(app, "/auth/login").set("X-Forwarded-For", ip).send({ email, password });

beforeEach(async () => {
  db = createTestDb();
  app = createApp({ pool: db.pool, mailer: silentMailer });
  await post(app, "/auth/signup").send(ACCOUNT);
});

describe("login rate limiting", () => {
  it("allows up to the per-email limit, then refuses", async () => {
    for (let i = 0; i < RULES.login.perEmail; i++) {
      const res = await login(ACCOUNT.email, "wrong-password");
      expect(res.status, `attempt ${i + 1} should still be allowed`).toBe(401);
    }

    const blocked = await login(ACCOUNT.email, "wrong-password");
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatch(/too many attempts/i);
  });

  /**
   * The limit has to hold even once the caller finally gets the password
   * right, or it is only an inconvenience rather than a control.
   */
  it("refuses the right password too, once the limit is reached", async () => {
    for (let i = 0; i < RULES.login.perEmail; i++) {
      await login(ACCOUNT.email, "wrong-password");
    }

    const res = await login(ACCOUNT.email, ACCOUNT.password);
    expect(res.status).toBe(429);
    expect(db.rows("sessions")).toHaveLength(1); // only the one from sign up
  });

  it("does not count successful logins toward the limit", async () => {
    for (let i = 0; i < RULES.login.perEmail + 3; i++) {
      const res = await login(ACCOUNT.email, ACCOUNT.password);
      expect(res.status, `success ${i + 1} should be allowed`).toBe(200);
    }
  });

  /**
   * An attempt is recorded even when the address has no account. Counting only
   * real accounts would make a 429 mean "this account exists", turning the
   * limiter into the enumeration oracle §6.3 is trying to close.
   */
  it("records attempts for an unknown address, so 429 leaks nothing", async () => {
    for (let i = 0; i < RULES.login.perEmail; i++) {
      await login("nobody@example.com", "whatever");
    }

    const unknown = await login("nobody@example.com", "whatever");
    expect(unknown.status).toBe(429);

    // Same treatment for a real address, so the two are indistinguishable.
    for (let i = 0; i < RULES.login.perEmail; i++) {
      await login(ACCOUNT.email, "wrong-password");
    }
    const known = await login(ACCOUNT.email, "wrong-password");
    expect(known.status).toBe(429);
    expect(known.body).toEqual(unknown.body);
  });

  it("limits one address without locking out another", async () => {
    for (let i = 0; i < RULES.login.perEmail; i++) {
      await login(ACCOUNT.email, "wrong-password");
    }
    expect((await login(ACCOUNT.email, "wrong-password")).status).toBe(429);

    // A different address on the same IP is still under the per-IP limit.
    const other = await login("someone.else@example.com", "wrong-password");
    expect(other.status).toBe(401);
  });

  /** The per-IP limit is what sees an attacker spraying many addresses. */
  it("limits one machine spraying different addresses", async () => {
    const attacker = "203.0.113.9";
    for (let i = 0; i < RULES.login.perIp; i++) {
      await loginFrom(attacker, `target${i}@example.com`, "wrong-password");
    }

    const blocked = await loginFrom(attacker, "yet-another@example.com", "wrong-password");
    expect(blocked.status).toBe(429);

    // A different machine is unaffected.
    const elsewhere = await loginFrom("198.51.100.7", "fresh@example.com", "wrong-password");
    expect(elsewhere.status).toBe(401);
  });

  it("forgets attempts once the window has passed", async () => {
    for (let i = 0; i < RULES.login.perEmail; i++) {
      await login(ACCOUNT.email, "wrong-password");
    }
    expect((await login(ACCOUNT.email, "wrong-password")).status).toBe(429);

    await db.pool.query(
      `update auth_attempts set created_at = created_at - interval '1 day'`,
    );

    expect((await login(ACCOUNT.email, ACCOUNT.password)).status).toBe(200);
  });
});

describe("password reset rate limiting", () => {
  const forgot = (email: string) => post(app, "/auth/password/forgot").send({ email });

  /** Every request sends an email, so all of them count, not just failures. */
  it("counts every request, not only the ones that matched an account", async () => {
    for (let i = 0; i < RULES.reset_request.perEmail; i++) {
      expect((await forgot(ACCOUNT.email)).status).toBe(200);
    }
    expect((await forgot(ACCOUNT.email)).status).toBe(429);
  });

  it("limits an unknown address the same way", async () => {
    for (let i = 0; i < RULES.reset_request.perEmail; i++) {
      await forgot("nobody@example.com");
    }
    const res = await forgot("nobody@example.com");
    expect(res.status).toBe(429);
  });

  it("limits one machine working through many addresses", async () => {
    const attacker = "203.0.113.9";
    for (let i = 0; i < RULES.reset_request.perIp; i++) {
      await post(app, "/auth/password/forgot")
        .set("X-Forwarded-For", attacker)
        .send({ email: `target${i}@example.com` });
    }

    const blocked = await post(app, "/auth/password/forgot")
      .set("X-Forwarded-For", attacker)
      .send({ email: "one.more@example.com" });
    expect(blocked.status).toBe(429);
  });
});

describe("what gets recorded", () => {
  it("writes a row per attempt, with the address lowercased", async () => {
    await login("LEARNER@Example.COM", "wrong-password");
    const rows = db.rows("auth_attempts");
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe("learner@example.com");
    expect(rows[0].kind).toBe("login");
    expect(rows[0].succeeded).toBe(false);
  });

  it("marks a successful login as succeeded", async () => {
    await login(ACCOUNT.email, ACCOUNT.password);
    const rows = db.rows("auth_attempts");
    expect(rows.at(-1)!.succeeded).toBe(true);
  });

  it("never records the password", async () => {
    await login(ACCOUNT.email, ACCOUNT.password);
    expect(JSON.stringify(db.rows("auth_attempts"))).not.toContain(ACCOUNT.password);
  });

  /**
   * clientIp() normalises the IPv4-mapped IPv6 form, so one client cannot
   * occupy two buckets by being seen under two spellings.
   */
  it("stores one canonical address per client", async () => {
    await login(ACCOUNT.email, "wrong-password");
    const ip = db.rows("auth_attempts")[0].ip_address as string;
    expect(ip).not.toMatch(/^::ffff:/);
  });
});
