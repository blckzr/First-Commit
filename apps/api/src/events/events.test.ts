import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import type { Server } from "node:http";
import { createApp } from "../app.js";
import { createTestDb, type TestDb } from "../test/db.js";
import { post } from "../test/http.js";
import type { Mailer } from "../mail/index.js";
import { parseCursor } from "./hub.js";
import { hashToken } from "../auth/tokens.js";

const silentMailer: Mailer = { name: "test", async send() {} };

const ACCOUNT = {
  fullName: "Jan Kevin Gerona",
  email: "learner@example.com",
  password: "a-good-password",
};

let db: TestDb;
let app: Express;
let server: Server | null = null;

async function signUp(): Promise<{ cookie: string; userId: string }> {
  const res = await post(app, "/auth/signup").send(ACCOUNT);
  return {
    cookie: (res.headers["set-cookie"] as unknown as string[])[0].split(";")[0],
    userId: res.body.user.id,
  };
}

/** Writes a row the way the worker would. */
async function writeOutput(userId: string, content: unknown): Promise<void> {
  await db.pool.query(
    `insert into ai_outputs (user_id, source_type, source_id, content)
     values ($1, 'code_feedback', gen_random_uuid(), $2)`,
    [userId, content],
  );
}

/**
 * Opens a real SSE connection over a real socket and collects frames until
 * `until` is satisfied. Supertest buffers the whole response, which never
 * completes for a stream, so this uses the server directly.
 */
async function readStream(
  cookie: string,
  until: (text: string) => boolean,
  opts: { lastEventId?: string; afterOpen?: () => Promise<void> } = {},
): Promise<string> {
  const address = server!.address();
  if (typeof address === "string" || !address) throw new Error("no port");

  const headers: Record<string, string> = { Cookie: cookie };
  if (opts.lastEventId) headers["Last-Event-ID"] = opts.lastEventId;

  const res = await fetch(`http://127.0.0.1:${address.port}/events`, { headers });
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("text/event-stream");

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let text = "";

  const deadline = Date.now() + 5000;
  if (opts.afterOpen) {
    // Give the catch-up flush a tick before provoking a live event.
    await new Promise((r) => setTimeout(r, 50));
    await opts.afterOpen();
  }

  while (Date.now() < deadline) {
    const chunk = await Promise.race([
      reader.read(),
      new Promise<{ done: true; value: undefined }>((r) =>
        setTimeout(() => r({ done: true, value: undefined }), 500),
      ),
    ]);
    if (chunk.value) text += decoder.decode(chunk.value, { stream: true });
    if (until(text)) break;
  }

  await reader.cancel().catch(() => {});
  return text;
}

beforeEach(async () => {
  db = createTestDb();
  app = createApp({ pool: db.pool, mailer: silentMailer });
  server = app.listen(0);
  await new Promise((r) => server!.once("listening", r));
});

afterEach(async () => {
  (app.locals.hub as { closeAll(): void }).closeAll();
  await new Promise((r) => server!.close(r));
  server = null;
});

describe("GET /events", () => {
  it("needs a session", async () => {
    const res = await request(app).get("/events");
    expect(res.status).toBe(401);
  });

  it("replays what was written before the stream opened", async () => {
    const { cookie, userId } = await signUp();
    await writeOutput(userId, { summary: "written while offline" });

    const text = await readStream(cookie, (t) => t.includes("written while offline"));
    expect(text).toContain("event: ai_output");
    expect(text).toContain("written while offline");
  });

  it("delivers a row written while the stream is open", async () => {
    const { cookie, userId } = await signUp();

    const text = await readStream(cookie, (t) => t.includes("arrived live"), {
      afterOpen: async () => {
        await writeOutput(userId, { summary: "arrived live" });
        // The worker's notify. Without it the sweep would still find the row,
        // just later than this test is willing to wait.
        await (app.locals.hub as { flush(id: string): Promise<void> }).flush(userId);
      },
    });

    expect(text).toContain("arrived live");
  });

  /**
   * §6.1: the stream is scoped to the session user. This is the test that
   * would catch someone reading a user id from the query string.
   */
  it("never delivers another learner's output", async () => {
    const { cookie } = await signUp();

    const other = await db.pool.query<{ id: string }>(
      `insert into users (email, password_hash, full_name)
       values ('other@example.com','h','Other') returning id`,
    );
    await writeOutput(other.rows[0].id, { summary: "somebody else's feedback" });

    const text = await readStream(cookie, (t) => t.includes("retry:"));
    expect(text).not.toContain("somebody else");
  });

  /**
   * The stream is scoped to the session, so a user id in the query string must
   * be ignored entirely. Without this, reading the id from `req.query` would
   * look correct in every other test.
   */
  it("ignores a user id in the query string", async () => {
    const { cookie } = await signUp();

    const other = await db.pool.query<{ id: string }>(
      `insert into users (email, password_hash, full_name)
       values ('other@example.com','h','Other') returning id`,
    );
    await writeOutput(other.rows[0].id, { summary: "somebody else's feedback" });

    const address = server!.address();
    if (typeof address === "string" || !address) throw new Error("no port");

    const res = await fetch(
      `http://127.0.0.1:${address.port}/events?userId=${other.rows[0].id}`,
      { headers: { Cookie: cookie } },
    );
    const reader = res.body!.getReader();

    // Flush for the OTHER learner. If the stream registered under the id from
    // the query string, this is where their feedback would arrive.
    await new Promise((r) => setTimeout(r, 50));
    await (app.locals.hub as { flush(id: string): Promise<void> }).flush(other.rows[0].id);
    await new Promise((r) => setTimeout(r, 200));

    let text = "";
    const chunk = await Promise.race([
      reader.read(),
      new Promise<{ value: undefined }>((r) => setTimeout(() => r({ value: undefined }), 400)),
    ]);
    if (chunk.value) text += new TextDecoder().decode(chunk.value);
    await reader.cancel().catch(() => {});

    expect(text).not.toContain("somebody else");
  });

  /**
   * Two streams open at once, from different learners. A flush for one must
   * reach only that one — with a single connection open, a hub that ignored
   * its user filter would look identical.
   */
  it("does not fan a flush out to another learner's open stream", async () => {
    const { cookie: mine } = await signUp();

    const other = await db.pool.query<{ id: string }>(
      `insert into users (email, password_hash, full_name)
       values ('other@example.com','h','Other') returning id`,
    );
    const otherId = other.rows[0].id;
    await db.pool.query(
      `insert into sessions (user_id, token_hash, expires_at)
       values ($1, $2, now() + interval '1 day')`,
      [otherId, hashToken("other-token")],
    );
    await writeOutput(otherId, { summary: "for the other learner" });

    const address = server!.address();
    if (typeof address === "string" || !address) throw new Error("no port");

    // My stream stays open while the other learner's rows are flushed.
    const res = await fetch(`http://127.0.0.1:${address.port}/events`, {
      headers: { Cookie: mine },
    });
    const reader = res.body!.getReader();

    await new Promise((r) => setTimeout(r, 50));
    await (app.locals.hub as { flush(id: string): Promise<void> }).flush(otherId);
    await new Promise((r) => setTimeout(r, 200));

    let text = "";
    const chunk = await Promise.race([
      reader.read(),
      new Promise<{ value: undefined }>((r) => setTimeout(() => r({ value: undefined }), 400)),
    ]);
    if (chunk.value) text += new TextDecoder().decode(chunk.value);
    await reader.cancel().catch(() => {});

    expect(text).not.toContain("for the other learner");
  });

  /**
   * Two rows can share a timestamp. Comparing on the timestamp alone would
   * silently drop one of them on resume.
   */
  it("delivers both rows when two share a created_at", async () => {
    const { cookie, userId } = await signUp();
    const at = new Date("2026-09-21T10:00:00.000Z");

    await db.pool.query(
      `insert into ai_outputs (user_id, source_type, source_id, content, created_at)
       values ($1,'code_feedback',gen_random_uuid(),$2,$3),
              ($1,'code_feedback',gen_random_uuid(),$4,$3)`,
      [userId, { summary: "same-instant A" }, at, { summary: "same-instant B" }],
    );

    // Resume from the lower-sorting of the two, so the cursor comparison has
    // to break the tie on id. With no cursor this path is never exercised.
    const { rows } = await db.pool.query<{ id: string }>(
      `select id from ai_outputs where user_id = $1 order by id`,
      [userId],
    );
    const lastEventId = `${at.toISOString()}|${rows[0].id}`;

    const text = await readStream(cookie, (t) => t.includes("same-instant"), { lastEventId });

    // Exactly the other row, and not the one we resumed from.
    expect(text).toContain(rows[1].id);
    expect(text).not.toContain(rows[0].id);
  });

  it("carries an event id the browser can resume from", async () => {
    const { cookie, userId } = await signUp();
    await writeOutput(userId, { summary: "first" });

    const text = await readStream(cookie, (t) => t.includes("first"));
    const id = /^id: (.+)$/m.exec(text)![1];

    const cursor = parseCursor(id);
    expect(cursor).not.toBeNull();
    expect(cursor!.id).toBeTruthy();
  });

  it("resumes from Last-Event-ID without repeating what was already sent", async () => {
    const { cookie, userId } = await signUp();
    await writeOutput(userId, { summary: "first" });

    const first = await readStream(cookie, (t) => t.includes("first"));
    const lastId = /^id: (.+)$/m.exec(first)![1];

    await writeOutput(userId, { summary: "second" });

    const second = await readStream(cookie, (t) => t.includes("second"), { lastEventId: lastId });
    expect(second).toContain("second");
    expect(second).not.toContain("first");
  });
});

describe("POST /internal/events", () => {
  it("accepts the worker's secret", async () => {
    const { userId } = await signUp();
    const res = await request(app)
      .post("/internal/events")
      .set("x-worker-secret", "test-worker-secret")
      .send({ userId });
    expect(res.status).toBe(202);
  });

  it("refuses a caller with no secret", async () => {
    const { userId } = await signUp();
    const res = await request(app).post("/internal/events").send({ userId });
    expect(res.status).toBe(401);
  });

  it("refuses a caller with the wrong secret", async () => {
    const { userId } = await signUp();
    const res = await request(app)
      .post("/internal/events")
      .set("x-worker-secret", "not-the-secret")
      .send({ userId });
    expect(res.status).toBe(401);
  });

  it("refuses a secret that is merely a prefix of the real one", async () => {
    const { userId } = await signUp();
    const res = await request(app)
      .post("/internal/events")
      .set("x-worker-secret", "test-worker-secre")
      .send({ userId });
    expect(res.status).toBe(401);
  });

  /**
   * The worker sends no Origin, so this route has to sit outside the CSRF
   * guard — otherwise every notification would be refused. A 403 here would
   * mean the mounting order regressed.
   */
  it("is closed entirely when no worker secret is configured", async () => {
    const closed = createApp({ pool: db.pool, mailer: silentMailer, workerSecret: null });
    const { userId } = await signUp();

    const withSecret = await request(closed)
      .post("/internal/events")
      .set("x-worker-secret", "test-worker-secret")
      .send({ userId });
    expect(withSecret.status).toBe(404);

    const without = await request(closed).post("/internal/events").send({ userId });
    expect(without.status).toBe(404);
  });

  it("is not behind the CSRF guard", async () => {
    const { userId } = await signUp();
    const res = await request(app)
      .post("/internal/events")
      .set("x-worker-secret", "not-the-secret")
      .send({ userId });
    expect(res.status).not.toBe(403);
  });
});

describe("cursor parsing", () => {
  it("round-trips a well-formed id", () => {
    const cursor = parseCursor("2026-09-21T10:00:00.000Z|abc-123");
    expect(cursor).toEqual({ createdAt: new Date("2026-09-21T10:00:00.000Z"), id: "abc-123" });
  });

  it.each([undefined, "", "no-separator", "|", "not-a-date|abc"])(
    "rejects %s rather than throwing",
    (value) => {
      expect(parseCursor(value as string | undefined)).toBeNull();
    },
  );
});
