import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../app.js";
import { createTestDb, type TestDb } from "@first-commit/test-db";
import { post } from "../test/http.js";
import type { Mailer } from "../mail/index.js";
import { config } from "../config.js";
import { readEvidence } from "./evidence.js";

const silentMailer: Mailer = { name: "test", async send() {} };

/**
 * The resume (design.md §5.16).
 *
 * §5.16: the evidence panel "lists only verified items; learners choose which to
 * include but cannot add unverified skills". So most of this file is about what
 * a learner *cannot* put on a resume — which is the whole point, because this is
 * the one screen whose output a stranger reads and acts on.
 */

let db: TestDb;
let app: Express;
let cookie: string;
let learnerId: string;
let ids: Record<string, string>;

const read = (path: string) => request(app).get(path).set("Cookie", cookie);
const write = (method: "put" | "patch" | "post", path: string) =>
  request(app)[method](path).set("Cookie", cookie).set("Origin", config.appOrigin);

async function seed(): Promise<Record<string, string>> {
  const one = async (sql: string, values: unknown[] = []) =>
    (await db.pool.query<{ id: string }>(sql, values)).rows[0].id;

  const out: Record<string, string> = {};
  out.path = await one(
    `insert into career_paths (slug, title, status) values ('jwd','Junior Web Developer','published') returning id`,
  );
  out.html = await one(`insert into skills (slug, name) values ('html','HTML') returning id`);
  out.js = await one(`insert into skills (slug, name) values ('js','JavaScript') returning id`);

  for (const [key, skill, slug] of [
    ["modHtml", out.html, "html-basics"],
    ["modJs", out.js, "js-basics"],
    ["modJs2", out.js, "js-functions"],
  ] as const) {
    out[key] = await one(
      `insert into modules (skill_id, kind, slug, status) values ($1,'core',$2,'published') returning id`,
      [skill, slug],
    );
    out[`${key}V`] = await one(
      `insert into module_versions (module_id, version_no, title, status)
       values ($1,1,$2,'published') returning id`,
      [out[key], slug],
    );
  }
  return out;
}

const complete = (moduleKey: string, method = "passed") =>
  db.pool.query(
    `insert into module_completions (user_id, module_id, module_version_id, method, score)
     values ($1,$2,$3,$4,100)`,
    [learnerId, ids[moduleKey], ids[`${moduleKey}V`], method],
  );

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

  ids = await seed();
});

describe("what counts as evidence", () => {
  it("reports nothing before anything is passed", async () => {
    const evidence = await readEvidence(db.pool, learnerId);
    expect(evidence.skills).toEqual([]);
    expect(evidence.certificates).toEqual([]);
    expect(evidence.projects).toEqual([]);
  });

  it("verifies a skill once a module in it is complete", async () => {
    await complete("modHtml");
    const evidence = await readEvidence(db.pool, learnerId);

    expect(evidence.skills).toHaveLength(1);
    expect(evidence.skills[0]).toMatchObject({ name: "HTML", moduleCount: 1, method: "passed" });
  });

  it("counts every module in a skill", async () => {
    await complete("modJs");
    await complete("modJs2");
    const evidence = await readEvidence(db.pool, learnerId);

    expect(evidence.skills[0]).toMatchObject({ name: "JavaScript", moduleCount: 2 });
  });

  /** §6 rule 7: testing out is real evidence, and the resume says which it was. */
  it("marks a skill proved only by placement as tested out", async () => {
    await complete("modHtml", "tested_out");
    const evidence = await readEvidence(db.pool, learnerId);

    expect(evidence.skills[0].method).toBe("tested_out");
  });

  it("calls a skill passed when any of its modules was worked through", async () => {
    await complete("modJs", "tested_out");
    await complete("modJs2", "passed");
    const evidence = await readEvidence(db.pool, learnerId);

    expect(evidence.skills[0].method).toBe("passed");
  });

  it("sees nothing of another learner's completions", async () => {
    const other = (
      await db.pool.query<{ id: string }>(
        `insert into users (email, password_hash, full_name) values ('o@example.com','h','O') returning id`,
      )
    ).rows[0].id;
    await db.pool.query(
      `insert into module_completions (user_id, module_id, module_version_id, method, score)
       values ($1,$2,$3,'passed',100)`,
      [other, ids.modHtml, ids.modHtmlV],
    );

    expect((await readEvidence(db.pool, learnerId)).skills).toEqual([]);
  });

  /** A revoked certificate is not a credential any more. */
  it("leaves out a revoked certificate", async () => {
    const roadmap = (
      await db.pool.query<{ id: string }>(
        `insert into roadmaps (user_id, career_path_id, status) values ($1,$2,'active') returning id`,
        [learnerId, ids.path],
      )
    ).rows[0].id;
    for (const [code, status] of [
      ["FC-AAAA-AAAA", "valid"],
      ["FC-BBBB-BBBB", "revoked"],
    ] as const) {
      await db.pool.query(
        `insert into certificates (public_code, user_id, type, roadmap_id, recipient_name, title, status, revoked_reason)
         values ($1,$2,'completion',$3,'Jan','Junior Web Developer',$4,$5)`,
        [code, learnerId, roadmap, status, status === "revoked" ? "a reason" : null],
      );
    }

    const evidence = await readEvidence(db.pool, learnerId);
    expect(evidence.certificates.map((c) => c.publicCode)).toEqual(["FC-AAAA-AAAA"]);
  });
});

describe("GET /resume", () => {
  it("creates the resume on first read rather than at sign-up", async () => {
    expect(db.rows("resumes")).toHaveLength(0);

    const res = await read("/resume");

    expect(res.status).toBe(200);
    expect(db.rows("resumes")).toHaveLength(1);
    expect(res.body.resume.content).toBeNull();
  });

  it("does not create a second one on the next read", async () => {
    await read("/resume");
    await read("/resume");
    expect(db.rows("resumes")).toHaveLength(1);
  });

  it("serves the verified evidence and the learner's own name", async () => {
    await complete("modHtml");
    const res = await read("/resume");

    expect(res.body.evidence.skills[0].name).toBe("HTML");
    expect(res.body.details.fullName).toBe("Jan Kevin Gerona");
  });

  it("requires a session", async () => {
    expect((await request(app).get("/resume")).status).toBe(401);
  });
});

describe("PUT /resume/details", () => {
  const valid = {
    email: "me@example.com",
    phone: "+63 900 000 0000",
    city: "Manila",
    links: [{ label: "GitHub", url: "https://github.com/me" }],
    education: [{ school: "A University", degree: "BSc", start: "2022", end: "2026" }],
  };

  it("stores the learner's own details", async () => {
    const res = await write("put", "/resume/details").send(valid);

    expect(res.status).toBe(200);
    const row = db.rows("resume_details")[0];
    expect(row.user_id).toBe(learnerId);
    expect(row.city).toBe("Manila");
  });

  it("replaces them rather than accumulating", async () => {
    await write("put", "/resume/details").send(valid);
    await write("put", "/resume/details").send({ ...valid, city: "Cebu" });

    expect(db.rows("resume_details")).toHaveLength(1);
    expect(db.rows("resume_details")[0].city).toBe("Cebu");
  });

  it("refuses a link that is not a web address", async () => {
    const res = await write("put", "/resume/details").send({
      ...valid,
      links: [{ label: "GitHub", url: "not a url" }],
    });
    expect(res.status).toBe(400);
  });

  /**
   * §7: module completion is a skill, never experience. There is no free-text
   * experience field, and `.strict()` makes that a refusal rather than a silent
   * drop — a learner cannot smuggle a job history in through this endpoint.
   */
  it.each(["experience", "employment", "skills", "summary", "projects"])(
    "refuses a body carrying %s",
    async (field) => {
      const res = await write("put", "/resume/details").send({ ...valid, [field]: "anything" });
      expect(res.status).toBe(400);
    },
  );
});

describe("PUT /resume/selection", () => {
  beforeEach(async () => {
    await complete("modHtml");
    await read("/resume");
  });

  it("stores a choice among the verified skills", async () => {
    const res = await write("put", "/resume/selection").send({ skillIds: [ids.html] });

    expect(res.status).toBe(200);
    expect(res.body.selected.skillIds).toEqual([ids.html]);
  });

  /**
   * §5.16: learners "cannot add unverified skills". The panel cannot offer one,
   * so an unknown id means a stale page — dropped rather than refused, so a
   * learner whose evidence changed in another tab is not stranded.
   */
  it("drops a skill id the learner has not earned", async () => {
    const res = await write("put", "/resume/selection").send({
      skillIds: [ids.html, ids.js],
    });

    expect(res.body.selected.skillIds).toEqual([ids.html]);
  });

  it("drops a certificate code that is not theirs", async () => {
    const res = await write("put", "/resume/selection").send({
      certificateCodes: ["FC-ZZZZ-ZZZZ"],
    });

    expect(res.body.selected.certificateCodes).toEqual([]);
  });

  it("refuses a body carrying the items themselves", async () => {
    const res = await write("put", "/resume/selection").send({
      skills: [{ name: "Kubernetes" }],
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /resume/generate", () => {
  /** §5.16's empty state, word for word. */
  it("refuses with the screen's own sentence when nothing is verified", async () => {
    const res = await write("post", "/resume/generate").send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe(
      "Pass your first module assessment to add a verified skill to your resume.",
    );
    expect(db.rows("ai_jobs")).toHaveLength(0);
  });

  it("queues the job with the evidence in the payload", async () => {
    await complete("modHtml");
    const res = await write("post", "/resume/generate").send({});

    expect(res.status).toBe(200);
    const job = db.rows("ai_jobs")[0];
    expect(job.type).toBe("resume_generation");
    expect(job.user_id).toBe(learnerId);

    const payload = job.payload as { skills: { name: string }[]; projects: unknown[] };
    expect(payload.skills.map((s) => s.name)).toEqual(["HTML"]);
    // §7: no capstone means no Projects section.
    expect(payload.projects).toEqual([]);
  });

  it("sends only the selected evidence once a choice has been made", async () => {
    await complete("modHtml");
    await complete("modJs");
    await read("/resume");
    await write("put", "/resume/selection").send({ skillIds: [ids.js] });

    await write("post", "/resume/generate").send({});

    const payload = db.rows("ai_jobs")[0].payload as { skills: { name: string }[] };
    expect(payload.skills.map((s) => s.name)).toEqual(["JavaScript"]);
  });

  it("does not queue a second job while one is running", async () => {
    await complete("modHtml");
    await write("post", "/resume/generate").send({});
    await write("post", "/resume/generate").send({});

    expect(db.rows("ai_jobs")).toHaveLength(1);
  });

  /** §6 rule 1's shape: nothing the browser sends decides what is on a resume. */
  it("ignores evidence sent in the request body", async () => {
    await complete("modHtml");
    await write("post", "/resume/generate").send({
      skills: [{ name: "Kubernetes" }],
      projects: [{ id: "invented", title: "An e-commerce platform" }],
    });

    const payload = db.rows("ai_jobs")[0].payload as {
      skills: { name: string }[];
      projects: unknown[];
    };
    expect(payload.skills.map((s) => s.name)).toEqual(["HTML"]);
    expect(payload.projects).toEqual([]);
  });
});

describe("PATCH /resume — editing the AI's text", () => {
  beforeEach(async () => {
    await complete("modHtml");
    const resume = (await read("/resume")).body.resume.id as string;
    await db.pool.query(
      `update resumes
          set content = $1, ai_fields = $2, generated_at = now()
        where id = $3`,
      [
        JSON.stringify({ summary: "Written by the model.", skills: ["HTML"], projects: [] }),
        ["summary"],
        resume,
      ],
    );
  });

  it("stores an edited summary", async () => {
    const res = await write("patch", "/resume").send({ summary: "Written by me." });

    expect(res.status).toBe(200);
    expect(res.body.content.summary).toBe("Written by me.");
  });

  /**
   * §5.16: AI text is "labeled and editable". Once the learner edits it, it is
   * no longer the model's, so it stops being labelled as AI.
   */
  it("stops calling an edited field AI-written", async () => {
    const res = await write("patch", "/resume").send({ summary: "Mine now." });
    expect(res.body.aiFields).not.toContain("summary");
  });

  /** The skills list is evidence. The panel is the only way to change it. */
  it("refuses an edit to the skills", async () => {
    const res = await write("patch", "/resume").send({ skills: ["Kubernetes"] });

    expect(res.status).toBe(400);
    const stored = db.rows("resumes")[0].content as { skills: string[] };
    expect(stored.skills).toEqual(["HTML"]);
  });

  it("ignores a description for a project the model never wrote", async () => {
    const res = await write("patch", "/resume").send({
      projects: [{ projectId: "invented", description: "An e-commerce platform." }],
    });

    expect(res.status).toBe(200);
    expect(res.body.content.projects).toEqual([]);
  });

  it("requires a session", async () => {
    const res = await request(app)
      .patch("/resume")
      .set("Origin", config.appOrigin)
      .send({ summary: "x" });
    expect(res.status).toBe(401);
  });
});
