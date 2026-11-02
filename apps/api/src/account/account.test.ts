import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { readFileSync } from "node:fs";
import { createApp } from "../app.js";
import { createTestDb, type TestDb } from "@first-commit/test-db";
import { post } from "../test/http.js";
import type { Mailer, MailMessage } from "../mail/index.js";
import { config } from "../config.js";

/**
 * The account (design.md §5.18).
 *
 * Most of this file is about what a settings screen must **not** be able to do:
 * read somebody else's record, hand the learner their own credentials back,
 * carry a secret out through an export, or change a role. The screen itself is
 * four forms; the tests are the part worth reading.
 */

let db: TestDb;
let app: Express;
let sent: MailMessage[];
let cookie: string;
let learnerId: string;

const mailer: Mailer = {
  name: "test",
  async send(message) {
    sent.push(message);
  },
};

const read = (path: string) => request(app).get(path).set("Cookie", cookie);
const write = (method: "put" | "patch" | "delete", path: string) =>
  request(app)[method](path).set("Cookie", cookie).set("Origin", config.appOrigin);

async function signUp(email: string, password = "a-good-password", fullName = "Jan Kevin Gerona") {
  const res = await post(app, "/auth/signup").send({ fullName, email, password });
  return {
    cookie: (res.headers["set-cookie"] as unknown as string[])[0].split(";")[0],
    id: (await db.pool.query<{ id: string }>(`select id from users where email = $1`, [email]))
      .rows[0].id,
  };
}

beforeEach(async () => {
  db = createTestDb();
  app = createApp({ pool: db.pool, mailer });
  sent = [];

  const learner = await signUp("learner@example.com");
  cookie = learner.cookie;
  learnerId = learner.id;
  sent = [];
});

/** A career path, roadmap and certificate for this learner. */
async function giveCertificate(userId: string, code = "FC-7K2M-94QX") {
  const one = async (sql: string, v: unknown[] = []) =>
    (await db.pool.query<{ id: string }>(sql, v)).rows[0].id;

  const pathId = await one(
    `insert into career_paths (slug, title, status)
     values ('jwd-' || $1, 'Junior Web Developer', 'published') returning id`,
    [code],
  );
  const roadmapId = await one(
    `insert into roadmaps (user_id, career_path_id) values ($1,$2) returning id`,
    [userId, pathId],
  );
  await db.pool.query(
    `insert into certificates (public_code, user_id, type, roadmap_id, recipient_name, title)
     values ($1,$2,'completion',$3,$4,'Junior Web Developer')`,
    [code, userId, roadmapId, "Jan Kevin Gerona"],
  );
  return { pathId, roadmapId };
}

describe("reading the account", () => {
  it("returns the signed-in learner's own details", async () => {
    const res = await read("/account");

    expect(res.status).toBe(200);
    expect(res.body.fullName).toBe("Jan Kevin Gerona");
    expect(res.body.email).toBe("learner@example.com");
    expect(res.body.emailVerified).toBe(false);
  });

  it("never returns the password hash", async () => {
    const res = await read("/account");
    expect(JSON.stringify(res.body)).not.toMatch(/\$argon2|password_hash|passwordHash/i);
  });

  it("tells the screen a learner can delete their account", async () => {
    const res = await read("/account");
    expect(res.body.canDelete).toBe(true);
  });

  /**
   * The browser must not be the thing that works out whether the delete will
   * succeed — AGENT.md open question 17 is a schema fact, not a UI rule.
   */
  it("tells the screen an admin cannot", async () => {
    const admin = await signUp("admin@example.com");
    await db.pool.query(`update users set role = 'admin' where id = $1`, [admin.id]);

    const res = await request(app).get("/account").set("Cookie", admin.cookie);
    expect(res.body.canDelete).toBe(false);
  });
});

describe("profile", () => {
  it("changes the name", async () => {
    const res = await write("put", "/account/profile").send({
      fullName: "Jan Gerona",
      email: "learner@example.com",
    });

    expect(res.status).toBe(200);
    const { rows } = await db.pool.query<{ full_name: string }>(
      `select full_name from users where id = $1`,
      [learnerId],
    );
    expect(rows[0].full_name).toBe("Jan Gerona");
  });

  /**
   * §5.18 promises the name "appears on new certificates". The test is that an
   * *old* one is untouched: `certificates.recipient_name` is a snapshot taken
   * at issue, and a certificate whose name can be edited afterwards is not
   * evidence of anything.
   */
  it("does not rewrite the name on an already issued certificate", async () => {
    await giveCertificate(learnerId);

    await write("put", "/account/profile")
      .send({ fullName: "Someone Else Entirely", email: "learner@example.com" })
      .expect(200);

    const { rows } = await db.pool.query<{ recipient_name: string }>(
      `select recipient_name from certificates where user_id = $1`,
      [learnerId],
    );
    expect(rows[0].recipient_name).toBe("Jan Kevin Gerona");
  });

  it("refuses an empty name", async () => {
    const res = await write("put", "/account/profile").send({
      fullName: "   ",
      email: "learner@example.com",
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/name you want on your certificates/i);
  });

  it("refuses an address that is not one", async () => {
    const res = await write("put", "/account/profile").send({
      fullName: "Jan",
      email: "not-an-address",
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/you@example\.com/);
  });

  describe("changing the email", () => {
    it("un-verifies the address and sends a new link", async () => {
      await db.pool.query(`update users set email_verified_at = now() where id = $1`, [learnerId]);

      const res = await write("put", "/account/profile").send({
        fullName: "Jan Kevin Gerona",
        email: "new@example.com",
      });

      expect(res.status).toBe(200);
      expect(res.body.emailChanged).toBe(true);
      expect(res.body.verificationSent).toBe(true);

      const { rows } = await db.pool.query<{ email: string; email_verified_at: Date | null }>(
        `select email, email_verified_at from users where id = $1`,
        [learnerId],
      );
      expect(rows[0].email).toBe("new@example.com");
      // The whole point: verified must not survive the move.
      expect(rows[0].email_verified_at).toBeNull();
      expect(sent).toHaveLength(1);
      expect(sent[0].to).toBe("new@example.com");
    });

    it("leaves a verified address verified when only the name changes", async () => {
      await db.pool.query(`update users set email_verified_at = now() where id = $1`, [learnerId]);

      await write("put", "/account/profile")
        .send({ fullName: "Jan Gerona", email: "learner@example.com" })
        .expect(200);

      const { rows } = await db.pool.query<{ email_verified_at: Date | null }>(
        `select email_verified_at from users where id = $1`,
        [learnerId],
      );
      expect(rows[0].email_verified_at).not.toBeNull();
      expect(sent).toHaveLength(0);
    });

    it("treats a change of letter case as no change at all", async () => {
      await db.pool.query(`update users set email_verified_at = now() where id = $1`, [learnerId]);

      const res = await write("put", "/account/profile").send({
        fullName: "Jan Kevin Gerona",
        email: "LEARNER@example.com",
      });

      expect(res.body.emailChanged).toBe(false);
      expect(sent).toHaveLength(0);
    });

    it("refuses an address another account already has", async () => {
      await signUp("taken@example.com");

      const res = await write("put", "/account/profile").send({
        fullName: "Jan Kevin Gerona",
        email: "taken@example.com",
      });

      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/already in use/i);
    });

    it("refuses it whatever case it is written in", async () => {
      await signUp("taken@example.com");

      const res = await write("put", "/account/profile").send({
        fullName: "Jan Kevin Gerona",
        email: "TAKEN@Example.com",
      });

      expect(res.status).toBe(409);
    });

    it("saves nothing when the address is refused", async () => {
      await signUp("taken@example.com");

      await write("put", "/account/profile")
        .send({ fullName: "Changed Name", email: "taken@example.com" })
        .expect(409);

      const { rows } = await db.pool.query<{ full_name: string }>(
        `select full_name from users where id = $1`,
        [learnerId],
      );
      expect(rows[0].full_name).toBe("Jan Kevin Gerona");
    });
  });

  /**
   * §6 rule 8. The schema default is 'learner' and nothing may move it, so the
   * body is `.strict()` — an unexpected key is refused rather than ignored,
   * because ignoring it is how a field becomes accepted later by accident.
   */
  it("refuses a body that carries a role", async () => {
    const res = await write("put", "/account/profile").send({
      fullName: "Jan",
      email: "learner@example.com",
      role: "admin",
    });

    expect(res.status).toBe(400);
    const { rows } = await db.pool.query<{ role: string }>(
      `select role from users where id = $1`,
      [learnerId],
    );
    expect(rows[0].role).toBe("learner");
  });

  it("refuses a body that carries a status", async () => {
    const res = await write("put", "/account/profile").send({
      fullName: "Jan",
      email: "learner@example.com",
      status: "suspended",
    });

    expect(res.status).toBe(400);
  });

  /**
   * The `.strict()` schema above only covers the keys a test thought to send.
   * This covers the rest of the module — the same pairing `admin/users.test.ts`
   * uses, and for the same reason. Comments are stripped first so the file's
   * own documentation of the rule cannot satisfy it.
   */
  it("never writes the role column anywhere in the module", () => {
    const code = readFileSync(new URL("./routes.ts", import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*/g, "");

    expect(code).not.toMatch(/set\s+role/i);
    expect(code).not.toMatch(/update\s+users\s+set[^;]*\brole\b/i);
  });
});

describe("changing the password", () => {
  const change = (body: Record<string, unknown>) =>
    write("put", "/account/password").send(body);

  it("changes it when the current one is right", async () => {
    const res = await change({
      currentPassword: "a-good-password",
      newPassword: "a-better-password",
    });

    expect(res.status).toBe(200);

    // Proved by logging in with it, not by reading the column.
    const login = await post(app, "/auth/login").send({
      email: "learner@example.com",
      password: "a-better-password",
    });
    expect(login.status).toBe(200);
  });

  it("refuses the wrong current password", async () => {
    const res = await change({
      currentPassword: "not-the-password",
      newPassword: "a-better-password",
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/current password isn't right/i);

    const login = await post(app, "/auth/login").send({
      email: "learner@example.com",
      password: "a-good-password",
    });
    expect(login.status).toBe(200);
  });

  it("refuses a new password that is the old one", async () => {
    const res = await change({
      currentPassword: "a-good-password",
      newPassword: "a-good-password",
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already have/i);
  });

  it("refuses a short new password", async () => {
    const res = await change({
      currentPassword: "a-good-password",
      newPassword: "short",
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at least 8 characters/i);
  });

  /**
   * §6.3: "Clear sessions on password change." A session obtained with the old
   * password must not outlive it.
   */
  it("ends every other session", async () => {
    const other = await request(app)
      .post("/auth/login")
      .set("Origin", config.appOrigin)
      .send({ email: "learner@example.com", password: "a-good-password" });
    const otherCookie = (other.headers["set-cookie"] as unknown as string[])[0].split(";")[0];

    // It works before the change.
    await request(app).get("/account").set("Cookie", otherCookie).expect(200);

    await change({ currentPassword: "a-good-password", newPassword: "a-better-password" }).expect(
      200,
    );

    await request(app).get("/account").set("Cookie", otherCookie).expect(401);
  });

  /**
   * And the other half, which the sweep alone would break: the browser doing
   * the changing stays signed in. The new session is issued *after* the sweep;
   * issuing it before would delete it along with the rest.
   */
  it("keeps this browser signed in, on a new session", async () => {
    const res = await change({
      currentPassword: "a-good-password",
      newPassword: "a-better-password",
    });

    const issued = res.headers["set-cookie"] as unknown as string[] | undefined;
    expect(issued, "a replacement session cookie").toBeTruthy();

    const replacement = issued![0].split(";")[0];
    expect(replacement).not.toBe(cookie);
    await request(app).get("/account").set("Cookie", replacement).expect(200);
  });

  it("stops after five wrong guesses", async () => {
    for (let i = 0; i < 5; i += 1) {
      await change({ currentPassword: `wrong-${i}`, newPassword: "a-better-password" });
    }

    const res = await change({
      currentPassword: "a-good-password",
      newPassword: "a-better-password",
    });

    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/too many attempts/i);
  });

  /**
   * The bucket is its own. If these failures counted as `login`, an attacker
   * with a stolen session could lock the real owner out of signing in — which
   * is the thing the limit is supposed to prevent, achieved through the limit.
   */
  it("counts failures under its own kind, not login's", async () => {
    await change({ currentPassword: "wrong", newPassword: "a-better-password" });

    const { rows } = await db.pool.query<{ kind: string }>(
      `select kind from auth_attempts where email = 'learner@example.com'`,
    );
    expect(rows.map((r) => r.kind)).toContain("password_change");
    expect(rows.map((r) => r.kind)).not.toContain("login");

    // And the login limit is untouched — five more failures there are still allowed.
    for (let i = 0; i < 4; i += 1) {
      await post(app, "/auth/login").send({
        email: "learner@example.com",
        password: "wrong",
      });
    }
    const login = await post(app, "/auth/login").send({
      email: "learner@example.com",
      password: "a-good-password",
    });
    expect(login.status).toBe(200);
  });
});

describe("downloading my data", () => {
  it("comes back as a file, not a page", async () => {
    const res = await read("/account/export");

    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toMatch(
      /attachment; filename="first-commit-data-\d{4}-\d{2}-\d{2}\.json"/,
    );
  });

  it("contains the learner's own record", async () => {
    await giveCertificate(learnerId);

    const res = await read("/account/export");
    const data = JSON.parse(res.text);

    expect(data.account.email).toBe("learner@example.com");
    expect(data.account.full_name).toBe("Jan Kevin Gerona");
    expect(data.certificates).toHaveLength(1);
    expect(data.certificates[0].public_code).toBe("FC-7K2M-94QX");
    expect(data.roadmaps).toHaveLength(1);
  });

  /** §6.1 step 3 — filtered by the session's id, and there is no other id to send. */
  it("contains nobody else's", async () => {
    const other = await signUp("other@example.com", "a-good-password", "Other Learner");
    await giveCertificate(other.id, "FC-OTHER-0001");

    const res = await read("/account/export");

    expect(res.text).not.toMatch(/other@example\.com/);
    expect(res.text).not.toMatch(/FC-OTHER-0001/);
    expect(JSON.parse(res.text).certificates).toHaveLength(0);
  });

  it("never carries the password hash or a session token", async () => {
    const res = await read("/account/export");

    expect(res.text).not.toMatch(/\$argon2/);
    expect(res.text).not.toMatch(/password_hash/);
    expect(res.text).not.toMatch(/token_hash/);
  });

  /**
   * §6 rule 2 names prompts. `ai_jobs.payload` carries the review checklist and
   * the rubric, so the table is excluded outright and only `ai_outputs` — what
   * the learner was actually shown — is exported.
   */
  it("carries the feedback the learner read, not the prompt behind it", async () => {
    const jobId = (
      await db.pool.query<{ id: string }>(
        `insert into ai_jobs (type, user_id, payload, status)
         values ('code_feedback', $1, $2, 'completed') returning id`,
        [learnerId, JSON.stringify({ rubric: "SECRET-RUBRIC", prompt: "SECRET-PROMPT" })],
      )
    ).rows[0].id;
    await db.pool.query(
      `insert into ai_outputs (job_id, user_id, source_type, source_id, content)
       values ($1,$2,'code_feedback',$3,$4)`,
      [jobId, learnerId, jobId, JSON.stringify({ hints: ["Check the first item."] })],
    );

    const res = await read("/account/export");

    expect(res.text).toMatch(/Check the first item/);
    expect(res.text).not.toMatch(/SECRET-RUBRIC/);
    expect(res.text).not.toMatch(/SECRET-PROMPT/);
  });

  /**
   * Rule 2 names integrity flags. They are *about* the learner and are still
   * not theirs to read — an export must not become a side door onto the
   * admin's view of them.
   */
  it("never carries an integrity flag", async () => {
    const { pathId, roadmapId } = await giveCertificate(learnerId);
    const trackId = (
      await db.pool.query<{ id: string }>(
        `insert into tracks (career_path_id, title) values ($1,'Frontend') returning id`,
        [pathId],
      )
    ).rows[0].id;
    const briefId = (
      await db.pool.query<{ id: string }>(
        `insert into capstone_briefs (track_id, slug, status) values ($1,'tt','published') returning id`,
        [trackId],
      )
    ).rows[0].id;
    const versionId = (
      await db.pool.query<{ id: string }>(
        `insert into capstone_brief_versions (brief_id, version_no, title, status)
         values ($1,1,'Task tracker','published') returning id`,
        [briefId],
      )
    ).rows[0].id;
    const techId = (
      await db.pool.query<{ id: string }>(
        `insert into technologies (slug, name) values ('react','React') returning id`,
      )
    ).rows[0].id;
    const projectId = (
      await db.pool.query<{ id: string }>(
        `insert into capstone_projects (user_id, roadmap_id, brief_version_id, technology_id)
         values ($1,$2,$3,$4) returning id`,
        [learnerId, roadmapId, versionId, techId],
      )
    ).rows[0].id;
    await db.pool.query(
      `insert into integrity_flags (project_id, type, details)
       values ($1,'similarity',$2)`,
      [projectId, JSON.stringify({ note: "SUSPECTED-COPYING" })],
    );

    const res = await read("/account/export");

    expect(res.text).toMatch(/Task tracker/);
    expect(res.text).not.toMatch(/SUSPECTED-COPYING/);
    expect(res.text).not.toMatch(/similarity/);
  });

  it("never carries an admin's notes on a flag the learner raised", async () => {
    const jobId = (
      await db.pool.query<{ id: string }>(
        `insert into ai_jobs (type, user_id, payload) values ('code_feedback',$1,'{}') returning id`,
        [learnerId],
      )
    ).rows[0].id;
    const outputId = (
      await db.pool.query<{ id: string }>(
        `insert into ai_outputs (job_id, user_id, source_type, source_id, content)
         values ($1,$2,'code_feedback',$3,'{}') returning id`,
        [jobId, learnerId, jobId],
      )
    ).rows[0].id;
    await db.pool.query(
      `insert into ai_feedback_flags (ai_output_id, user_id, reason, admin_notes)
       values ($1,$2,'This hint gave me the answer.','ADMIN-ONLY-NOTE')`,
      [outputId, learnerId],
    );

    const res = await read("/account/export");

    expect(res.text).toMatch(/This hint gave me the answer/);
    expect(res.text).not.toMatch(/ADMIN-ONLY-NOTE/);
  });

  it("gives the GitHub username but not the installation credential", async () => {
    await db.pool.query(
      `insert into github_connections (user_id, github_user_id, github_username, installation_id)
       values ($1, 4242, 'jangerona', 987654321)`,
      [learnerId],
    );

    const res = await read("/account/export");

    expect(res.text).toMatch(/jangerona/);
    expect(res.text).not.toMatch(/987654321/);
  });

  /** An export that is silent about its own gaps reads as the whole record. */
  it("says what it leaves out", async () => {
    const data = JSON.parse((await read("/account/export")).text);
    expect(data.notIncluded.length).toBeGreaterThan(0);
    expect(data.notIncluded.join(" ")).toMatch(/password/i);
  });
});

describe("deleting my account", () => {
  it("deletes the account and signs the browser out", async () => {
    const res = await write("delete", "/account");

    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);

    const { rowCount } = await db.pool.query(`select id from users where id = $1`, [learnerId]);
    expect(rowCount).toBe(0);
    await read("/account").expect(401);
  });

  /**
   * A learner who has earned something is the learner most likely to ask, so
   * this is the case worth covering rather than the empty account above.
   *
   * **A caveat this test cannot state on its own.** Collapsing the handler to a
   * single `delete from users` makes it fail here — pg-mem evaluates
   * `certificates.roadmap_id`'s restrict against rows the same statement is
   * about to remove — but the single statement *succeeds* on real PostgreSQL.
   * So this is not proof of a production bug; it is proof that the endpoint
   * behaves, on the engine the suite runs on. `npm run db:verify` covers the
   * real one, and `packages/test-db` records the divergence.
   */
  it("works for a learner who holds a certificate", async () => {
    await giveCertificate(learnerId);

    const res = await write("delete", "/account");

    expect(res.status).toBe(200);
    expect((await db.pool.query(`select id from users where id = $1`, [learnerId])).rowCount).toBe(
      0,
    );
    expect((await db.pool.query(`select public_code from certificates`)).rowCount).toBe(0);
    expect((await db.pool.query(`select id from roadmaps`)).rowCount).toBe(0);
  });

  /** §5.18 says the verification links stop working, so they have to. */
  it("stops the certificate verifying afterwards", async () => {
    await giveCertificate(learnerId);
    await request(app).get("/verify/FC-7K2M-94QX").expect(200);

    await write("delete", "/account").expect(200);

    // The public page answers 200 with a status rather than 404 — it is a page,
    // not a record lookup. What matters is that it no longer says valid.
    const res = await request(app).get("/verify/FC-7K2M-94QX");
    expect(res.body.result.status).toBe("not-found");
  });

  it("leaves every other learner untouched", async () => {
    const other = await signUp("other@example.com");
    await giveCertificate(other.id, "FC-OTHER-0001");

    await write("delete", "/account").expect(200);

    expect((await db.pool.query(`select id from users where id = $1`, [other.id])).rowCount).toBe(
      1,
    );
    expect((await db.pool.query(`select public_code from certificates`)).rowCount).toBe(1);
  });

  /**
   * AGENT.md open question 17, answered to the caller rather than as a
   * trigger's error. Learners never hit this; an admin calling the endpoint
   * directly does, and the API is the only boundary, so it answers for itself.
   */
  it("refuses an admin, and says why", async () => {
    const admin = await signUp("admin@example.com");
    await db.pool.query(`update users set role = 'admin' where id = $1`, [admin.id]);

    const res = await request(app)
      .delete("/account")
      .set("Cookie", admin.cookie)
      .set("Origin", config.appOrigin);

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/append-only/i);
    expect((await db.pool.query(`select id from users where id = $1`, [admin.id])).rowCount).toBe(
      1,
    );
  });
});

describe("disconnecting GitHub", () => {
  async function connect() {
    await db.pool.query(
      `insert into github_connections (user_id, github_user_id, github_username, installation_id)
       values ($1, 4242, 'jangerona', 99)`,
      [learnerId],
    );
  }

  it("removes the connection", async () => {
    await connect();

    const res = await write("delete", "/github/connection");

    expect(res.status).toBe(200);
    expect(res.body.wasConnected).toBe(true);
    expect((await db.pool.query(`select user_id from github_connections`)).rowCount).toBe(0);
  });

  it("is not an error when there was nothing connected", async () => {
    const res = await write("delete", "/github/connection");

    expect(res.status).toBe(200);
    expect(res.body.wasConnected).toBe(false);
  });

  /**
   * §6 rule 5. Disconnecting ends the platform's *access*; it does not delete
   * work. A settings toggle that quietly removed a milestone a learner had
   * passed would be evidence destroyed by a UI control.
   */
  it("keeps the capstone project and its milestone attempts", async () => {
    await connect();
    const { pathId, roadmapId } = await giveCertificate(learnerId);

    const trackId = (
      await db.pool.query<{ id: string }>(
        `insert into tracks (career_path_id, title) values ($1,'Frontend') returning id`,
        [pathId],
      )
    ).rows[0].id;
    const briefId = (
      await db.pool.query<{ id: string }>(
        `insert into capstone_briefs (track_id, slug, status) values ($1,'tt','published') returning id`,
        [trackId],
      )
    ).rows[0].id;
    const versionId = (
      await db.pool.query<{ id: string }>(
        `insert into capstone_brief_versions (brief_id, version_no, title, status)
         values ($1,1,'Task tracker','published') returning id`,
        [briefId],
      )
    ).rows[0].id;
    const techId = (
      await db.pool.query<{ id: string }>(
        `insert into technologies (slug, name) values ('react','React') returning id`,
      )
    ).rows[0].id;
    const projectId = (
      await db.pool.query<{ id: string }>(
        `insert into capstone_projects (user_id, roadmap_id, brief_version_id, technology_id, repo_full_name)
         values ($1,$2,$3,$4,'jangerona/task-tracker') returning id`,
        [learnerId, roadmapId, versionId, techId],
      )
    ).rows[0].id;
    const milestoneId = (
      await db.pool.query<{ id: string }>(
        `insert into milestones (brief_version_id, sort_order, title) values ($1,1,'Save tasks') returning id`,
        [versionId],
      )
    ).rows[0].id;
    await db.pool.query(
      `insert into milestone_attempts (project_id, milestone_id, commit_sha, status)
       values ($1,$2,'abc123','complete')`,
      [projectId, milestoneId],
    );

    await write("delete", "/github/connection").expect(200);

    expect((await db.pool.query(`select id from capstone_projects`)).rowCount).toBe(1);
    expect((await db.pool.query(`select id from milestone_attempts`)).rowCount).toBe(1);
  });
});
