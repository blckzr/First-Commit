import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../app.js";
import { createTestDb, type TestDb } from "@first-commit/test-db";
import { post } from "../test/http.js";
import type { Mailer } from "../mail/index.js";
import { createDevGitHub } from "./dev.js";
import { createGitHub, type GitHubClient } from "./index.js";

const silentMailer: Mailer = { name: "test", async send() {} };

/**
 * Connecting a GitHub account (design.md §5.14 stage 2).
 *
 * **The `state` parameter is the entire security of this flow.** OAuth comes
 * back by browser redirect, so the callback is a GET that writes and the CSRF
 * guard — which covers methods, not navigations — cannot help. Most of what is
 * here is about that one check.
 */

let db: TestDb;
let app: Express;
let cookie: string;
let learnerId: string;

const read = (path: string) => request(app).get(path).set("Cookie", cookie);

/** Starts the flow and returns the install URL plus the state cookie it set. */
async function begin(): Promise<{ url: string; stateCookie: string; state: string }> {
  const res = await read("/github/connect");
  const stateCookie = (res.headers["set-cookie"] as unknown as string[])[0].split(";")[0];
  const url = res.body.url as string;
  const state = new URL(url, "http://localhost").searchParams.get("state")!;
  return { url, stateCookie, state };
}

/** Follows the callback the way a browser would, carrying both cookies. */
const callback = (query: string, cookies: string[]) =>
  request(app).get(`/github/callback?${query}`).set("Cookie", cookies);

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
});

describe("picking an implementation", () => {
  it("uses the development client when nothing is configured", () => {
    const client = createGitHub({
      appId: null,
      appSlug: null,
      clientId: null,
      clientSecret: null,
      privateKey: null,
    });
    expect(client.configured).toBe(false);
    expect(client.name).toBe("development");
  });

  /**
   * A half-configured App fails at the first API call with something
   * unhelpful. Refusing at boot names what is missing instead — the same
   * reasoning as `secret()` refusing a placeholder.
   */
  it("refuses a half-configured App and says what is missing", () => {
    expect(() =>
      createGitHub({
        appId: "123",
        appSlug: "first-commit",
        clientId: "abc",
        clientSecret: null,
        privateKey: null,
      }),
    ).toThrow(/clientSecret.*privateKey|privateKey/s);
  });

  /** The same code twice must give the same account, or nothing can be tested. */
  it("invents consistently", async () => {
    const client = createDevGitHub();
    const first = await client.identify("dev-abc");
    const second = await client.identify("dev-abc");
    const other = await client.identify("dev-xyz");

    expect(first).toEqual(second);
    expect(other.githubUserId).not.toBe(first.githubUserId);
  });
});

describe("starting the flow", () => {
  it("refuses without a session", async () => {
    expect((await request(app).get("/github/connect")).status).toBe(401);
  });

  it("sets an httpOnly state cookie and puts the same state in the URL", async () => {
    const res = await read("/github/connect");

    const setCookie = (res.headers["set-cookie"] as unknown as string[])[0];
    expect(setCookie).toMatch(/fc_github_state=/);
    expect(setCookie).toMatch(/HttpOnly/i);

    const state = new URL(res.body.url, "http://localhost").searchParams.get("state");
    expect(state).toBeTruthy();
    expect(setCookie).toContain(state!);
  });

  it("gives a different state every time", async () => {
    const a = await begin();
    const b = await begin();
    expect(a.state).not.toBe(b.state);
  });
});

describe("the callback", () => {
  it("stores the connection and sends the learner back to the capstone", async () => {
    const { stateCookie, state } = await begin();

    const res = await callback(`installation_id=1&code=dev-1&state=${state}`, [cookie, stateCookie]);

    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\/app\/capstone\?github=connected$/);

    const row = db.rows("github_connections")[0];
    expect(row.user_id).toBe(learnerId);
    expect(Number(row.installation_id)).toBe(1);
    expect(row.github_username).toMatch(/^learner-/);
  });

  /**
   * **The attack this prevents.** Somebody sends a signed-in learner to the
   * callback with their own installation. Without the state check it would
   * attach their repository to the learner's account — and their code would end
   * up behind that learner's Project Certificate.
   */
  it("refuses a callback with no state cookie", async () => {
    const res = await callback("installation_id=99&code=dev-attacker&state=anything", [cookie]);

    expect(res.headers.location).toMatch(/github=state/);
    expect(db.rows("github_connections")).toHaveLength(0);
  });

  it("refuses a state that does not match the cookie", async () => {
    const { stateCookie } = await begin();

    const res = await callback("installation_id=99&code=dev-attacker&state=not-the-one", [
      cookie,
      stateCookie,
    ]);

    expect(res.headers.location).toMatch(/github=state/);
    expect(db.rows("github_connections")).toHaveLength(0);
  });

  /**
   * The callback clears the cookie, so a link replayed later arrives without
   * one and matches nothing.
   *
   * **This does not prove single use**, and is not claiming to: replaying with
   * the cookie still in hand would succeed. That is deliberate — anyone holding
   * the state cookie also holds the session cookie, and at that point they have
   * the account rather than a replay. Single-use would need the state stored
   * server-side, which buys nothing against an attacker who already has both.
   */
  it("refuses a callback link replayed after the cookie is cleared", async () => {
    const { stateCookie, state } = await begin();
    await callback(`installation_id=1&code=dev-1&state=${state}`, [cookie, stateCookie]);

    const replay = await callback(`installation_id=2&code=dev-2&state=${state}`, [cookie]);

    expect(replay.headers.location).toMatch(/github=state/);
    expect(Number(db.rows("github_connections")[0].installation_id)).toBe(1);
  });

  it("refuses without a session", async () => {
    const { stateCookie, state } = await begin();
    const res = await callback(`installation_id=1&code=dev-1&state=${state}`, [stateCookie]);
    expect(res.status).toBe(401);
  });

  it.each([
    ["code=dev-1&state=", "no installation"],
    ["installation_id=1&state=", "no code"],
    ["installation_id=nonsense&code=dev-1&state=", "a non-numeric installation"],
  ])("refuses %s (%s)", async (query) => {
    const { stateCookie, state } = await begin();
    const res = await callback(`${query}${state}`, [cookie, stateCookie]);

    expect(res.headers.location).toMatch(/github=(incomplete|state)/);
    expect(db.rows("github_connections")).toHaveLength(0);
  });

  it("reports an unusable code instead of failing the request", async () => {
    const rejecting: GitHubClient = {
      ...createDevGitHub(),
      identify: () => Promise.reject(new Error("bad code")),
    };
    app = createApp({ pool: db.pool, mailer: silentMailer, github: rejecting });

    const { stateCookie, state } = await begin();
    const res = await callback(`installation_id=1&code=expired&state=${state}`, [
      cookie,
      stateCookie,
    ]);

    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/github=code/);
  });

  /** Reconnecting is ordinary — a new repository selection lands here too. */
  it("lets the same learner reconnect", async () => {
    const first = await begin();
    await callback(`installation_id=1&code=dev-1&state=${first.state}`, [cookie, first.stateCookie]);

    const second = await begin();
    await callback(`installation_id=7&code=dev-1&state=${second.state}`, [
      cookie,
      second.stateCookie,
    ]);

    expect(db.rows("github_connections")).toHaveLength(1);
    expect(Number(db.rows("github_connections")[0].installation_id)).toBe(7);
  });

  /**
   * `github_user_id` is unique. Moving it silently would take the repository
   * away from the first learner's project without telling either of them.
   */
  it("refuses a GitHub account another learner has already connected", async () => {
    const first = await begin();
    await callback(`installation_id=1&code=dev-shared&state=${first.state}`, [
      cookie,
      first.stateCookie,
    ]);

    const otherSignUp = await post(app, "/auth/signup").send({
      fullName: "Someone Else",
      email: "other@example.com",
      password: "a-good-password",
    });
    cookie = (otherSignUp.headers["set-cookie"] as unknown as string[])[0].split(";")[0];

    const second = await begin();
    const res = await callback(`installation_id=2&code=dev-shared&state=${second.state}`, [
      cookie,
      second.stateCookie,
    ]);

    expect(res.headers.location).toMatch(/github=taken/);
    expect(db.rows("github_connections")).toHaveLength(1);
  });
});

describe("reading the connection", () => {
  it("says so when nothing is connected", async () => {
    const res = await read("/github/connection");
    expect(res.body).toMatchObject({ connected: false, configured: false, repositories: [] });
  });

  it("lists the repositories the installation grants", async () => {
    const { stateCookie, state } = await begin();
    await callback(`installation_id=1&code=dev-1&state=${state}`, [cookie, stateCookie]);

    const res = await read("/github/connection");
    expect(res.body.connected).toBe(true);
    expect(res.body.login).toMatch(/^learner-/);
    expect(res.body.repositories).toHaveLength(1);
    expect(res.body.repositories[0].fullName).toMatch(/\/task-tracker$/);
  });

  /**
   * A learner can change the repository selection on GitHub at any time, so the
   * list is read live. When GitHub cannot be reached that is not a disconnected
   * account — it is one the platform cannot see right now.
   */
  it("stays connected when GitHub cannot be reached", async () => {
    const unreachable: GitHubClient = {
      ...createDevGitHub(),
      installationRepositories: () => Promise.reject(new Error("network")),
    };
    app = createApp({ pool: db.pool, mailer: silentMailer, github: unreachable });

    const { stateCookie, state } = await begin();
    await callback(`installation_id=1&code=dev-1&state=${state}`, [cookie, stateCookie]);

    const res = await read("/github/connection");
    expect(res.body.connected).toBe(true);
    expect(res.body.reachable).toBe(false);
    expect(res.body.repositories).toEqual([]);
  });

  it("refuses without a session", async () => {
    expect((await request(app).get("/github/connection")).status).toBe(401);
  });

  /** One learner's connection is never another's (§6.1 step 3). */
  it("does not show another learner's connection", async () => {
    const { stateCookie, state } = await begin();
    await callback(`installation_id=1&code=dev-1&state=${state}`, [cookie, stateCookie]);

    const otherSignUp = await post(app, "/auth/signup").send({
      fullName: "Someone Else",
      email: "other@example.com",
      password: "a-good-password",
    });
    const otherCookie = (otherSignUp.headers["set-cookie"] as unknown as string[])[0].split(";")[0];

    const res = await request(app).get("/github/connection").set("Cookie", otherCookie);
    expect(res.body.connected).toBe(false);
  });
});
