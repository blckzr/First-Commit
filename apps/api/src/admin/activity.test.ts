import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../app.js";
import { createTestDb, type TestDb } from "@first-commit/test-db";
import { post, patch } from "../test/http.js";
import type { Mailer } from "../mail/index.js";

const silentMailer: Mailer = { name: "test", async send() {} };

/**
 * The activity log (design.md §6.12).
 *
 * §6.12 promises two things, and they are asserted separately because they can
 * fail separately:
 *
 * 1. **The record cannot be changed.** No endpoint edits or deletes an entry,
 *    including the admin's own. The database trigger is the real guard, but
 *    pg-mem does not run triggers — so what is asserted *here* is the API
 *    surface: there is no route. `npm run db:verify` covers the trigger against
 *    real PostgreSQL.
 * 2. **The record is legible.** A table of uuids is not a record of anything,
 *    so each entry resolves its target to the name a person would use, and the
 *    filters offer the actions that are actually in the log.
 */

let db: TestDb;
let app: Express;
let adminCookie: string;
let learnerCookie: string;
let adminId: string;

const one = async (sql: string, params: unknown[] = []) =>
  (await db.pool.query<{ id: string }>(sql, params)).rows[0].id;

const log = (
  action: string,
  targetType: string,
  targetId: string | null,
  over: Record<string, unknown> = {},
) =>
  db.pool.query(
    `insert into admin_activity_log (admin_id, action, target_type, target_id, reason, details, created_at)
     values ($1, $2, $3, $4, $5, $6, coalesce($7::timestamptz, now()))`,
    [
      over.adminId ?? adminId,
      action,
      targetType,
      targetId,
      over.reason ?? null,
      JSON.stringify(over.details ?? {}),
      over.createdAt ?? null,
    ],
  );

const read = (query = "") =>
  request(app).get(`/admin/log${query}`).set("Cookie", adminCookie);

beforeEach(async () => {
  db = createTestDb();
  app = createApp({ pool: db.pool, mailer: silentMailer });

  const learner = await post(app, "/auth/signup").send({
    fullName: "A Learner",
    email: "learner@example.com",
    password: "a-good-password",
  });
  learnerCookie = (learner.headers["set-cookie"] as unknown as string[])[0].split(";")[0];

  const admin = await post(app, "/auth/signup").send({
    fullName: "An Admin",
    email: "admin@example.com",
    password: "a-good-password",
  });
  adminCookie = (admin.headers["set-cookie"] as unknown as string[])[0].split(";")[0];
  // §6 rule 8: no endpoint sets `users.role`.
  await db.pool.query(`update users set role = 'admin' where email = 'admin@example.com'`);
  adminId = (
    await db.pool.query<{ id: string }>(`select id from users where email = 'admin@example.com'`)
  ).rows[0].id;
});

describe("§6.12 — the record cannot be changed", () => {
  /**
   * **There is no route, not a route that refuses.** An endpoint that exists
   * and declines is one `if` away from an endpoint that does not, and §6.12's
   * promise is "no admin can edit or delete entries, including their own".
   */
  it("has no endpoint that edits an entry", async () => {
    await log("certificate.revoked", "certificate", null);
    const id = db.rows("admin_activity_log")[0].id;

    const res = await patch(app, `/admin/log/${id}`)
      .set("Cookie", adminCookie)
      .send({ reason: "Changed my mind" });

    expect(res.status).toBe(404);
  });

  it("has no endpoint that deletes one", async () => {
    await log("certificate.revoked", "certificate", null);
    const id = db.rows("admin_activity_log")[0].id;

    const res = await request(app)
      .delete(`/admin/log/${id}`)
      .set("Cookie", adminCookie)
      .set("Origin", "http://localhost:5173");

    expect(res.status).toBe(404);
    expect(db.rows("admin_activity_log")).toHaveLength(1);
  });

  /** §6.1 step 5: 404, not 403 — a 403 confirms the route exists. */
  it("answers 404 to a learner", async () => {
    expect((await request(app).get("/admin/log").set("Cookie", learnerCookie)).status).toBe(404);
    expect(
      (await request(app).get("/admin/log/filters").set("Cookie", learnerCookie)).status,
    ).toBe(404);
  });
});

describe("reading the log", () => {
  it("returns newest first with the admin named", async () => {
    await log("module_version.published", "module_version", null);
    await log("certificate.revoked", "certificate", null, { reason: "Plagiarised" });

    const res = await read();

    expect(res.status).toBe(200);
    expect(res.body.entries[0].action).toBe("certificate.revoked");
    expect(res.body.entries[0].reason).toBe("Plagiarised");
    expect(res.body.entries[0].admin.fullName).toBe("An Admin");
  });

  /**
   * Paging on `id`, not on `created_at`.
   *
   * Two rows written in one transaction share a timestamp — revoking a
   * certificate after an integrity ruling does exactly that — so a cursor on
   * the timestamp would show one of them twice or neither. Every row here is
   * given the **same** `created_at` on purpose: that is the case that breaks a
   * timestamp cursor, and a test with distinct times would pass either way.
   */
  it("pages without repeating or losing a row at a shared timestamp", async () => {
    const at = "2026-10-01T12:00:00Z";
    for (let i = 0; i < 120; i += 1) {
      await log(`action.${i}`, "module", null, { createdAt: at });
    }

    const first = await read();
    expect(first.body.entries).toHaveLength(50);
    expect(first.body.nextBefore).not.toBeNull();

    const second = await read(`?before=${first.body.nextBefore}`);
    const third = await read(`?before=${second.body.nextBefore}`);

    const seen = [...first.body.entries, ...second.body.entries, ...third.body.entries].map(
      (e: { action: string }) => e.action,
    );
    expect(seen).toHaveLength(120);
    expect(new Set(seen).size).toBe(120);
    expect(third.body.nextBefore).toBeNull();
  });
});

describe("filters", () => {
  beforeEach(async () => {
    await log("module_version.published", "module_version", null, {
      createdAt: "2026-01-15T00:00:00Z",
    });
    await log("certificate.revoked", "certificate", null, {
      createdAt: "2026-06-15T00:00:00Z",
    });
  });

  it("filters by action", async () => {
    const res = await read("?action=certificate.revoked");

    expect(res.body.entries).toHaveLength(1);
    expect(res.body.entries[0].action).toBe("certificate.revoked");
  });

  it("filters by date range", async () => {
    const res = await read("?from=2026-05-01&to=2026-07-01");

    expect(res.body.entries).toHaveLength(1);
    expect(res.body.entries[0].action).toBe("certificate.revoked");
  });

  it("filters by admin", async () => {
    const other = await one(
      `insert into users (email, password_hash, full_name, role)
       values ('other@example.com','x','Other Admin','admin') returning id`,
    );
    await log("setting.changed", "platform_setting", null, { adminId: other });

    const res = await read(`?admin=${other}`);

    expect(res.body.entries).toHaveLength(1);
    expect(res.body.entries[0].admin.fullName).toBe("Other Admin");
  });

  /**
   * **A filter that ignores its own input is worse than one that refuses.** It
   * shows the wrong rows and tells the admin they are the right ones.
   */
  it("refuses a date it cannot read rather than dropping it", async () => {
    const res = await read("?from=last%20Tuesday");

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/as a date/i);
  });

  it("refuses a range that ends before it starts", async () => {
    const res = await read("?from=2026-06-01&to=2026-01-01");

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/after its end/i);
  });

  /** The filter offers what is in the log, not a list someone has to maintain. */
  it("offers the actions and admins actually present", async () => {
    const res = await request(app).get("/admin/log/filters").set("Cookie", adminCookie);

    expect(res.body.actions.map((a: { action: string }) => a.action)).toEqual([
      "certificate.revoked",
      "module_version.published",
    ]);
    expect(res.body.admins).toHaveLength(1);
    expect(res.body.admins[0].fullName).toBe("An Admin");
  });
});

describe("targets read as names", () => {
  /**
   * The reason this resolution exists at all: "module_version /
   * 3f2a8c91-…" tells an admin nothing about what was published.
   *
   * Asserted against the **title**, not merely against a non-null label — a
   * label built from the wrong column would still be a string.
   */
  it("names a published module version", async () => {
    const skillId = await one(
      `insert into skills (slug, name) values ('js','JavaScript') returning id`,
    );
    const moduleId = await one(
      `insert into modules (skill_id, kind, slug, status)
       values ($1,'core','js-basics','published') returning id`,
      [skillId],
    );
    const versionId = await one(
      `insert into module_versions (module_id, version_no, title, status)
       values ($1, 3, 'JavaScript basics', 'published') returning id`,
      [moduleId],
    );
    await log("module_version.published", "module_version", versionId);

    const res = await read();

    expect(res.body.entries[0].target.label).toBe("JavaScript basics (version 3)");
  });

  it("names the learner a certificate belongs to", async () => {
    const learnerId = (
      await db.pool.query<{ id: string }>(
        `select id from users where email = 'learner@example.com'`,
      )
    ).rows[0].id;
    const pathId = await one(
      `insert into career_paths (slug, title, status) values ('jwd','JWD','published') returning id`,
    );
    const roadmapId = await one(
      `insert into roadmaps (user_id, career_path_id, status) values ($1,$2,'active') returning id`,
      [learnerId, pathId],
    );
    const certificateId = await one(
      `insert into certificates (public_code, user_id, type, roadmap_id, recipient_name, title)
       values ('FC-7K2M-94QX', $1, 'completion', $2, 'A Learner', 'Junior Web Developer')
       returning id`,
      [learnerId, roadmapId],
    );
    await log("certificate.revoked", "certificate", certificateId, { reason: "Plagiarised" });

    const res = await read();

    expect(res.body.entries[0].target.label).toBe("A Learner — FC-7K2M-94QX");
  });

  /**
   * **An unknown target type is not an error.** The screen falls back to the
   * raw type and id, which is honest and still useful; failing the whole page
   * because one row names something this file has not met would make the log
   * less readable the more the platform grew.
   */
  it("returns no label for a type it does not know, and does not fail", async () => {
    await log("something.happened", "a_table_from_the_future", null);

    const res = await read();

    expect(res.status).toBe(200);
    expect(res.body.entries[0].target.label).toBeNull();
    expect(res.body.entries[0].target.type).toBe("a_table_from_the_future");
  });

  /** A setting is keyed by text, so the key travels in the details. */
  it("carries a setting's key in the details", async () => {
    await log("setting.changed", "platform_setting", null, {
      details: { key: "passing_score_default", from: 70, to: 75 },
    });

    const res = await read();

    expect(res.body.entries[0].details.key).toBe("passing_score_default");
    expect(res.body.entries[0].target.id).toBeNull();
  });
});
