import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../app.js";
import { createTestDb, type TestDb } from "@first-commit/test-db";
import { post } from "../test/http.js";
import type { Mailer } from "../mail/index.js";

const silentMailer: Mailer = { name: "test", async send() {} };

/**
 * Certificate administration (§6.7).
 *
 * Revoking was SQL by hand until this existed, which meant the one admin action
 * that **takes something away from a learner** was the only one with no audit
 * trail.
 *
 * The boundary tested hardest here is §6 rule 1 from the other direction: an
 * admin may withdraw a certificate the platform granted, and may never grant
 * one. There is no issue endpoint to test, and that absence is the point.
 */

let db: TestDb;
let app: Express;
let adminCookie: string;
let learnerCookie: string;
let learnerId: string;
let certificateId: string;
let roadmapId: string;

const asAdmin = (path: string) => request(app).get(path).set("Cookie", adminCookie);

const revoke = (id: string, body: unknown, cookie = adminCookie) =>
  request(app)
    .patch(`/admin/certificates/${id}/revoke`)
    .set("Cookie", cookie)
    .set("Origin", "http://localhost:5173")
    .send(body as object);

beforeEach(async () => {
  db = createTestDb();
  app = createApp({ pool: db.pool, mailer: silentMailer });

  const learner = await post(app, "/auth/signup").send({
    fullName: "Jan Kevin Gerona",
    email: "learner@example.com",
    password: "a-good-password",
  });
  learnerCookie = (learner.headers["set-cookie"] as unknown as string[])[0].split(";")[0];
  learnerId = (
    await db.pool.query<{ id: string }>(`select id from users where email = 'learner@example.com'`)
  ).rows[0].id;

  const admin = await post(app, "/auth/signup").send({
    fullName: "An Admin",
    email: "admin@example.com",
    password: "a-good-password",
  });
  adminCookie = (admin.headers["set-cookie"] as unknown as string[])[0].split(";")[0];
  // §6 rule 8: no endpoint sets `users.role`.
  await db.pool.query(`update users set role = 'admin' where email = 'admin@example.com'`);

  const path = (
    await db.pool.query<{ id: string }>(
      `insert into career_paths (slug, title, status) values ('jwd','JWD','published') returning id`,
    )
  ).rows[0].id;
  roadmapId = (
    await db.pool.query<{ id: string }>(
      `insert into roadmaps (user_id, career_path_id, status) values ($1,$2,'active') returning id`,
      [learnerId, path],
    )
  ).rows[0].id;
  certificateId = (
    await db.pool.query<{ id: string }>(
      `insert into certificates (public_code, user_id, type, roadmap_id, recipient_name, title)
       values ('FC-7K2M-94QX',$1,'completion',$2,'Jan Kevin Gerona','Junior Web Developer')
       returning id`,
      [learnerId, roadmapId],
    )
  ).rows[0].id;
});

describe("looking certificates up", () => {
  it("lists them for an admin", async () => {
    const res = await asAdmin("/admin/certificates");

    expect(res.status).toBe(200);
    expect(res.body.certificates).toHaveLength(1);
    expect(res.body.certificates[0].publicCode).toBe("FC-7K2M-94QX");
    expect(res.body.certificates[0].learner.email).toBe("learner@example.com");
  });

  it("finds one by its public code", async () => {
    const res = await asAdmin("/admin/certificates?q=7K2M");
    expect(res.body.certificates).toHaveLength(1);
  });

  it("finds one by the learner's email", async () => {
    const res = await asAdmin("/admin/certificates?q=learner@example.com");
    expect(res.body.certificates).toHaveLength(1);
  });

  /** 404, not 403 — a 403 confirms the route exists (§6.1 step 5). */
  it("refuses a learner with a 404", async () => {
    expect((await request(app).get("/admin/certificates").set("Cookie", learnerCookie)).status).toBe(
      404,
    );
  });

  it("refuses without a session", async () => {
    expect((await request(app).get("/admin/certificates")).status).toBe(401);
  });
});

describe("revoking", () => {
  it("withdraws it and logs the reason", async () => {
    const res = await revoke(certificateId, { reason: "The repository was copied wholesale." });

    expect(res.status).toBe(200);

    const certificate = db.rows("certificates")[0];
    expect(certificate.status).toBe("revoked");
    expect(certificate.revoked_reason).toMatch(/copied wholesale/i);
    expect(certificate.revoked_at).toBeTruthy();

    // §6.1 step 5: the action and its log entry are one transaction.
    const logged = db.rows("admin_activity_log");
    expect(logged).toHaveLength(1);
    expect(logged[0].action).toBe("certificate.revoked");
  });

  /**
   * §6 rule 10, and the schema's own
   * `check ((status = 'revoked') = (revoked_reason is not null))`. Two places
   * saying the same thing on purpose.
   */
  it("refuses a revocation with no reason", async () => {
    const res = await revoke(certificateId, {});

    expect(res.status).toBe(400);
    expect(db.rows("certificates")[0].status).toBe("valid");
    expect(db.rows("admin_activity_log")).toHaveLength(0);
  });

  it("refuses an empty reason", async () => {
    const res = await revoke(certificateId, { reason: "   " });
    expect(res.status).toBe(400);
    expect(db.rows("certificates")[0].status).toBe("valid");
  });

  it("refuses a learner's revocation", async () => {
    const res = await revoke(certificateId, { reason: "I changed my mind" }, learnerCookie);

    expect(res.status).toBe(404);
    expect(db.rows("certificates")[0].status).toBe("valid");
  });

  /** Revoking twice is not two events. The second is a 404, not a second log row. */
  it("does not revoke an already-revoked certificate again", async () => {
    await revoke(certificateId, { reason: "First reason" });
    const again = await revoke(certificateId, { reason: "Second reason" });

    expect(again.status).toBe(404);
    expect(db.rows("certificates")[0].revoked_reason).toBe("First reason");
    expect(db.rows("admin_activity_log")).toHaveLength(1);
  });

  /**
   * §6 rule 5: nothing a learner depends on is hard-deleted. The code survives,
   * so whoever holds the link gets "this was withdrawn" rather than a 404 that
   * could mean anything.
   */
  it("keeps the certificate and its public code", async () => {
    await revoke(certificateId, { reason: "Withdrawn" });

    expect(db.rows("certificates")).toHaveLength(1);
    expect(db.rows("certificates")[0].public_code).toBe("FC-7K2M-94QX");
  });

  /** §5.15 shows the date on the public page and deliberately not the reason. */
  it("does not put the reason on the public verification page", async () => {
    await revoke(certificateId, { reason: "Plagiarised from another learner" });

    const res = await request(app).get("/verify/FC-7K2M-94QX");

    expect(res.status).toBe(200);
    expect(res.body.result.status).toBe("revoked");
    expect(JSON.stringify(res.body)).not.toMatch(/plagiarised/i);
  });

  /**
   * **There is no endpoint that issues a certificate** (§6 rule 1), and this
   * asserts the admin surface did not quietly become one.
   */
  it("offers no way to issue or un-revoke one", async () => {
    await revoke(certificateId, { reason: "Withdrawn" });

    const unrevoke = await request(app)
      .patch(`/admin/certificates/${certificateId}/revoke`)
      .set("Cookie", adminCookie)
      .set("Origin", "http://localhost:5173")
      .send({ reason: "Actually it was fine", status: "valid" });

    // `.strict()` refuses the extra field outright rather than ignoring it.
    expect(unrevoke.status).toBe(400);
    expect(db.rows("certificates")[0].status).toBe("revoked");
  });
});
