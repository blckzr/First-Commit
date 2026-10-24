import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../app.js";
import { createTestDb, type TestDb } from "@first-commit/test-db";
import { post } from "../test/http.js";
import type { Mailer } from "../mail/index.js";
import { isSigned } from "./webhook.js";

const silentMailer: Mailer = { name: "test", async send() {} };
const SECRET = "a-webhook-secret-long-enough-to-be-one";

/**
 * GitHub webhook deliveries (§6.2).
 *
 * **The signature is the whole of the authentication.** A webhook carries no
 * cookie and no Origin worth trusting, so §6.1's session rules cannot apply —
 * everything this endpoint writes is derived from a payload that proved it came
 * from GitHub. Most of what is tested here is that proof, and what happens when
 * it is absent.
 *
 * The second theme is **retries**. GitHub redelivers anything it believes
 * failed, so the same push arrives more than once by design, and both the
 * delivery and the commits have to survive that without doubling.
 */

let db: TestDb;
let app: Express;
let projectId: string;

/** A push as GitHub sends one, signed the way GitHub signs it. */
function deliver(
  payload: unknown,
  options: { event?: string; delivery?: string; secret?: string | null } = {},
) {
  const body = JSON.stringify(payload);
  const secret = options.secret === undefined ? SECRET : options.secret;

  const req = request(app)
    .post("/webhooks/github")
    .set("content-type", "application/json")
    .set("x-github-event", options.event ?? "push")
    .set("x-github-delivery", options.delivery ?? "delivery-1");

  if (secret !== null) {
    req.set(
      "x-hub-signature-256",
      `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`,
    );
  }

  return req.send(body);
}

const push = (sha = "aaa111", repoId = 900123) => ({
  repository: { id: repoId, full_name: "learner/task-tracker" },
  commits: [
    {
      id: sha,
      message: "Add the task form",
      timestamp: "2026-10-05T10:00:00Z",
      author: { username: "learner" },
    },
  ],
});

async function seedProject(): Promise<void> {
  const one = async (sql: string, values: unknown[] = []) =>
    (await db.pool.query<{ id: string }>(sql, values)).rows[0].id;

  const signUp = await post(app, "/auth/signup").send({
    fullName: "Jan Kevin Gerona",
    email: "learner@example.com",
    password: "a-good-password",
  });
  expect(signUp.status).toBe(201);
  const userId = (
    await db.pool.query<{ id: string }>(`select id from users where email = 'learner@example.com'`)
  ).rows[0].id;

  const path = await one(
    `insert into career_paths (slug, title, status) values ('jwd','JWD','published') returning id`,
  );
  const track = await one(
    `insert into tracks (career_path_id, title, status) values ($1,'Frontend','published') returning id`,
    [path],
  );
  const tech = await one(`insert into technologies (slug, name) values ('react','React') returning id`);
  const roadmap = await one(
    `insert into roadmaps (user_id, career_path_id, track_id, status) values ($1,$2,$3,'active') returning id`,
    [userId, path, track],
  );
  const brief = await one(
    `insert into capstone_briefs (track_id, slug, status) values ($1,'tt','published') returning id`,
    [track],
  );
  const version = await one(
    `insert into capstone_brief_versions (brief_id, version_no, title, status)
     values ($1,1,'Task tracker','published') returning id`,
    [brief],
  );
  projectId = await one(
    `insert into capstone_projects
       (user_id, roadmap_id, brief_version_id, technology_id, status, repo_github_id, repo_full_name)
     values ($1,$2,$3,$4,'in_progress',900123,'learner/task-tracker') returning id`,
    [userId, roadmap, version, tech],
  );
}

beforeEach(async () => {
  db = createTestDb();
  app = createApp({ pool: db.pool, mailer: silentMailer, githubWebhookSecret: SECRET });
  await seedProject();
});

describe("the signature", () => {
  it("accepts a correctly signed delivery", async () => {
    const res = await deliver(push());

    expect(res.status).toBe(200);
    expect(db.rows("project_commits")).toHaveLength(1);
  });

  /**
   * **The attack this stops.** Without the check, anybody who knows a
   * repository name could write commit history onto somebody else's capstone —
   * and the single-commit integrity signal reads that history.
   */
  it("refuses an unsigned delivery", async () => {
    const res = await deliver(push(), { secret: null });

    expect(res.status).toBe(401);
    expect(db.rows("project_commits")).toHaveLength(0);
    expect(db.rows("github_events")).toHaveLength(0);
  });

  it("refuses a delivery signed with the wrong secret", async () => {
    const res = await deliver(push(), { secret: "not-the-secret-at-all-but-long" });

    expect(res.status).toBe(401);
    expect(db.rows("project_commits")).toHaveLength(0);
  });

  /**
   * GitHub signs **the bytes it sent**. Re-serialising the parsed object gives
   * different bytes — key order, spacing, unicode escaping — so a signature
   * checked against `JSON.stringify(req.body)` would never match. This asserts
   * the raw body is what is verified.
   */
  it("verifies the bytes GitHub sent, not a re-serialised object", async () => {
    // Same data, different byte sequence: spacing and key order both differ.
    const body = '{\n  "repository" : {"full_name":"learner/task-tracker","id":900123},\n  "commits": []\n}';

    const res = await request(app)
      .post("/webhooks/github")
      .set("content-type", "application/json")
      .set("x-github-event", "push")
      .set("x-github-delivery", "spaced")
      .set(
        "x-hub-signature-256",
        `sha256=${createHmac("sha256", SECRET).update(body).digest("hex")}`,
      )
      .send(body);

    expect(res.status).toBe(200);
  });

  it("refuses everything when no secret is configured", async () => {
    app = createApp({ pool: db.pool, mailer: silentMailer, githubWebhookSecret: null });

    const res = await deliver(push());

    // Closed, not open. A missing environment variable must not become a door
    // that writes commit history for any project somebody can name.
    expect(res.status).toBe(503);
  });

  it("compares in constant time and survives a length mismatch", () => {
    const body = Buffer.from("{}");
    expect(isSigned(body, "sha256=short", SECRET)).toBe(false);
    expect(isSigned(body, "", SECRET)).toBe(false);
    expect(
      isSigned(body, `sha256=${createHmac("sha256", SECRET).update(body).digest("hex")}`, SECRET),
    ).toBe(true);
  });

  /** No Origin header on a webhook — the CSRF guard must not be in the way. */
  it("is not refused by the same-origin guard", async () => {
    const res = await deliver(push());
    expect(res.status).not.toBe(403);
  });
});

describe("retries", () => {
  /**
   * GitHub redelivers anything it believes failed. `delivery_id` is unique, so
   * the second arrival is recognised rather than replayed.
   */
  it("records a delivery once", async () => {
    await deliver(push(), { delivery: "same" });
    await deliver(push(), { delivery: "same" });

    expect(db.rows("github_events")).toHaveLength(1);
    expect(db.rows("project_commits")).toHaveLength(1);
  });

  it("answers 200 to a repeat, so GitHub stops retrying", async () => {
    await deliver(push(), { delivery: "same" });
    const again = await deliver(push(), { delivery: "same" });

    expect(again.status).toBe(200);
    expect(again.body.status).toMatch(/already seen/i);
  });

  /**
   * The webhook and the sync-on-read path both see the same push. That was a
   * hypothetical collision when `commits.ts` was written; it is a real one now.
   */
  it("does not double a commit the read path already stored", async () => {
    await db.pool.query(
      `insert into project_commits (project_id, sha, message, pushed_at)
       values ($1,'aaa111','Add the task form', now())`,
      [projectId],
    );

    await deliver(push("aaa111"));

    expect(db.rows("project_commits")).toHaveLength(1);
  });

  /**
   * A payload that cannot be processed must not make GitHub retry for ever —
   * repeated failures eventually disable the webhook for the whole App, for
   * every learner, because of one project.
   */
  it("keeps a processing failure out of the response and in the row", async () => {
    // A commits array of the wrong shape: recorded, then handled badly.
    const res = await deliver(
      { repository: { id: 900123 }, commits: [{ id: null }] },
      { delivery: "broken" },
    );

    expect(res.status).toBe(200);
    expect(db.rows("github_events")).toHaveLength(1);
  });
});

describe("which project a push belongs to", () => {
  it("matches on the numeric repository id", async () => {
    await deliver(push("bbb222", 900123));

    expect(db.rows("project_commits")[0].project_id).toBe(projectId);
  });

  /**
   * A learner can rename or transfer a repository at any time. The id does not
   * change, so a rename must not orphan the history.
   */
  it("still matches after the repository is renamed", async () => {
    const renamed = {
      repository: { id: 900123, full_name: "learner/something-else" },
      commits: [{ id: "ccc333", message: "Rename", timestamp: "2026-10-05T11:00:00Z" }],
    };

    await deliver(renamed, { delivery: "renamed" });

    expect(db.rows("project_commits")).toHaveLength(1);
  });

  it("ignores a push from a repository no project claims", async () => {
    await deliver({
      repository: { id: 7, full_name: "someone/else" },
      commits: [{ id: "ddd444", message: "Not ours", timestamp: "2026-10-05T11:00:00Z" }],
    });

    expect(db.rows("project_commits")).toHaveLength(0);
    // Still recorded: §6.2 keeps every delivery for debugging.
    expect(db.rows("github_events")).toHaveLength(1);
  });

  it("stores a non-push event without touching commits", async () => {
    await deliver({ action: "created" }, { event: "installation", delivery: "install-1" });

    expect(db.rows("github_events")).toHaveLength(1);
    expect(db.rows("project_commits")).toHaveLength(0);
  });

  it("refuses a delivery with no id", async () => {
    const body = JSON.stringify(push());
    const res = await request(app)
      .post("/webhooks/github")
      .set("content-type", "application/json")
      .set("x-github-event", "push")
      .set(
        "x-hub-signature-256",
        `sha256=${createHmac("sha256", SECRET).update(body).digest("hex")}`,
      )
      .send(body);

    expect(res.status).toBe(400);
  });
});
