import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../app.js";
import { createTestDb, type TestDb } from "@first-commit/test-db";
import { post } from "../test/http.js";
import type { Mailer } from "../mail/index.js";
import { config } from "../config.js";

const silentMailer: Mailer = { name: "test", async send() {} };

let db: TestDb;
let app: Express;
let cookie: string;
let learnerId: string;
let roadmapId: string;
let ids: Record<string, string>;

const read = (path: string) => request(app).get(path).set("Cookie", cookie);
const send = (path: string) =>
  request(app).post(path).set("Cookie", cookie).set("Origin", config.appOrigin);

const url = () => `/roadmaps/${roadmapId}/decisions/${ids.decision}`;

/** Modules on a roadmap, by title, with their status. */
const items = (id = roadmapId) => {
  const versions = db.rows("module_versions");
  return db
    .rows("roadmap_items")
    .filter((i) => i.roadmap_id === id)
    .map((i) => ({
      title: versions.find((v) => v.module_id === i.module_id)!.title as string,
      status: i.status as string,
    }))
    .sort((a, b) => a.title.localeCompare(b.title));
};

/**
 * One core skill, one Frontend concept skill, and the concept skill's React and
 * Vue modules — the shape §5.8 exists for.
 */
async function buildContent(): Promise<void> {
  ids = {};
  const one = async (sql: string, values: unknown[] = []) =>
    (await db.pool.query<{ id: string }>(sql, values)).rows[0].id;

  ids.path = await one(
    `insert into career_paths (slug, title, status) values ('jwd','Junior Web Developer','published') returning id`,
  );
  ids.track = await one(
    `insert into tracks (career_path_id, title, status) values ($1,'Frontend','published') returning id`,
    [ids.path],
  );
  ids.react = await one(
    `insert into technologies (slug, name, description) values ('react','React','Build UIs from components.') returning id`,
  );
  ids.vue = await one(
    `insert into technologies (slug, name, description) values ('vue','Vue','Build UIs with templates.') returning id`,
  );

  ids.decision = await one(
    `insert into technology_decisions (track_id, title) values ($1,'Choose your framework') returning id`,
    [ids.track],
  );
  for (const [tech, curve] of [
    [ids.react, "moderate"],
    [ids.vue, "gentler"],
  ] as const) {
    await db.pool.query(
      `insert into decision_options (decision_id, technology_id, comparison, status)
       values ($1,$2,$3,'published')`,
      [ids.decision, tech, JSON.stringify({ learningCurve: curve })],
    );
  }

  ids.htmlSkill = await one(`insert into skills (slug,name) values ('html','HTML') returning id`);
  ids.componentsSkill = await one(
    `insert into skills (slug,name) values ('components','Components') returning id`,
  );
  ids.htmlPathSkill = await one(
    `insert into path_skills (career_path_id, track_id, skill_id, layer, sort_order)
     values ($1, null, $2, 'core', 0) returning id`,
    [ids.path, ids.htmlSkill],
  );
  ids.componentsPathSkill = await one(
    `insert into path_skills (career_path_id, track_id, skill_id, layer, sort_order)
     values ($1, $2, $3, 'concept', 0) returning id`,
    [ids.path, ids.track, ids.componentsSkill],
  );

  const addModule = async (
    key: string,
    skill: string,
    pathSkill: string,
    slug: string,
    title: string,
    order: number,
    technology: string | null = null,
  ) => {
    ids[key] = await one(
      `insert into modules (skill_id, kind, technology_id, slug, status)
       values ($1,$2,$3,$4,'published') returning id`,
      [skill, technology ? "technology" : "core", technology, slug],
    );
    ids[`${key}Version`] = await one(
      `insert into module_versions (module_id, version_no, title, estimated_hours, status)
       values ($1,1,$2,4,'published') returning id`,
      [ids[key], title],
    );
    await db.pool.query(
      `insert into path_skill_modules (path_skill_id, module_id, sort_order) values ($1,$2,$3)`,
      [pathSkill, ids[key], order],
    );
  };

  await addModule("htmlBasics", ids.htmlSkill, ids.htmlPathSkill, "html-basics", "HTML basics", 0);
  await addModule("whatAre", ids.componentsSkill, ids.componentsPathSkill, "what-are", "What are components", 0);
  await addModule("reactComponents", ids.componentsSkill, ids.componentsPathSkill, "react-components", "Components in React", 1, ids.react);
  await addModule("reactState", ids.componentsSkill, ids.componentsPathSkill, "react-state", "State and props in React", 2, ids.react);
  await addModule("vueComponents", ids.componentsSkill, ids.componentsPathSkill, "vue-components", "Components in Vue", 1, ids.vue);
  await addModule("vueState", ids.componentsSkill, ids.componentsPathSkill, "vue-state", "State and props in Vue", 2, ids.vue);
}

/** A roadmap as the worker leaves it: core and concept modules, no technology ones. */
async function buildRoadmapRow(userId: string): Promise<string> {
  const roadmap = await db.pool.query<{ id: string }>(
    `insert into roadmaps (user_id, career_path_id, track_id, weekly_hours, status)
     values ($1,$2,$3,6,'active') returning id`,
    [userId, ids.path, ids.track],
  );
  const id = roadmap.rows[0].id;
  for (const [i, moduleId] of [ids.htmlBasics, ids.whatAre].entries()) {
    await db.pool.query(
      `insert into roadmap_items (roadmap_id, module_id, sort_order, source) values ($1,$2,$3,'generated')`,
      [id, moduleId, i],
    );
  }
  await db.pool.query(
    `insert into roadmap_technology_choices (roadmap_id, decision_id) values ($1,$2)`,
    [id, ids.decision],
  );
  return id;
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
  learnerId = (db.rows("users")[0] as { id: string }).id;

  await buildContent();
  roadmapId = await buildRoadmapRow(learnerId);
});

describe("GET the decision", () => {
  it("returns the options with their comparison", async () => {
    const res = await read(url());
    expect(res.status).toBe(200);

    const decision = res.body.decision;
    expect(decision.title).toBe("Choose your framework");
    expect(decision.trackTitle).toBe("Frontend");
    expect(decision.chosenTechnologyId).toBeNull();
    expect(decision.options.map((o: { name: string }) => o.name)).toEqual(["React", "Vue"]);
    expect(decision.options[0].comparison).toEqual({ learningCurve: "moderate" });
  });

  /** §5.8's cards say what each choice brings with it. */
  it("says how many modules each option adds", async () => {
    const decision = (await read(url())).body.decision;
    expect(decision.options.every((o: { moduleCount: number }) => o.moduleCount === 2)).toBe(true);
  });

  /**
   * §5.8's switch dialog: "Your 3 passed React modules stay on your resume."
   * The count comes from evidence, not from the roadmap.
   */
  it("counts modules already passed under each technology", async () => {
    await db.pool.query(
      `insert into module_completions (user_id, module_id, module_version_id, method, score)
       values ($1,$2,$3,'passed',88)`,
      [learnerId, ids.reactComponents, ids.reactComponentsVersion],
    );

    const decision = (await read(url())).body.decision;
    const react = decision.options.find((o: { name: string }) => o.name === "React");
    const vue = decision.options.find((o: { name: string }) => o.name === "Vue");
    expect(react.passedCount).toBe(1);
    expect(vue.passedCount).toBe(0);
  });

  /**
   * The count is evidence, and evidence belongs to one learner. Another
   * learner passing React modules must not make this learner's switch dialog
   * claim they have passed any.
   */
  it("counts only the caller's completions", async () => {
    const other = await db.pool.query<{ id: string }>(
      `insert into users (email, password_hash, full_name)
       values ('other@example.com','h','Other') returning id`,
    );
    await db.pool.query(
      `insert into module_completions (user_id, module_id, module_version_id, method, score)
       values ($1,$2,$3,'passed',88)`,
      [other.rows[0].id, ids.reactComponents, ids.reactComponentsVersion],
    );

    const decision = (await read(url())).body.decision;
    expect(decision.options.every((o: { passedCount: number }) => o.passedCount === 0)).toBe(true);
  });

  /** The recommendation is its own AI job and is not built; absent, not guessed. */
  it("has no recommendation until one is written", async () => {
    expect((await read(url())).body.decision.recommendation).toBeNull();
  });

  it("returns the recommendation once there is one", async () => {
    await db.pool.query(
      `update roadmap_technology_choices
          set recommended_technology_id = $1, recommendation_reason = $2
        where roadmap_id = $3 and decision_id = $4`,
      [ids.react, "You want a company job, and React appears in more junior postings.", roadmapId, ids.decision],
    );

    const recommendation = (await read(url())).body.decision.recommendation;
    expect(recommendation.technologyId).toBe(ids.react);
    expect(recommendation.reason).toMatch(/junior postings/);
  });

  it("hides an unpublished option", async () => {
    await db.pool.query(
      `update decision_options set status = 'draft' where decision_id = $1 and technology_id = $2`,
      [ids.decision, ids.vue],
    );
    const decision = (await read(url())).body.decision;
    expect(decision.options.map((o: { name: string }) => o.name)).toEqual(["React"]);
  });
});

describe("ownership", () => {
  it("needs a session", async () => {
    expect((await request(app).get(url())).status).toBe(401);
  });

  it("does not serve a decision on another learner's roadmap", async () => {
    const other = await db.pool.query<{ id: string }>(
      `insert into users (email, password_hash, full_name)
       values ('other@example.com','h','Other') returning id`,
    );
    const theirs = await buildRoadmapRow(other.rows[0].id);

    const res = await read(`/roadmaps/${theirs}/decisions/${ids.decision}`);
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toMatch(/React|Frontend/);
  });

  it("does not let a learner choose on another learner's roadmap", async () => {
    const other = await db.pool.query<{ id: string }>(
      `insert into users (email, password_hash, full_name)
       values ('other@example.com','h','Other') returning id`,
    );
    const theirs = await buildRoadmapRow(other.rows[0].id);

    const res = await send(`/roadmaps/${theirs}/decisions/${ids.decision}`).send({
      technologyId: ids.react,
    });

    expect(res.status).toBe(404);
    // Their roadmap is untouched: still just the two the worker planned.
    expect(items(theirs)).toHaveLength(2);
    const choice = db.rows("roadmap_technology_choices").find((c) => c.roadmap_id === theirs)!;
    expect(choice.technology_id).toBeNull();
  });

  it("404s a decision that is not on this roadmap", async () => {
    const otherTrack = await db.pool.query<{ id: string }>(
      `insert into tracks (career_path_id, title, status) values ($1,'Backend','published') returning id`,
      [ids.path],
    );
    const otherDecision = await db.pool.query<{ id: string }>(
      `insert into technology_decisions (track_id, title) values ($1,'Choose your framework') returning id`,
      [otherTrack.rows[0].id],
    );

    expect(
      (await read(`/roadmaps/${roadmapId}/decisions/${otherDecision.rows[0].id}`)).status,
    ).toBe(404);
  });

  it("404s a malformed id", async () => {
    expect((await read(`/roadmaps/nope/decisions/${ids.decision}`)).status).toBe(404);
  });
});

describe("choosing", () => {
  it("records the choice and adds that technology's modules", async () => {
    const res = await send(url()).send({ technologyId: ids.react });

    expect(res.status).toBe(200);
    expect(res.body.result).toMatchObject({
      technologyId: ids.react,
      added: 2,
      removed: 0,
      switched: false,
    });

    const choice = db.rows("roadmap_technology_choices")[0];
    expect(choice.technology_id).toBe(ids.react);
    expect(choice.chosen_at).not.toBeNull();

    expect(items()).toEqual([
      { title: "Components in React", status: "active" },
      { title: "HTML basics", status: "active" },
      { title: "State and props in React", status: "active" },
      { title: "What are components", status: "active" },
    ]);
  });

  /** §2.1: the technology's modules come after everything already planned. */
  it("appends the new modules after the existing ones", async () => {
    await send(url()).send({ technologyId: ids.react });

    const rows = db
      .rows("roadmap_items")
      .sort((a, b) => Number(a.sort_order) - Number(b.sort_order));
    expect(rows[0].module_id).toBe(ids.htmlBasics);
    expect(rows[1].module_id).toBe(ids.whatAre);
    expect(rows[2].module_id).toBe(ids.reactComponents);
    expect(rows[3].module_id).toBe(ids.reactState);
  });

  it("is idempotent when the same option is chosen twice", async () => {
    await send(url()).send({ technologyId: ids.react });
    const second = await send(url()).send({ technologyId: ids.react });

    expect(second.body.result.switched).toBe(false);
    expect(db.rows("roadmap_items")).toHaveLength(4);
  });

  it("refuses a technology that is not an option of this decision", async () => {
    const svelte = await db.pool.query<{ id: string }>(
      `insert into technologies (slug, name) values ('svelte','Svelte') returning id`,
    );
    const res = await send(url()).send({ technologyId: svelte.rows[0].id });

    expect(res.status).toBe(404);
    expect(db.rows("roadmap_technology_choices")[0].technology_id).toBeNull();
  });

  /**
   * The subtler one: a technology that is a perfectly valid option — of a
   * *different* decision. Choosing Express on the Frontend decision would put
   * Backend modules on a Frontend roadmap.
   */
  it("refuses a technology that belongs to another decision", async () => {
    const backendTrack = await db.pool.query<{ id: string }>(
      `insert into tracks (career_path_id, title, status) values ($1,'Backend','published') returning id`,
      [ids.path],
    );
    const backendDecision = await db.pool.query<{ id: string }>(
      `insert into technology_decisions (track_id, title) values ($1,'Choose your framework') returning id`,
      [backendTrack.rows[0].id],
    );
    const express = await db.pool.query<{ id: string }>(
      `insert into technologies (slug, name) values ('express','Express') returning id`,
    );
    await db.pool.query(
      `insert into decision_options (decision_id, technology_id, status) values ($1,$2,'published')`,
      [backendDecision.rows[0].id, express.rows[0].id],
    );

    const res = await send(url()).send({ technologyId: express.rows[0].id });

    expect(res.status).toBe(404);
    expect(db.rows("roadmap_technology_choices")[0].technology_id).toBeNull();
  });

  it("refuses an unpublished option", async () => {
    await db.pool.query(
      `update decision_options set status = 'draft' where decision_id = $1 and technology_id = $2`,
      [ids.decision, ids.vue],
    );
    expect((await send(url()).send({ technologyId: ids.vue })).status).toBe(404);
  });

  it("rejects a body carrying anything else", async () => {
    for (const extra of [{ moduleIds: [ids.reactComponents] }, { passed: true }]) {
      const res = await send(url()).send({ technologyId: ids.react, ...extra });
      expect(res.status).toBe(400);
    }
    expect(db.rows("roadmap_technology_choices")[0].technology_id).toBeNull();
  });
});

/**
 * §5.8: "Switch to Vue? Your core and concept modules stay passed. Your 3
 * passed React modules stay on your resume. Vue modules replace React modules
 * on your roadmap."
 */
describe("switching", () => {
  beforeEach(async () => {
    await send(url()).send({ technologyId: ids.react });
  });

  it("replaces the old technology's modules with the new ones", async () => {
    const res = await send(url()).send({ technologyId: ids.vue });

    expect(res.body.result).toMatchObject({ added: 2, removed: 2, switched: true });
    expect(items()).toEqual([
      { title: "Components in React", status: "removed" },
      { title: "Components in Vue", status: "active" },
      { title: "HTML basics", status: "active" },
      { title: "State and props in React", status: "removed" },
      { title: "State and props in Vue", status: "active" },
      { title: "What are components", status: "active" },
    ]);
  });

  /** The promise that matters most: evidence survives a switch untouched. */
  it("keeps every completion, including the old technology's", async () => {
    await db.pool.query(
      `insert into module_completions (user_id, module_id, module_version_id, method, score)
       values ($1,$2,$3,'passed',88), ($1,$4,$5,'passed',91)`,
      [
        learnerId,
        ids.htmlBasics,
        ids.htmlBasicsVersion,
        ids.reactComponents,
        ids.reactComponentsVersion,
      ],
    );

    await send(url()).send({ technologyId: ids.vue });

    const completions = db.rows("module_completions");
    expect(completions).toHaveLength(2);
    expect(completions.map((c) => c.module_id).sort()).toEqual(
      [ids.htmlBasics, ids.reactComponents].sort(),
    );
    // And the count is still reported, so §5.8's dialog can be honest about it.
    const decision = (await read(url())).body.decision;
    expect(decision.options.find((o: { name: string }) => o.name === "React").passedCount).toBe(1);
  });

  it("removes nothing that is not a technology module", async () => {
    await send(url()).send({ technologyId: ids.vue });
    const core = items().find((i) => i.title === "HTML basics")!;
    const concept = items().find((i) => i.title === "What are components")!;
    expect(core.status).toBe("active");
    expect(concept.status).toBe("active");
  });

  /** Switching back should find the old plan, not a duplicate of it. */
  it("reactivates the original modules when switching back", async () => {
    await send(url()).send({ technologyId: ids.vue });
    await send(url()).send({ technologyId: ids.react });

    expect(db.rows("roadmap_items")).toHaveLength(6);
    expect(items()).toEqual([
      { title: "Components in React", status: "active" },
      { title: "Components in Vue", status: "removed" },
      { title: "HTML basics", status: "active" },
      { title: "State and props in React", status: "active" },
      { title: "State and props in Vue", status: "removed" },
      { title: "What are components", status: "active" },
    ]);
  });
});
