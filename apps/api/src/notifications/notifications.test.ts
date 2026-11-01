import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../app.js";
import { createTestDb, type TestDb } from "@first-commit/test-db";
import { post, patch } from "../test/http.js";
import type { Mailer } from "../mail/index.js";
import { notify } from "./notify.js";

const silentMailer: Mailer = { name: "test", async send() {} };

/**
 * Notifications (design.md §5.17).
 *
 * The table existed from the first migration and **nothing wrote to it** until
 * now, so four features worked around it: §6.6 rejected a project without
 * telling the learner, a certificate was earned in silence, §5.6's Updates panel
 * derived its contents, and §5.17 had no data at all.
 *
 * What is tested hardest is the ownership filter. A notification names what a
 * learner earned or had withdrawn, so another learner's list is exactly what the
 * API serves by mistake when a filter is forgotten (§6.1 steps 3 and 4).
 */

let db: TestDb;
let app: Express;
let aCookie: string;
let bCookie: string;
let aId: string;
let bId: string;

const signUp = async (email: string) => {
  const res = await post(app, "/auth/signup").send({
    fullName: "A Learner",
    email,
    password: "a-good-password",
  });
  const cookie = (res.headers["set-cookie"] as unknown as string[])[0].split(";")[0];
  const id = (
    await db.pool.query<{ id: string }>(`select id from users where email = $1`, [email])
  ).rows[0].id;
  return { cookie, id };
};

beforeEach(async () => {
  db = createTestDb();
  app = createApp({ pool: db.pool, mailer: silentMailer });

  ({ cookie: aCookie, id: aId } = await signUp("a@example.com"));
  ({ cookie: bCookie, id: bId } = await signUp("b@example.com"));
});

const list = (cookie: string) => request(app).get("/notifications").set("Cookie", cookie);

describe("reading the list", () => {
  it("returns a learner's own notifications, newest first", async () => {
    await notify(db.pool, { userId: aId, type: "account_notice", title: "First" });
    await notify(db.pool, { userId: aId, type: "account_notice", title: "Second" });

    const res = await list(aCookie);

    expect(res.status).toBe(200);
    expect(res.body.notifications.map((n: { title: string }) => n.title)).toEqual([
      "Second",
      "First",
    ]);
  });

  /** §6.1 step 3: filtered by the id on the session, never one from the request. */
  it("never returns another learner's notifications", async () => {
    await notify(db.pool, { userId: bId, type: "account_notice", title: "B's business" });

    const res = await list(aCookie);

    expect(res.body.notifications).toEqual([]);
    expect(res.body.unreadCount).toBe(0);
  });

  it("requires a session", async () => {
    expect((await request(app).get("/notifications")).status).toBe(401);
  });

  it("carries the link and the body through", async () => {
    await notify(db.pool, {
      userId: aId,
      type: "project_rejected",
      title: "Your capstone project was not accepted",
      body: "The repository was copied.",
      link: "/app/capstone",
    });

    const [first] = (await list(aCookie)).body.notifications;
    expect(first.body).toBe("The repository was copied.");
    expect(first.link).toBe("/app/capstone");
    expect(first.readAt).toBeNull();
  });

  /**
   * The unread count is its own query, not a count of the returned page.
   * The page is capped at 50, so counting it would show "50" to a learner with
   * sixty unread and the badge would quietly stop counting.
   */
  it("counts every unread notification, not just the page", async () => {
    for (let i = 0; i < 55; i++) {
      await notify(db.pool, { userId: aId, type: "account_notice", title: `n${i}` });
    }

    const res = await list(aCookie);

    expect(res.body.notifications).toHaveLength(50);
    expect(res.body.unreadCount).toBe(55);
  });
});

describe("marking read", () => {
  it("marks one read and drops the unread count", async () => {
    const { id } = await notify(db.pool, {
      userId: aId,
      type: "account_notice",
      title: "Read me",
    });

    const res = await patch(app, `/notifications/${id}/read`).set("Cookie", aCookie).send({});

    expect(res.status).toBe(200);
    expect((await list(aCookie)).body.unreadCount).toBe(0);
  });

  /**
   * **§6.1 step 4, and the one worth mutation-testing.** Without the `user_id`
   * clause this writes to another learner's row given only its id. It is not a
   * read leak, which is what makes it easy to miss.
   */
  it("will not mark another learner's notification read", async () => {
    const { id } = await notify(db.pool, {
      userId: bId,
      type: "account_notice",
      title: "B's business",
    });

    await patch(app, `/notifications/${id}/read`).set("Cookie", aCookie).send({});

    const row = await db.pool.query<{ read_at: Date | null }>(
      `select read_at from notifications where id = $1`,
      [id],
    );
    expect(row.rows[0].read_at).toBeNull();
  });

  /** §5.17 lets a learner mark read from the list and by opening the item. */
  it("treats marking an already-read notification as fine", async () => {
    const { id } = await notify(db.pool, {
      userId: aId,
      type: "account_notice",
      title: "Read me",
    });

    await patch(app, `/notifications/${id}/read`).set("Cookie", aCookie).send({});
    const again = await patch(app, `/notifications/${id}/read`)
      .set("Cookie", aCookie)
      .send({});

    expect(again.status).toBe(200);
  });

  it("answers 404 for an id that is not a uuid", async () => {
    const res = await patch(app, "/notifications/not-a-uuid/read").set("Cookie", aCookie).send({});
    expect(res.status).toBe(404);
  });

  it("marks all read for the session user only", async () => {
    await notify(db.pool, { userId: aId, type: "account_notice", title: "Mine" });
    await notify(db.pool, { userId: bId, type: "account_notice", title: "Theirs" });

    const res = await post(app, "/notifications/read-all").set("Cookie", aCookie).send({});

    expect(res.body.marked).toBe(1);
    expect((await list(aCookie)).body.unreadCount).toBe(0);
    expect((await list(bCookie)).body.unreadCount).toBe(1);
  });

  /**
   * With a valid origin and no cookie this reaches `requireAuth`. Sent without
   * an `Origin` it is a 403 from the CSRF guard instead — also correct, but it
   * would prove the guard rather than the session check.
   */
  it("requires a session to mark all read", async () => {
    expect((await post(app, "/notifications/read-all").send({})).status).toBe(401);
  });
});

/**
 * §6 rule 1 from a new angle: a notification is a *message about* evidence, and
 * must never be a way to create any. Nothing here accepts one from a browser.
 */
describe("what the browser cannot do", () => {
  it("offers no endpoint that creates a notification", async () => {
    const res = await post(app, "/notifications")
      .set("Cookie", aCookie)
      .send({ type: "certificate_earned", title: "I earned this" });

    expect([404, 405]).toContain(res.status);
    expect((await list(aCookie)).body.notifications).toEqual([]);
  });
});
