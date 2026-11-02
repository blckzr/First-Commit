import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { readFileSync } from "node:fs";
import { createApp } from "../app.js";
import { createTestDb, type TestDb } from "@first-commit/test-db";
import { post } from "../test/http.js";
import type { Mailer } from "../mail/index.js";
import { config } from "../config.js";

/**
 * Explore modules (design.md §5.13).
 *
 * Two things carry most of this file. **Only published content leaves** — a
 * draft module, or a published module whose only version is a draft, is an
 * admin's unfinished work. And **adding to a roadmap writes a plan, never
 * evidence**: §6 rule 1 means a learner who can edit their own roadmap still
 * cannot award themselves a completion.
 *
 * The fixtures are built so a wrong query returns a *different* number rather
 * than the same one — two skills, two paths, a technology module, a
 * prerequisite chain, and one module deliberately left in draft.
 */

const silentMailer: Mailer = { name: "test", async send() {} };

let db: TestDb;
let app: Express;
let cookie: string;
let learnerId: string;
let ids: Record<string, string>;

const read = (path: string) => request(app).get(path).set("Cookie", cookie);
const write = (path: string) =>
  request(app).post(path).set("Cookie", cookie).set("Origin", config.appOrigin);

async function seed(): Promise<Record<string, string>> {
  const one = async (sql: string, v: unknown[] = []) =>
    (await db.pool.query<{ id: string }>(sql, v)).rows[0].id;
  const out: Record<string, string> = {};

  out.web = await one(
    `insert into career_paths (slug, title, status) values ('jwd','Junior Web Developer','published') returning id`,
  );
  out.data = await one(
    `insert into career_paths (slug, title, status) values ('data','Data','published') returning id`,
  );
  // A path nobody should see options for.
  out.draftPath = await one(
    `insert into career_paths (slug, title, status) values ('secret','Secret Path','draft') returning id`,
  );

  out.js = await one(`insert into skills (slug, name) values ('js','JavaScript') returning id`);
  out.css = await one(`insert into skills (slug, name) values ('css','CSS') returning id`);

  out.react = await one(
    `insert into technologies (slug, name) values ('react','React') returning id`,
  );
  out.vue = await one(`insert into technologies (slug, name) values ('vue','Vue') returning id`);

  /** A published module with a published version. */
  const published = async (
    key: string,
    skill: string,
    slug: string,
    title: string,
    hours: number,
    technology: string | null = null,
    description = "",
  ) => {
    out[key] = await one(
      `insert into modules (skill_id, kind, slug, status, technology_id)
       values ($1, $2, $3, 'published', $4) returning id`,
      [skill, technology ? "technology" : "core", slug, technology],
    );
    out[`${key}V`] = await one(
      `insert into module_versions (module_id, version_no, title, description, status, estimated_hours)
       values ($1, 1, $2, $3, 'published', $4) returning id`,
      [out[key], title, description, hours],
    );
  };

  await published("basics", out.js, "js-basics", "JavaScript basics", 3, null, "Variables and loops");
  await published("arrays", out.js, "js-arrays", "Arrays and objects", 2);
  await published("boxes", out.css, "css-box", "The box model", 1.5, null, "Padding and margins");
  await published("reactComp", out.js, "react-components", "Components in React", 4, out.react);
  await published("vueComp", out.js, "vue-components", "Components in Vue", 4, out.vue);

  /** Draft module — must never appear. */
  out.draft = await one(
    `insert into modules (skill_id, kind, slug, status) values ($1,'core','js-secret','draft') returning id`,
    [out.js],
  );
  await one(
    `insert into module_versions (module_id, version_no, title, status, estimated_hours)
     values ($1,1,'Unfinished module','published',1) returning id`,
    [out.draft],
  );

  /**
   * Published module whose only version is a draft. The second half of the
   * rule, and the half a `modules.status` filter alone would miss.
   */
  out.unversioned = await one(
    `insert into modules (skill_id, kind, slug, status) values ($1,'core','js-draft-version','published') returning id`,
    [out.js],
  );
  await one(
    `insert into module_versions (module_id, version_no, title, status, estimated_hours)
     values ($1,1,'Draft version only','draft',1) returning id`,
    [out.unversioned],
  );

  // Arrays and objects needs JavaScript basics.
  await db.pool.query(
    `insert into module_prerequisites (module_id, requires_module_id) values ($1,$2)`,
    [out.arrays, out.basics],
  );

  /**
   * Path attachment: JavaScript sits on both paths, CSS on the web path only.
   * So "The box model" carries one badge and the JS modules carry two — a
   * wrong join would give every module the same count.
   */
  const attach = async (path: string, skill: string, modules: string[]) => {
    const pathSkill = await one(
      `insert into path_skills (career_path_id, skill_id, layer) values ($1,$2,'core') returning id`,
      [path, skill],
    );
    for (const [i, moduleId] of modules.entries()) {
      await db.pool.query(
        `insert into path_skill_modules (path_skill_id, module_id, sort_order) values ($1,$2,$3)`,
        [pathSkill, moduleId, i],
      );
    }
  };

  await attach(out.web, out.js, [out.basics, out.arrays]);
  await attach(out.data, out.js, [out.basics, out.arrays]);
  await attach(out.web, out.css, [out.boxes]);

  return out;
}

const complete = (moduleKey: string, method = "passed", score = 88) =>
  db.pool.query(
    `insert into module_completions (user_id, module_id, module_version_id, method, score)
     values ($1,$2,$3,$4::completion_method,$5)`,
    [learnerId, ids[moduleKey], ids[`${moduleKey}V`], method, score],
  );

const enrol = (moduleKey: string) =>
  db.pool.query(
    `insert into module_enrollments (user_id, module_id, module_version_id) values ($1,$2,$3)`,
    [learnerId, ids[moduleKey], ids[`${moduleKey}V`]],
  );

async function makeRoadmap(status = "active", userId?: string) {
  const { rows } = await db.pool.query<{ id: string }>(
    `insert into roadmaps (user_id, career_path_id, status) values ($1,$2,$3::roadmap_status) returning id`,
    [userId ?? learnerId, ids.web, status],
  );
  return rows[0].id;
}

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

const titles = (body: { modules: { title: string }[] }) => body.modules.map((m) => m.title);

describe("the catalogue", () => {
  it("lists every published module once", async () => {
    const res = await read("/explore");

    expect(res.status).toBe(200);
    expect(titles(res.body).sort()).toEqual([
      "Arrays and objects",
      "Components in React",
      "Components in Vue",
      "JavaScript basics",
      "The box model",
    ]);
    expect(res.body.total).toBe(5);
  });

  /** §5.13 shows the catalogue, not the admin's workbench. */
  it("never shows a draft module", async () => {
    const res = await read("/explore");
    expect(titles(res.body)).not.toContain("Unfinished module");
  });

  /**
   * The other half of the rule. A `modules.status = 'published'` filter alone
   * passes this module through, carrying a title nobody signed off.
   */
  it("never shows a published module whose only version is a draft", async () => {
    const res = await read("/explore");
    expect(titles(res.body)).not.toContain("Draft version only");
  });

  it("carries what §5.13's row shows", async () => {
    const res = await read("/explore?skillId=" + ids.css);
    const row = res.body.modules[0];

    expect(row.title).toBe("The box model");
    expect(row.skill.name).toBe("CSS");
    expect(row.estimatedHours).toBe(1.5);
    expect(row.technology).toBeNull();
    expect(row.paths).toEqual(["Junior Web Developer"]);
  });

  it("gives a technology module its badge", async () => {
    const res = await read("/explore?technologyId=" + ids.react);

    expect(titles(res.body)).toEqual(["Components in React"]);
    expect(res.body.modules[0].technology).toEqual({ id: ids.react, name: "React" });
  });

  /**
   * §2.1's "Also in: Data" — and the count differs per module, so a join that
   * attached every path to every module would be caught here rather than
   * agreeing by accident.
   */
  it("lists every path a module appears on", async () => {
    const res = await read("/explore");
    const byTitle = Object.fromEntries(
      res.body.modules.map((m: { title: string; paths: string[] }) => [m.title, m.paths]),
    );

    expect(byTitle["JavaScript basics"].sort()).toEqual(["Data", "Junior Web Developer"]);
    expect(byTitle["The box model"]).toEqual(["Junior Web Developer"]);
    // Not attached to any path at all.
    expect(byTitle["Components in React"]).toEqual([]);
  });

  it("orders by skill then title, so the list is stable", async () => {
    const res = await read("/explore");
    expect(titles(res.body)).toEqual([
      "The box model",
      "Arrays and objects",
      "Components in React",
      "Components in Vue",
      "JavaScript basics",
    ]);
  });
});

describe("search", () => {
  it("matches a title", async () => {
    const res = await read("/explore?q=box");
    expect(titles(res.body)).toEqual(["The box model"]);
  });

  it("matches a description, not only a title", async () => {
    const res = await read("/explore?q=margins");
    expect(titles(res.body)).toEqual(["The box model"]);
  });

  /** Searching "react" should find the React module by its skill too. */
  it("matches a skill name", async () => {
    const res = await read("/explore?q=javascript");
    expect(titles(res.body)).toContain("Arrays and objects");
    expect(titles(res.body)).not.toContain("The box model");
  });

  it("ignores case", async () => {
    const res = await read("/explore?q=BOX");
    expect(titles(res.body)).toEqual(["The box model"]);
  });

  it("treats blank as no search", async () => {
    const res = await read("/explore?q=%20%20");
    expect(res.body.total).toBe(5);
  });

  it("reports an empty result rather than failing", async () => {
    const res = await read("/explore?q=kubernetes");
    expect(res.status).toBe(200);
    expect(res.body.modules).toEqual([]);
    expect(res.body.total).toBe(0);
  });
});

describe("filters", () => {
  it("filters by skill", async () => {
    const res = await read("/explore?skillId=" + ids.css);
    expect(titles(res.body)).toEqual(["The box model"]);
    expect(res.body.total).toBe(1);
  });

  it("filters by career path", async () => {
    const res = await read("/explore?careerPathId=" + ids.data);
    expect(titles(res.body).sort()).toEqual(["Arrays and objects", "JavaScript basics"]);
  });

  /** A module on two paths must come back once, not twice. */
  it("does not duplicate a module that sits on the filtered path twice", async () => {
    await db.pool.query(
      `insert into path_skills (career_path_id, skill_id, layer, track_id) values ($1,$2,'core',null)
       on conflict do nothing`,
      [ids.web, ids.css],
    );
    const res = await read("/explore?careerPathId=" + ids.web);
    const found = titles(res.body).filter((t) => t === "JavaScript basics");
    expect(found).toHaveLength(1);
  });

  it("combines filters", async () => {
    const res = await read(`/explore?careerPathId=${ids.web}&skillId=${ids.js}`);
    expect(titles(res.body).sort()).toEqual(["Arrays and objects", "JavaScript basics"]);
  });

  it("ignores a malformed id rather than failing", async () => {
    const res = await read("/explore?skillId=not-a-uuid");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(5);
  });

  it("ignores a repeated parameter", async () => {
    const res = await read(`/explore?skillId=${ids.css}&skillId=${ids.js}`);
    expect(res.status).toBe(200);
    // Express gives an array; it is dropped rather than half-applied.
    expect(res.body.total).toBe(5);
  });
});

describe("the learner's own status", () => {
  it("reports a passed module with its score", async () => {
    await complete("basics");
    const res = await read("/explore?q=basics");
    const row = res.body.modules[0];

    expect(row.progress).toBe("passed");
    expect(row.method).toBe("passed");
    expect(row.score).toBe(88);
  });

  it("distinguishes tested out from passed", async () => {
    await complete("basics", "tested_out", 95);
    const res = await read("/explore?q=basics");
    expect(res.body.modules[0].method).toBe("tested_out");
  });

  it("reports an enrolled module as in progress", async () => {
    await enrol("boxes");
    const res = await read("/explore?q=box");

    expect(res.body.modules[0].progress).toBe("in_progress");
    expect(res.body.modules[0].score).toBeNull();
  });

  it("reports everything else as not started", async () => {
    const res = await read("/explore?q=box");
    expect(res.body.modules[0].progress).toBe("not_started");
  });

  /** A completion outranks an enrolment: a module is finished, not both. */
  it("reports a module that was started and then passed as passed", async () => {
    await enrol("basics");
    await complete("basics");
    const res = await read("/explore?q=basics");
    expect(res.body.modules[0].progress).toBe("passed");
  });

  it("filters by passed", async () => {
    await complete("basics");
    const res = await read("/explore?status=passed");
    expect(titles(res.body)).toEqual(["JavaScript basics"]);
    expect(res.body.total).toBe(1);
  });

  it("filters by in progress", async () => {
    await complete("basics");
    await enrol("boxes");
    const res = await read("/explore?status=in_progress");
    expect(titles(res.body)).toEqual(["The box model"]);
  });

  it("filters by not started", async () => {
    await complete("basics");
    await enrol("boxes");
    const res = await read("/explore?status=not_started");
    expect(titles(res.body).sort()).toEqual([
      "Arrays and objects",
      "Components in React",
      "Components in Vue",
    ]);
  });

  it("ignores an unknown status", async () => {
    const res = await read("/explore?status=nonsense");
    expect(res.body.total).toBe(5);
  });

  /** §6.1 step 3 — another learner's progress is not this learner's. */
  it("never reads somebody else's progress", async () => {
    const other = await post(app, "/auth/signup").send({
      fullName: "Other",
      email: "other@example.com",
      password: "a-good-password",
    });
    const otherId = (
      await db.pool.query<{ id: string }>(`select id from users where email = 'other@example.com'`)
    ).rows[0].id;
    await db.pool.query(
      `insert into module_completions (user_id, module_id, module_version_id, method, score)
       values ($1,$2,$3,'passed'::completion_method,100)`,
      [otherId, ids.basics, ids.basicsV],
    );
    expect(other.status).toBe(201);

    const res = await read("/explore?q=basics");
    expect(res.body.modules[0].progress).toBe("not_started");
    expect(res.body.modules[0].score).toBeNull();
  });
});

describe("prerequisites", () => {
  /** §9's "Pass JavaScript basics to unlock this module." */
  it("names what has to be passed first", async () => {
    const res = await read("/explore?q=arrays");
    expect(res.body.modules[0].locked).toEqual(["JavaScript basics"]);
  });

  it("stops naming it once it is passed", async () => {
    await complete("basics");
    const res = await read("/explore?q=arrays");
    expect(res.body.modules[0].locked).toEqual([]);
  });

  /** §6 rule 7: testing out is evidence, and counts the same. */
  it("counts a tested-out prerequisite", async () => {
    await complete("basics", "tested_out", 92);
    const res = await read("/explore?q=arrays");
    expect(res.body.modules[0].locked).toEqual([]);
  });

  it("says nothing for a module with no prerequisites", async () => {
    const res = await read("/explore?q=box");
    expect(res.body.modules[0].locked).toEqual([]);
  });
});

describe("paging", () => {
  it("reports the page size and the full total", async () => {
    const res = await read("/explore");
    expect(res.body.page).toBe(1);
    expect(res.body.pageSize).toBe(20);
    expect(res.body.total).toBe(5);
  });

  /**
   * The total must count the *filtered* set, not the catalogue. A count that
   * ignored the filters would show a paginator promising pages of nothing.
   */
  it("counts the filtered set, not everything", async () => {
    const res = await read("/explore?skillId=" + ids.css);
    expect(res.body.total).toBe(1);
    expect(res.body.modules).toHaveLength(1);
  });

  it("returns an empty page past the end rather than failing", async () => {
    const res = await read("/explore?page=9");
    expect(res.status).toBe(200);
    expect(res.body.modules).toEqual([]);
    expect(res.body.total).toBe(5);
  });

  it("treats a nonsense page as the first", async () => {
    const res = await read("/explore?page=-3");
    expect(res.body.page).toBe(1);
    expect(res.body.modules).toHaveLength(5);
  });
});

describe("the filter options", () => {
  it("offers only skills with a published module", async () => {
    const res = await read("/explore/filters");
    expect(res.body.skills.map((s: { name: string }) => s.name).sort()).toEqual([
      "CSS",
      "JavaScript",
    ]);
  });

  it("offers the technologies that have one", async () => {
    const res = await read("/explore/filters");
    expect(res.body.technologies.map((t: { name: string }) => t.name).sort()).toEqual([
      "React",
      "Vue",
    ]);
  });

  /** A draft path is not an option; picking it would return nothing. */
  it("offers only published career paths with modules on them", async () => {
    const res = await read("/explore/filters");
    const names = res.body.careerPaths.map((p: { name: string }) => p.name);
    expect(names.sort()).toEqual(["Data", "Junior Web Developer"]);
    expect(names).not.toContain("Secret Path");
  });

  it("leaves out a technology whose only module is a draft", async () => {
    const svelte = (
      await db.pool.query<{ id: string }>(
        `insert into technologies (slug, name) values ('svelte','Svelte') returning id`,
      )
    ).rows[0].id;
    await db.pool.query(
      `insert into modules (skill_id, kind, slug, status, technology_id)
       values ($1,'technology','svelte-components','draft',$2)`,
      [ids.js, svelte],
    );

    const res = await read("/explore/filters");
    expect(res.body.technologies.map((t: { name: string }) => t.name)).not.toContain("Svelte");
  });
});

describe("adding a module to a roadmap", () => {
  it("adds it as the learner's own choice", async () => {
    const roadmapId = await makeRoadmap();

    const res = await write(`/roadmaps/${roadmapId}/items`).send({ moduleId: ids.boxes });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ added: true, title: "The box model" });

    const { rows } = await db.pool.query<{ source: string; status: string }>(
      `select source, status from roadmap_items where roadmap_id = $1 and module_id = $2`,
      [roadmapId, ids.boxes],
    );
    expect(rows[0].source).toBe("learner_added");
    expect(rows[0].status).toBe("active");
  });

  it("shows up as on the roadmap afterwards", async () => {
    const roadmapId = await makeRoadmap();
    await write(`/roadmaps/${roadmapId}/items`).send({ moduleId: ids.boxes }).expect(200);

    const res = await read("/explore?q=box");
    expect(res.body.modules[0].onRoadmap).toBe(true);
  });

  /**
   * Both of these were missing until mutation testing removed the two status
   * checks in `alreadyOnARoadmap` and every test still passed. The docblock
   * there makes two claims; neither was covered.
   */
  it("does not count a module on an archived roadmap", async () => {
    const archived = await makeRoadmap("archived");
    await db.pool.query(
      `insert into roadmap_items (roadmap_id, module_id, sort_order, source) values ($1,$2,1,'generated')`,
      [archived, ids.boxes],
    );

    const res = await read("/explore?q=box");

    // A learner who put a plan away must be able to add the module to the one
    // they are using.
    expect(res.body.modules[0].onRoadmap).toBe(false);
  });

  it("does not count a module that was removed from an active roadmap", async () => {
    const roadmapId = await makeRoadmap();
    await db.pool.query(
      `insert into roadmap_items (roadmap_id, module_id, sort_order, source, status)
       values ($1,$2,1,'generated','removed')`,
      [roadmapId, ids.boxes],
    );

    const res = await read("/explore?q=box");
    expect(res.body.modules[0].onRoadmap).toBe(false);
  });

  it("appends after everything already planned", async () => {
    const roadmapId = await makeRoadmap();
    await db.pool.query(
      `insert into roadmap_items (roadmap_id, module_id, sort_order, source) values ($1,$2,7,'generated')`,
      [roadmapId, ids.basics],
    );

    await write(`/roadmaps/${roadmapId}/items`).send({ moduleId: ids.boxes }).expect(200);

    const { rows } = await db.pool.query<{ sort_order: number }>(
      `select sort_order from roadmap_items where roadmap_id = $1 and module_id = $2`,
      [roadmapId, ids.boxes],
    );
    expect(Number(rows[0].sort_order)).toBe(8);
  });

  it("says so rather than failing when it is already there", async () => {
    const roadmapId = await makeRoadmap();
    await write(`/roadmaps/${roadmapId}/items`).send({ moduleId: ids.boxes }).expect(200);

    const res = await write(`/roadmaps/${roadmapId}/items`).send({ moduleId: ids.boxes });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ added: false, reason: "already-on-roadmap" });

    const { rowCount } = await db.pool.query(
      `select module_id from roadmap_items where roadmap_id = $1 and module_id = $2`,
      [roadmapId, ids.boxes],
    );
    expect(rowCount).toBe(1);
  });

  /**
   * §5.8 takes the other technologies' modules off with `status = 'removed'`.
   * A learner who changes their mind must be able to put one back, and it
   * should return to where it was rather than to the end.
   */
  it("puts back a module that was removed, keeping its place", async () => {
    const roadmapId = await makeRoadmap();
    await db.pool.query(
      `insert into roadmap_items (roadmap_id, module_id, sort_order, source, status)
       values ($1,$2,2,'generated','removed')`,
      [roadmapId, ids.vueComp],
    );

    const res = await write(`/roadmaps/${roadmapId}/items`).send({ moduleId: ids.vueComp });

    expect(res.body.added).toBe(true);
    const { rows } = await db.pool.query<{ status: string; sort_order: number }>(
      `select status, sort_order from roadmap_items where roadmap_id = $1 and module_id = $2`,
      [roadmapId, ids.vueComp],
    );
    expect(rows[0].status).toBe("active");
    expect(Number(rows[0].sort_order)).toBe(2);
  });

  /** A locked module can still be planned — §5.9 is where the lock is enforced. */
  it("adds a module whose prerequisites are unmet", async () => {
    const roadmapId = await makeRoadmap();

    const res = await write(`/roadmaps/${roadmapId}/items`).send({ moduleId: ids.arrays });

    expect(res.status).toBe(200);
    expect(res.body.added).toBe(true);
  });

  /* ---- what it refuses ---- */

  it("refuses somebody else's roadmap with a 404", async () => {
    await post(app, "/auth/signup").send({
      fullName: "Other",
      email: "other@example.com",
      password: "a-good-password",
    });
    const otherId = (
      await db.pool.query<{ id: string }>(`select id from users where email = 'other@example.com'`)
    ).rows[0].id;
    const theirs = await makeRoadmap("active", otherId);

    const res = await write(`/roadmaps/${theirs}/items`).send({ moduleId: ids.boxes });

    expect(res.status).toBe(404);
    const { rowCount } = await db.pool.query(
      `select module_id from roadmap_items where roadmap_id = $1`,
      [theirs],
    );
    expect(rowCount).toBe(0);
  });

  it("refuses a roadmap that does not exist", async () => {
    const res = await write(`/roadmaps/1ff1c0de-0000-4000-8000-000000000000/items`).send({
      moduleId: ids.boxes,
    });
    expect(res.status).toBe(404);
  });

  it("refuses a malformed roadmap id", async () => {
    const res = await write(`/roadmaps/nope/items`).send({ moduleId: ids.boxes });
    expect(res.status).toBe(404);
  });

  it("refuses an archived roadmap, and says how to fix it", async () => {
    const roadmapId = await makeRoadmap("archived");

    const res = await write(`/roadmaps/${roadmapId}/items`).send({ moduleId: ids.boxes });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/restore it from my roadmaps/i);
  });

  it("refuses a completed roadmap", async () => {
    const roadmapId = await makeRoadmap("completed");

    const res = await write(`/roadmaps/${roadmapId}/items`).send({ moduleId: ids.boxes });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/finished/i);
  });

  it("refuses a draft module", async () => {
    const roadmapId = await makeRoadmap();

    const res = await write(`/roadmaps/${roadmapId}/items`).send({ moduleId: ids.draft });

    expect(res.status).toBe(404);
  });

  it("refuses a module whose only version is a draft", async () => {
    const roadmapId = await makeRoadmap();

    const res = await write(`/roadmaps/${roadmapId}/items`).send({ moduleId: ids.unversioned });

    expect(res.status).toBe(404);
  });

  it("refuses a body with no module", async () => {
    const roadmapId = await makeRoadmap();
    const res = await write(`/roadmaps/${roadmapId}/items`).send({});
    expect(res.status).toBe(400);
  });

  /**
   * §6 rule 1. The body is `.strict()`, so a request that smuggles a
   * completion alongside the module id is refused outright rather than having
   * the extra field ignored — an ignored field is one that gets accepted later
   * by accident.
   */
  it("refuses a body that carries a completion", async () => {
    const roadmapId = await makeRoadmap();

    const res = await write(`/roadmaps/${roadmapId}/items`).send({
      moduleId: ids.boxes,
      passed: true,
      score: 100,
    });

    expect(res.status).toBe(400);
    const { rowCount } = await db.pool.query(
      `select user_id from module_completions where user_id = $1`,
      [learnerId],
    );
    expect(rowCount).toBe(0);
  });

  /**
   * And the rule stated against the module, not only against a body a test
   * thought to send. Comments are stripped first so the file's own
   * documentation of the rule cannot satisfy it.
   */
  it("writes no evidence table anywhere in the module", () => {
    const code = readFileSync(new URL("./routes.ts", import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*/g, "");

    expect(code).not.toMatch(/insert\s+into\s+module_completions/i);
    expect(code).not.toMatch(/insert\s+into\s+assessment_attempts/i);
    expect(code).not.toMatch(/insert\s+into\s+certificates/i);
    expect(code).not.toMatch(/insert\s+into\s+milestone_attempts/i);
  });
});
