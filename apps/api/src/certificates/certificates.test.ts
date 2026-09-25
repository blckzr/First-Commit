import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../app.js";
import { createTestDb, type TestDb } from "@first-commit/test-db";
import { post } from "../test/http.js";
import type { Mailer } from "../mail/index.js";
import { newPublicCode } from "./issue.js";
import { config } from "../config.js";

const silentMailer: Mailer = { name: "test", async send() {} };

/**
 * **The fourth and last evidence table** (AGENT.md §6 rule 1), and the one a
 * browser could most plausibly just ask for. So the tests here are mostly about
 * what does *not* earn a certificate.
 *
 * `GET /verify/:code` is also the API's only public read of a learner's record,
 * which means §6.1's "filter by the session user" cannot be the safety net —
 * every field it returns is chosen, and the ones it withholds are asserted.
 */

let db: TestDb;
let app: Express;
let cookie: string;
let learnerId: string;
let ids: Record<string, string>;

const read = (path: string) => request(app).get(path).set("Cookie", cookie);

/**
 * A career path with two required modules and one optional, plus a technology
 * decision. Small enough to reason about, complete enough that every rule the
 * issuer applies has something to bite on.
 */
async function seed(): Promise<Record<string, string>> {
  const one = async (sql: string, values: unknown[] = []) =>
    (await db.pool.query<{ id: string }>(sql, values)).rows[0].id;

  const out: Record<string, string> = {};
  out.path = await one(
    `insert into career_paths (slug, title, status) values ('jwd','Junior Web Developer','published') returning id`,
  );
  out.track = await one(
    `insert into tracks (career_path_id, title, status) values ($1,'Frontend','published') returning id`,
    [out.path],
  );
  out.tech = await one(
    `insert into technologies (slug, name) values ('react','React') returning id`,
  );
  out.skill = await one(`insert into skills (slug, name) values ('html','HTML') returning id`);
  out.skill2 = await one(`insert into skills (slug, name) values ('js','JavaScript') returning id`);
  // `layer = 'core'` requires a null track_id (the schema's check constraint).
  out.pathSkill = await one(
    `insert into path_skills (career_path_id, skill_id, layer, sort_order)
     values ($1,$2,'core',0) returning id`,
    [out.path, out.skill],
  );
  out.pathSkill2 = await one(
    `insert into path_skills (career_path_id, skill_id, layer, sort_order)
     values ($1,$2,'core',1) returning id`,
    [out.path, out.skill2],
  );

  for (const [key, skill, pathSkill, slug, required] of [
    ["modA", out.skill, out.pathSkill, "html-basics", true],
    ["modB", out.skill2, out.pathSkill2, "js-basics", true],
    ["modOptional", out.skill2, out.pathSkill2, "js-extra", false],
  ] as const) {
    out[key] = await one(
      `insert into modules (skill_id, kind, slug, status) values ($1,'core',$2,'published') returning id`,
      [skill, slug],
    );
    out[`${key}Version`] = await one(
      `insert into module_versions (module_id, version_no, title, status)
       values ($1,1,$2,'published') returning id`,
      [out[key], slug],
    );
    await db.pool.query(
      `insert into path_skill_modules (path_skill_id, module_id, sort_order, required_for_certificate)
       values ($1,$2,0,$3)`,
      [pathSkill, out[key], required],
    );
  }

  return out;
}

/** A roadmap holding the given modules, all active. */
async function giveRoadmap(modules: string[], withTrack = true): Promise<string> {
  const roadmap = (
    await db.pool.query<{ id: string }>(
      `insert into roadmaps (user_id, career_path_id, track_id, status)
       values ($1,$2,$3,'active') returning id`,
      [learnerId, ids.path, withTrack ? ids.track : null],
    )
  ).rows[0].id;

  for (const [i, moduleId] of modules.entries()) {
    await db.pool.query(
      `insert into roadmap_items (roadmap_id, module_id, sort_order, source, status)
       values ($1,$2,$3,'generated','active')`,
      [roadmap, moduleId, i],
    );
  }
  return roadmap;
}

const complete = (moduleId: string, versionKey: string, method = "passed") =>
  db.pool.query(
    `insert into module_completions (user_id, module_id, module_version_id, method, score)
     values ($1,$2,$3,$4,100)`,
    [learnerId, moduleId, ids[versionKey], method],
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

describe("§6 rule 1 — what does not earn a certificate", () => {
  it("issues nothing when no module is complete", async () => {
    await giveRoadmap([ids.modA, ids.modB]);

    const res = await read("/certificates");

    expect(res.status).toBe(200);
    expect(res.body.certificates).toEqual([]);
    expect(db.rows("certificates")).toHaveLength(0);
  });

  it("issues nothing when one required module is still outstanding", async () => {
    await giveRoadmap([ids.modA, ids.modB]);
    await complete(ids.modA, "modAVersion");

    await read("/certificates");

    expect(db.rows("certificates")).toHaveLength(0);
  });

  /**
   * **"Every one of zero modules is complete" is vacuously true.** A roadmap
   * that was never generated would otherwise earn a certificate for nothing.
   * There is such a roadmap in the development database, so this is a real case.
   */
  it("issues nothing for a roadmap with no modules at all", async () => {
    await giveRoadmap([]);

    const res = await read("/certificates");

    expect(db.rows("certificates")).toHaveLength(0);
    expect(res.body.progress[0].blockedBy).toBe("no-modules");
  });

  /**
   * §3 counts "core, track, and technology modules", and technology modules only
   * join the roadmap once the learner picks a framework. An open choice means the
   * roadmap is incomplete however many of its current items are done.
   */
  it("issues nothing while a technology decision is unanswered", async () => {
    const roadmap = await giveRoadmap([ids.modA, ids.modB]);
    const decision = (
      await db.pool.query<{ id: string }>(
        `insert into technology_decisions (track_id, title) values ($1,'Choose your framework') returning id`,
        [ids.track],
      )
    ).rows[0].id;
    await db.pool.query(
      `insert into roadmap_technology_choices (roadmap_id, decision_id) values ($1,$2)`,
      [roadmap, decision],
    );
    await complete(ids.modA, "modAVersion");
    await complete(ids.modB, "modBVersion");

    const res = await read("/certificates");

    expect(db.rows("certificates")).toHaveLength(0);
    expect(res.body.progress[0].blockedBy).toBe("technology-not-chosen");
  });

  it("issues nothing for another learner's completions", async () => {
    const other = (
      await db.pool.query<{ id: string }>(
        `insert into users (email, password_hash, full_name) values ('other@example.com','h','O') returning id`,
      )
    ).rows[0].id;
    await giveRoadmap([ids.modA, ids.modB]);
    for (const m of [
      [ids.modA, "modAVersion"],
      [ids.modB, "modBVersion"],
    ] as const) {
      await db.pool.query(
        `insert into module_completions (user_id, module_id, module_version_id, method, score)
         values ($1,$2,$3,'passed',100)`,
        [other, m[0], ids[m[1]]],
      );
    }

    await read("/certificates");

    expect(db.rows("certificates")).toHaveLength(0);
  });

  /**
   * **There is no request that issues one** (§6 rule 1). A correct Origin is sent
   * on purpose: without it the CSRF guard answers 403 before routing, which would
   * make this pass whether or not such an endpoint existed.
   */
  it.each(["post", "put", "patch", "delete"] as const)(
    "has no %s /certificates to call",
    async (method) => {
      const res = await request(app)
        [method]("/certificates")
        .set("Cookie", cookie)
        .set("Origin", config.appOrigin)
        .send({ roadmapId: ids.path, type: "completion" });

      expect(res.status, `${method} /certificates answered ${res.status}`).toBe(404);
      expect(db.rows("certificates")).toHaveLength(0);
    },
  );
});

describe("§5.15 — earning one", () => {
  const finish = async () => {
    const roadmap = await giveRoadmap([ids.modA, ids.modB, ids.modOptional]);
    await complete(ids.modA, "modAVersion");
    await complete(ids.modB, "modBVersion");
    return roadmap;
  };

  /**
   * The optional module is on the roadmap and not complete. It must not block,
   * because `required_for_certificate` is the column that says "this one is
   * extra" — which is how reinforcement and challenge modules stay optional.
   */
  it("issues one when every required module is done, ignoring the optional one", async () => {
    const roadmap = await finish();

    const res = await read("/certificates");

    expect(res.body.certificates).toHaveLength(1);
    const cert = res.body.certificates[0];
    expect(cert.type).toBe("completion");
    expect(cert.status).toBe("valid");
    expect(cert.roadmapId).toBe(roadmap);
    expect(cert.publicCode).toMatch(/^FC-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
  });

  /** §5.15's heading: "Junior Web Developer, Frontend track with React". */
  it("titles it with the path and the track", async () => {
    await finish();
    const res = await read("/certificates");
    expect(res.body.certificates[0].title).toBe("Junior Web Developer, Frontend track");
  });

  /** §6 rule 7: testing out counts, so placement evidence earns a certificate. */
  it("counts a tested-out module", async () => {
    await giveRoadmap([ids.modA, ids.modB]);
    await complete(ids.modA, "modAVersion", "tested_out");
    await complete(ids.modB, "modBVersion");

    const res = await read("/certificates");
    expect(res.body.certificates).toHaveLength(1);
  });

  /** A snapshot, like the name: it must keep saying what it said on the day. */
  it("records the skills the learner proved", async () => {
    await finish();
    const res = await read("/certificates");
    expect(res.body.certificates[0].skills).toEqual(["HTML", "JavaScript"]);
  });

  it("snapshots the name, so a later rename does not rewrite history", async () => {
    await finish();
    await read("/certificates");
    await db.pool.query(`update users set full_name = 'Someone Else' where id = $1`, [learnerId]);

    const res = await read("/certificates");
    expect(res.body.certificates[0].recipientName).toBe("Jan Kevin Gerona");
  });

  /** Reading twice must not issue twice. */
  it("is idempotent", async () => {
    await finish();
    await read("/certificates");
    await read("/certificates");
    await read("/certificates");

    expect(db.rows("certificates")).toHaveLength(1);
  });

  it("offers a verification path for the screen to copy", async () => {
    await finish();
    const res = await read("/certificates");
    const cert = res.body.certificates[0];
    expect(cert.verifyPath).toBe(`/verify/${cert.publicCode}`);
  });

  /** §5.15's empty state needs to know why, not just that there is nothing. */
  it("reports progress on a roadmap that is not finished", async () => {
    await giveRoadmap([ids.modA, ids.modB]);
    await complete(ids.modA, "modAVersion");

    const res = await read("/certificates");
    expect(res.body.progress[0]).toMatchObject({ required: 2, completed: 1, blockedBy: null });
  });

  /** The Project Certificate is Phase 4; §5.15 shows it locked with a reason. */
  it("reports the project certificate as unavailable", async () => {
    await finish();
    const res = await read("/certificates");
    expect(res.body.projectCertificate).toEqual({
      available: false,
      reason: "capstone-not-built",
    });
  });

  it("requires a session", async () => {
    expect((await request(app).get("/certificates")).status).toBe(401);
  });
});

describe("GET /verify/:code — public", () => {
  let code: string;

  beforeEach(async () => {
    await giveRoadmap([ids.modA, ids.modB]);
    await complete(ids.modA, "modAVersion");
    await complete(ids.modB, "modBVersion");
    const res = await read("/certificates");
    code = res.body.certificates[0].publicCode;
  });

  /** No cookie: the whole point is that anybody with the link can check. */
  const verify = (c: string) => request(app).get(`/verify/${c}`);

  it("confirms a valid certificate without a session", async () => {
    const res = await verify(code);

    expect(res.status).toBe(200);
    expect(res.body.result.status).toBe("valid");
    expect(res.body.result.recipientName).toBe("Jan Kevin Gerona");
    expect(res.body.result.title).toBe("Junior Web Developer, Frontend track");
    expect(res.body.result.skills).toEqual(["HTML", "JavaScript"]);
  });

  /**
   * §5.15: "The page shows only the learner's name and certificate details,
   * never contact information." This is the API's only public read of a learner's
   * record, so §6.1's session filter cannot be the safety net — the absence of
   * these fields is the safety net.
   */
  it("reveals no contact information or internal ids", async () => {
    const body = JSON.stringify((await verify(code)).body);

    expect(body).not.toContain("learner@example.com");
    expect(body).not.toContain(learnerId);
    // Nor anything that would let a stranger walk to the learner's other records.
    expect(body).not.toContain("roadmapId");
    expect(body).not.toContain("userId");
  });

  it("is case-insensitive and tolerates whitespace", async () => {
    const res = await verify(` ${code.toLowerCase()} `.replace(/ /g, "%20"));
    expect(res.body.result.status).toBe("valid");
  });

  /**
   * A revoked certificate says so with the date. **Never the reason** — that is
   * between the learner and the platform, and a stranger with the link is not
   * owed it.
   */
  it("reports a revoked certificate without its reason", async () => {
    await db.pool.query(
      `update certificates
          set status = 'revoked', revoked_at = now(), revoked_reason = 'PRIVATE-REASON'
        where public_code = $1`,
      [code],
    );

    const res = await verify(code);

    expect(res.body.result.status).toBe("revoked");
    expect(res.body.result.revokedAt).toBeTruthy();
    expect(JSON.stringify(res.body)).not.toContain("PRIVATE-REASON");
    // And none of the details a valid one would show.
    expect(res.body.result.recipientName).toBeUndefined();
    expect(res.body.result.skills).toBeUndefined();
  });

  /**
   * §5.15 specifies "No certificate found with ID …", which is an answer rather
   * than an error — so 200, not 404. Answering identically for every shape of
   * bad code also means status alone cannot distinguish a real code from a fake.
   */
  it.each(["FC-0000-0000", "not-a-code", "FC-AAAA", "%20", "FC-AAAA-AAAA-AAAA"])(
    "answers 200 not-found for %s",
    async (bad) => {
      const res = await verify(bad);

      expect(res.status).toBe(200);
      expect(res.body.result.status).toBe("not-found");
    },
  );

  it("does not leak whether a code exists through its status code", async () => {
    const real = await verify(code);
    const fake = await verify("FC-0000-0000");
    expect(real.status).toBe(fake.status);
  });
});

describe("public codes", () => {
  it("matches §5.15's format", () => {
    expect(newPublicCode()).toMatch(/^FC-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
  });

  /**
   * No `I`, `O`, `U` or `1`/`0` lookalikes, so a code read off a printed
   * certificate or a QR code cannot be mistyped into a different valid one.
   */
  it("avoids letters that are misread", () => {
    const codes = Array.from({ length: 200 }, () => newPublicCode()).join("");
    expect(codes).not.toMatch(/[IOUL]/);
  });

  it("does not repeat itself", () => {
    const codes = new Set(Array.from({ length: 500 }, () => newPublicCode()));
    expect(codes.size).toBe(500);
  });
});
