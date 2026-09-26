import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../app.js";
import { createTestDb, type TestDb } from "@first-commit/test-db";
import { post } from "../test/http.js";
import type { Mailer } from "../mail/index.js";
import { inflateSync } from "node:zlib";

const silentMailer: Mailer = { name: "test", async send() {} };

/**
 * "Download PDF" (§5.15, §5.16).
 *
 * Two things matter here and they are not about layout: **a PDF is an owned
 * read**, and **it asserts only what the evidence still supports**. A file with
 * an official look is the worst place for a stale or borrowed claim to end up.
 */

let db: TestDb;
let app: Express;
let cookie: string;
let learnerId: string;
let ids: Record<string, string>;

const read = (path: string) => request(app).get(path).set("Cookie", cookie);

/** PDFs are binary; supertest needs telling not to parse them as text. */
const readPdf = (path: string) =>
  request(app).get(path).set("Cookie", cookie).buffer(true).parse((res, cb) => {
    const chunks: Buffer[] = [];
    res.on("data", (c: Buffer) => chunks.push(c));
    res.on("end", () => cb(null, Buffer.concat(chunks)));
  });

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

  const one = async (sql: string, values: unknown[] = []) =>
    (await db.pool.query<{ id: string }>(sql, values)).rows[0].id;

  ids = {};
  ids.path = await one(
    `insert into career_paths (slug, title, status) values ('jwd','Junior Web Developer','published') returning id`,
  );
  ids.skill = await one(`insert into skills (slug, name) values ('html','HTML') returning id`);
  ids.module = await one(
    `insert into modules (skill_id, kind, slug, status) values ($1,'core','html-basics','published') returning id`,
    [ids.skill],
  );
  ids.version = await one(
    `insert into module_versions (module_id, version_no, title, status)
     values ($1,1,'HTML basics','published') returning id`,
    [ids.module],
  );
  ids.roadmap = await one(
    `insert into roadmaps (user_id, career_path_id, status) values ($1,$2,'active') returning id`,
    [learnerId, ids.path],
  );
});

const completeHtml = () =>
  db.pool.query(
    `insert into module_completions (user_id, module_id, module_version_id, method, score)
     values ($1,$2,$3,'passed',100)`,
    [learnerId, ids.module, ids.version],
  );

const giveCertificate = (code = "FC-7K2M-94QX", userId = learnerId, status = "valid") =>
  db.pool.query(
    `insert into certificates
       (public_code, user_id, type, roadmap_id, recipient_name, title, details, status, revoked_reason)
     values ($1,$2,'completion',$3,'Jan Kevin Gerona','Junior Web Developer',$4,$5,$6)`,
    [
      code,
      userId,
      ids.roadmap,
      JSON.stringify({ skills: ["HTML"] }),
      status,
      status === "revoked" ? "a reason" : null,
    ],
  );

const isPdf = (body: Buffer) => body.subarray(0, 5).toString() === "%PDF-";

/**
 * Pulls the readable text out of a PDF, the way a parser would.
 *
 * §5.16 calls for an **ATS-friendly** resume, and the part of that a test can
 * actually check is whether the words are *text*. pdfkit writes them as hex
 * strings inside `TJ` operators, split for kerning — `[<4a> 20 <61> …] TJ` — so
 * this inflates the content streams and decodes those back. Glyphs drawn as
 * outlines, or a page rendered as an image, would come back empty here, which
 * is precisely the failure that makes a resume invisible to a tracking system.
 */
function textOf(pdf: Buffer): string {
  const raw = pdf.toString("latin1");
  let out = "";

  // `[^]` matches across lines, and the lazy quantifier takes one stream at a time.
  for (const match of raw.matchAll(/stream[\r\n]+([^]*?)endstream/g)) {
    let body = Buffer.from(match[1], "latin1");
    try {
      body = inflateSync(body);
    } catch {
      // Already uncompressed, or not a content stream. Either is fine.
    }
    for (const hex of body.toString("latin1").matchAll(/<([0-9a-fA-F]+)>/g)) {
      out += Buffer.from(hex[1], "hex").toString("latin1");
    }
  }
  return out;
}


describe("GET /resume.pdf", () => {
  beforeEach(async () => {
    await completeHtml();
    await read("/resume");
  });

  it("returns a real PDF", async () => {
    const res = await readPdf("/resume.pdf");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(isPdf(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(500);
  });

  /**
   * The point of §5.16's "single column, standard headings, no tables, icons, or
   * images": a tracking system parses a resume by heading, and it can only do
   * that if the words are text.
   */
  it("puts the resume's words in the PDF as extractable text", async () => {
    const res = await readPdf("/resume.pdf");
    const text = textOf(res.body);

    expect(text).toContain("Jan Kevin Gerona");
    expect(text).toContain("SKILLS");
    expect(text).toContain("HTML");
  });

  it("uses a standard font rather than an embedded subset", async () => {
    const res = await readPdf("/resume.pdf");
    const raw = res.body.toString("latin1");

    expect(raw).toMatch(/\/BaseFont\s*\/Helvetica/);
    // An image would be unreadable to a parser, and §5.16 rules them out.
    expect(raw).not.toMatch(/\/Subtype\s*\/Image/);
  });

  it("offers it as a download with a safe filename", async () => {
    const res = await readPdf("/resume.pdf");
    expect(res.headers["content-disposition"]).toBe(
      'attachment; filename="Jan-Kevin-Gerona-resume.pdf"',
    );
  });

  /**
   * A name is free text, and it reaches a header. A quote or a newline there
   * would let a learner write their own response headers.
   */
  it("cannot be used to inject a header", async () => {
    await db.pool.query(`update users set full_name = $1 where id = $2`, [
      'Evil"\r\nX-Injected: yes',
      learnerId,
    ]);

    const res = await readPdf("/resume.pdf");

    expect(res.headers["x-injected"]).toBeUndefined();
    expect(res.headers["content-disposition"]).not.toContain("\n");
    expect(res.headers["content-disposition"]).toMatch(/^attachment; filename="[\w.-]+\.pdf"$/);
  });

  /** A resume changes with the evidence, so nothing may hold an old one. */
  it("is never cached", async () => {
    const res = await readPdf("/resume.pdf");
    expect(res.headers["cache-control"]).toContain("no-store");
  });

  it("requires a session", async () => {
    expect((await request(app).get("/resume.pdf")).status).toBe(401);
  });

  it("answers 404 before a resume exists", async () => {
    const other = await post(app, "/auth/signup").send({
      fullName: "Other Person",
      email: "other@example.com",
      password: "a-good-password",
    });
    const theirCookie = (other.headers["set-cookie"] as unknown as string[])[0].split(";")[0];

    const res = await request(app).get("/resume.pdf").set("Cookie", theirCookie);
    expect(res.status).toBe(404);
  });
});

describe("GET /certificates/:code.pdf", () => {
  it("returns a real PDF for the learner's own certificate", async () => {
    await giveCertificate();
    const res = await readPdf("/certificates/FC-7K2M-94QX.pdf");

    expect(res.status).toBe(200);
    expect(isPdf(res.body)).toBe(true);
    expect(res.headers["content-disposition"]).toContain("FC-7K2M-94QX-certificate.pdf");
  });

  /**
   * §6.1 step 3. The same certificate is **public** at `/verify/:code`, which
   * shows a name and a title — the PDF is the artefact itself, and handing that
   * to anyone holding the code would make forging an attachment a matter of
   * guessing one.
   */
  /** A certificate nobody can verify is decoration, so the code and URL are on it. */
  it("prints the name, the code and the verification URL", async () => {
    await giveCertificate();
    const text = textOf((await readPdf("/certificates/FC-7K2M-94QX.pdf")).body);

    expect(text).toContain("Jan Kevin Gerona");
    expect(text).toContain("FC-7K2M-94QX");
    expect(text).toContain("/verify/FC-7K2M-94QX");
  });

  it("answers 404 for somebody else's certificate", async () => {
    const other = (
      await db.pool.query<{ id: string }>(
        `insert into users (email, password_hash, full_name) values ('o@example.com','h','O') returning id`,
      )
    ).rows[0].id;
    await giveCertificate("FC-AAAA-BBBB", other);

    const res = await read("/certificates/FC-AAAA-BBBB.pdf");
    expect(res.status).toBe(404);
  });

  /** A revoked certificate is not a document to hand anybody. */
  it("answers 404 for a revoked certificate", async () => {
    await giveCertificate("FC-CCCC-DDDD", learnerId, "revoked");

    const res = await read("/certificates/FC-CCCC-DDDD.pdf");
    expect(res.status).toBe(404);
  });

  it("answers 404 for a code that does not exist", async () => {
    expect((await read("/certificates/FC-0000-0000.pdf")).status).toBe(404);
  });

  it("requires a session", async () => {
    await giveCertificate();
    expect((await request(app).get("/certificates/FC-7K2M-94QX.pdf")).status).toBe(401);
  });
});
