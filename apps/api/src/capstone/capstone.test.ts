import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../app.js";
import { createTestDb, type TestDb } from "@first-commit/test-db";
import { post, put } from "../test/http.js";
import type { Mailer } from "../mail/index.js";
import { createDevGitHub } from "../github/dev.js";
import type { GitHubClient } from "../github/index.js";

const silentMailer: Mailer = { name: "test", async send() {} };

/**
 * The capstone, stage 1 (design.md §5.14).
 *
 * The endpoint decides three things from the server's own rows, and each one is
 * a way a learner could otherwise get a Project Certificate they did not earn:
 * whether the roadmap is theirs, whether the modules are finished, and **which
 * technology the project is built with**. That last one is the reason `POST`
 * takes a brief id and nothing else — a technology in the body would let
 * somebody put a framework they never studied on a certificate.
 */

let db: TestDb;
let app: Express;
let cookie: string;
let otherCookie: string;
let learnerId: string;
let ids: Record<string, string>;

const read = (path: string) => request(app).get(path).set("Cookie", cookie);
const choose = (path: string) => post(app, path).set("Cookie", cookie);

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
  out.otherTrack = await one(
    `insert into tracks (career_path_id, title, status) values ($1,'Backend','published') returning id`,
    [out.path],
  );
  out.react = await one(`insert into technologies (slug, name) values ('react','React') returning id`);
  out.vue = await one(`insert into technologies (slug, name) values ('vue','Vue') returning id`);

  out.skill = await one(`insert into skills (slug, name) values ('components','Components') returning id`);
  out.pathSkill = await one(
    `insert into path_skills (career_path_id, skill_id, layer, sort_order)
     values ($1,$2,'core',0) returning id`,
    [out.path, out.skill],
  );
  out.module = await one(
    `insert into modules (skill_id, kind, slug, status) values ($1,'core','components-in-react','published') returning id`,
    [out.skill],
  );

  // The brief a Frontend learner should be offered, with templates for both.
  out.brief = await one(
    `insert into capstone_briefs (track_id, slug, status) values ($1,'task-tracker','published') returning id`,
    [out.track],
  );
  out.version = await one(
    `insert into capstone_brief_versions (brief_id, version_no, title, description, goals, estimated_weeks, status)
     values ($1,1,'Task tracker','Keep a list of things to do.','Ship it.',3,'published') returning id`,
    [out.brief],
  );
  for (const tech of [out.react, out.vue]) {
    await db.pool.query(
      `insert into starter_templates (brief_version_id, technology_id, repo_full_name)
       values ($1,$2,$3)`,
      [out.version, tech, tech === out.react ? "fc/tt-react" : "fc/tt-vue"],
    );
  }
  out.milestone = await one(
    `insert into milestones (brief_version_id, sort_order, title) values ($1,0,'Set up') returning id`,
    [out.version],
  );
  await db.pool.query(`insert into milestone_modules (milestone_id, module_id) values ($1,$2)`, [
    out.milestone,
    out.module,
  ]);

  /** A brief on the other track, which must never appear for this learner. */
  out.otherBrief = await one(
    `insert into capstone_briefs (track_id, slug, status) values ($1,'api-service','published') returning id`,
    [out.otherTrack],
  );
  out.otherVersion = await one(
    `insert into capstone_brief_versions (brief_id, version_no, title, status)
     values ($1,1,'API service','published') returning id`,
    [out.otherBrief],
  );
  await db.pool.query(
    `insert into starter_templates (brief_version_id, technology_id, repo_full_name)
     values ($1,$2,'fc/api-express')`,
    [out.otherVersion, out.react],
  );

  /** A draft brief on the right track, which must also never appear. */
  out.draftBrief = await one(
    `insert into capstone_briefs (track_id, slug, status) values ($1,'draft-one','draft') returning id`,
    [out.track],
  );
  out.draftVersion = await one(
    `insert into capstone_brief_versions (brief_id, version_no, title, status)
     values ($1,1,'Draft brief','published') returning id`,
    [out.draftBrief],
  );
  await db.pool.query(
    `insert into starter_templates (brief_version_id, technology_id, repo_full_name)
     values ($1,$2,'fc/draft')`,
    [out.draftVersion, out.react],
  );

  return out;
}

async function giveRoadmap(): Promise<string> {
  return (
    await db.pool.query<{ id: string }>(
      `insert into roadmaps (user_id, career_path_id, track_id, status)
       values ($1,$2,$3,'active') returning id`,
      [learnerId, ids.path, ids.track],
    )
  ).rows[0].id;
}

/** The gate: the roadmap's Certificate of Completion. */
const giveCompletionCertificate = (roadmapId: string) =>
  db.pool.query(
    `insert into certificates (public_code, user_id, type, roadmap_id, recipient_name, title)
     values ('FC-AAAA-1111',$1,'completion',$2,'Jan Kevin Gerona','Junior Web Developer')`,
    [learnerId, roadmapId],
  );

const chooseTechnology = async (roadmapId: string, technologyId: string) => {
  const decision = (
    await db.pool.query<{ id: string }>(
      `insert into technology_decisions (track_id, title, sort_order)
       values ($1,'Choose your framework',0) returning id`,
      [ids.track],
    )
  ).rows[0].id;
  await db.pool.query(
    `insert into decision_options (decision_id, technology_id, status) values ($1,$2,'published')`,
    [decision, technologyId],
  );
  await db.pool.query(
    `insert into roadmap_technology_choices (roadmap_id, decision_id, technology_id, chosen_at)
     values ($1,$2,$3, now())`,
    [roadmapId, decision, technologyId],
  );
};

/** A roadmap that is ready: modules finished and a technology chosen. */
async function readyRoadmap(technologyId?: string): Promise<string> {
  const roadmap = await giveRoadmap();
  await giveCompletionCertificate(roadmap);
  await chooseTechnology(roadmap, technologyId ?? ids.react);
  return roadmap;
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

  const other = await post(app, "/auth/signup").send({
    fullName: "Someone Else",
    email: "other@example.com",
    password: "a-good-password",
  });
  otherCookie = (other.headers["set-cookie"] as unknown as string[])[0].split(";")[0];

  ids = await seed();
});

describe("who may start a capstone", () => {
  it("refuses another learner's roadmap with a 404, not a 403", async () => {
    const roadmap = await readyRoadmap();

    const res = await request(app)
      .get(`/roadmaps/${roadmap}/capstone`)
      .set("Cookie", otherCookie);

    // 403 would confirm the roadmap exists (§6.1 step 5's reasoning).
    expect(res.status).toBe(404);
  });

  it("refuses without a session", async () => {
    const roadmap = await readyRoadmap();
    expect((await request(app).get(`/roadmaps/${roadmap}/capstone`)).status).toBe(401);
  });

  it("is locked until the modules are finished", async () => {
    const roadmap = await giveRoadmap();
    await chooseTechnology(roadmap, ids.react);

    const res = await read(`/roadmaps/${roadmap}/capstone`);
    expect(res.body.stage).toBe("locked");
    expect(res.body.reason).toMatch(/finish the modules/i);
    expect(res.body.briefs).toEqual([]);
  });

  it("is locked until a technology is chosen", async () => {
    const roadmap = await giveRoadmap();
    await giveCompletionCertificate(roadmap);

    const res = await read(`/roadmaps/${roadmap}/capstone`);
    expect(res.body.stage).toBe("locked");
    expect(res.body.reason).toMatch(/technology/i);
  });

  /** A revoked certificate is not a pass (§5.15). */
  it("is locked when the completion certificate was revoked", async () => {
    const roadmap = await giveRoadmap();
    await giveCompletionCertificate(roadmap);
    await db.pool.query(
      `update certificates set status = 'revoked', revoked_reason = 'test', revoked_at = now()
        where roadmap_id = $1`,
      [roadmap],
    );
    await chooseTechnology(roadmap, ids.react);

    expect((await read(`/roadmaps/${roadmap}/capstone`)).body.stage).toBe("locked");
  });
});

describe("GET /capstone resolves the active roadmap itself", () => {
  /**
   * §5.14 has no roadmap in its address. Which roadmap a learner is on is the
   * server's answer — a browser that could name one could name somebody else's.
   */
  it("uses the learner's active roadmap", async () => {
    const roadmap = await readyRoadmap();

    const res = await read("/capstone");
    expect(res.body.stage).toBe("choose");
    expect(res.body.roadmapId).toBe(roadmap);
  });

  it("says what to do when there is no roadmap yet", async () => {
    const res = await read("/capstone");
    expect(res.body.stage).toBe("locked");
    expect(res.body.reason).toMatch(/roadmap/i);
    expect(res.body.roadmapId).toBeNull();
  });

  /** An archived roadmap is not the one to build a capstone on. */
  it("ignores an archived roadmap", async () => {
    const roadmap = await readyRoadmap();
    await db.pool.query(`update roadmaps set status = 'archived' where id = $1`, [roadmap]);

    expect((await read("/capstone")).body.roadmapId).toBeNull();
  });

  it("refuses without a session", async () => {
    expect((await request(app).get("/capstone")).status).toBe(401);
  });
});

describe("which briefs are offered", () => {
  it("offers the published brief for the learner's track", async () => {
    const roadmap = await readyRoadmap();

    const res = await read(`/roadmaps/${roadmap}/capstone`);
    expect(res.body.stage).toBe("choose");
    expect(res.body.technology).toEqual({ id: ids.react, name: "React" });
    expect(res.body.briefs).toHaveLength(1);
    expect(res.body.briefs[0]).toMatchObject({
      slug: "task-tracker",
      title: "Task tracker",
      estimatedWeeks: 3,
      milestoneCount: 1,
      starterRepo: "fc/tt-react",
    });
    expect(res.body.briefs[0].uses).toEqual(["Components"]);
  });

  /** The starter template is per technology, so the repo must follow the choice. */
  it("gives the Vue learner the Vue template", async () => {
    const roadmap = await readyRoadmap(ids.vue);

    const res = await read(`/roadmaps/${roadmap}/capstone`);
    expect(res.body.briefs[0].starterRepo).toBe("fc/tt-vue");
  });

  it("never offers a brief from another track", async () => {
    const roadmap = await readyRoadmap();

    const slugs = (await read(`/roadmaps/${roadmap}/capstone`)).body.briefs.map(
      (b: { slug: string }) => b.slug,
    );
    expect(slugs).not.toContain("api-service");
  });

  it("never offers a draft brief", async () => {
    const roadmap = await readyRoadmap();

    const slugs = (await read(`/roadmaps/${roadmap}/capstone`)).body.briefs.map(
      (b: { slug: string }) => b.slug,
    );
    expect(slugs).not.toContain("draft-one");
  });

  /**
   * A brief with no template for the learner's framework would send them to
   * stage 2 with nothing to open.
   */
  it("hides a brief that has no starter template for the chosen technology", async () => {
    const roadmap = await readyRoadmap(ids.vue);
    await db.pool.query(`delete from starter_templates where brief_version_id = $1 and technology_id = $2`, [
      ids.version,
      ids.vue,
    ]);

    expect((await read(`/roadmaps/${roadmap}/capstone`)).body.briefs).toEqual([]);
  });
});

describe("choosing one", () => {
  it("starts a project and moves to connect", async () => {
    const roadmap = await readyRoadmap();

    const res = await choose(`/roadmaps/${roadmap}/capstone`).send({ briefId: ids.brief });
    expect(res.status).toBe(201);
    expect(res.body.stage).toBe("connect");

    const project = db.rows("capstone_projects")[0];
    expect(project.user_id).toBe(learnerId);
    expect(project.roadmap_id).toBe(roadmap);
    expect(project.brief_version_id).toBe(ids.version);
    expect(project.status).toBe("connecting");
  });

  /**
   * **The technology comes from the roadmap, never the request.** A body
   * carrying one would let a learner put a framework they never studied on
   * their Project Certificate.
   */
  it("takes the technology from the roadmap and refuses one in the body", async () => {
    const roadmap = await readyRoadmap(ids.vue);

    const res = await choose(`/roadmaps/${roadmap}/capstone`).send({
      briefId: ids.brief,
      technologyId: ids.react,
    });

    expect(res.status).toBe(400);
    expect(db.rows("capstone_projects")).toHaveLength(0);
  });

  it("stores the roadmap's technology, not the other one", async () => {
    const roadmap = await readyRoadmap(ids.vue);

    await choose(`/roadmaps/${roadmap}/capstone`).send({ briefId: ids.brief });
    expect(db.rows("capstone_projects")[0].technology_id).toBe(ids.vue);
  });

  it("refuses a brief from another track even when the id is real", async () => {
    const roadmap = await readyRoadmap();

    const res = await choose(`/roadmaps/${roadmap}/capstone`).send({ briefId: ids.otherBrief });
    expect(res.status).toBe(404);
    expect(db.rows("capstone_projects")).toHaveLength(0);
  });

  it("refuses a draft brief", async () => {
    const roadmap = await readyRoadmap();

    const res = await choose(`/roadmaps/${roadmap}/capstone`).send({ briefId: ids.draftBrief });
    expect(res.status).toBe(404);
  });

  it("refuses before the modules are finished", async () => {
    const roadmap = await giveRoadmap();
    await chooseTechnology(roadmap, ids.react);

    const res = await choose(`/roadmaps/${roadmap}/capstone`).send({ briefId: ids.brief });
    expect(res.status).toBe(409);
    expect(db.rows("capstone_projects")).toHaveLength(0);
  });

  it("refuses on another learner's roadmap", async () => {
    const roadmap = await readyRoadmap();

    const res = await post(app, `/roadmaps/${roadmap}/capstone`)
      .set("Cookie", otherCookie)
      .send({ briefId: ids.brief });

    expect(res.status).toBe(404);
    expect(db.rows("capstone_projects")).toHaveLength(0);
  });

  /** `unique (roadmap_id)` — one project per roadmap, however many tabs are open. */
  it("does not start a second project on the same roadmap", async () => {
    const roadmap = await readyRoadmap();
    await choose(`/roadmaps/${roadmap}/capstone`).send({ briefId: ids.brief });

    const again = await choose(`/roadmaps/${roadmap}/capstone`).send({ briefId: ids.brief });
    expect(again.status).toBe(409);
    expect(db.rows("capstone_projects")).toHaveLength(1);
  });

  it("reports the existing project instead of offering briefs again", async () => {
    const roadmap = await readyRoadmap();
    await choose(`/roadmaps/${roadmap}/capstone`).send({ briefId: ids.brief });

    const res = await read(`/roadmaps/${roadmap}/capstone`);
    expect(res.body.stage).toBe("connect");
    expect(res.body.project).toMatchObject({ briefTitle: "Task tracker", status: "connecting" });
    expect(res.body.briefs).toEqual([]);
  });

  it("rejects a body with no brief id", async () => {
    const roadmap = await readyRoadmap();
    expect((await choose(`/roadmaps/${roadmap}/capstone`).send({})).status).toBe(400);
  });
});

describe("commits", () => {
  const INSTALLATION = 1;

  /** A project that is building, with GitHub connected — the state that syncs. */
  async function buildingProject(): Promise<string> {
    const roadmap = await readyRoadmap();
    await choose(`/roadmaps/${roadmap}/capstone`).send({ briefId: ids.brief });
    await db.pool.query(
      `insert into github_connections (user_id, github_user_id, github_username, installation_id)
       values ($1, 4242, 'learner-x', $2)`,
      [learnerId, INSTALLATION],
    );
    const [repo] = await createDevGitHub().installationRepositories(INSTALLATION);
    await put(app, `/roadmaps/${roadmap}/capstone/repository`)
      .set("Cookie", cookie)
      .send({ repositoryId: repo.id });
    return roadmap;
  }

  it("brings the history in when the capstone is read", async () => {
    const roadmap = await buildingProject();

    const res = await read(`/roadmaps/${roadmap}/capstone`);

    expect(res.body.stage).toBe("build");
    expect(res.body.project.commits.length).toBeGreaterThan(0);
    expect(db.rows("project_commits").length).toBe(res.body.project.commits.length);
  });

  it("returns them newest first, as §5.14 shows them", async () => {
    const roadmap = await buildingProject();

    const { commits } = (await read(`/roadmaps/${roadmap}/capstone`)).body.project;
    const times = commits.map((c: { pushedAt: string }) => c.pushedAt);
    expect([...times].sort().reverse()).toEqual(times);
  });

  it("asks only for what it has not seen", async () => {
    const roadmap = await buildingProject();

    await read(`/roadmaps/${roadmap}/capstone`);
    const afterFirst = db.rows("project_commits").length;
    await read(`/roadmaps/${roadmap}/capstone`);

    expect(db.rows("project_commits").length).toBe(afterFirst);
  });

  /**
   * **The one that will matter once webhooks are on**: the same push arrives
   * twice, by delivery and by this, and the history must not double.
   *
   * The client here **ignores `since`** on purpose. With one that honours it,
   * the second read returns nothing and the `on conflict` clause is never
   * reached — which is exactly what happened: removing the clause altogether
   * left the suite green, so the test above was proving the `since` filter and
   * this property had no coverage at all.
   */
  it("does not store a commit twice when GitHub returns it again", async () => {
    const roadmap = await buildingProject();
    await read(`/roadmaps/${roadmap}/capstone`);
    const afterFirst = db.rows("project_commits").length;
    expect(afterFirst).toBeGreaterThan(0);

    const forgetful: GitHubClient = {
      ...createDevGitHub(),
      // Always the full history, as a webhook redelivery would be.
      listCommits: (installationId, fullName) =>
        createDevGitHub().listCommits(installationId, fullName, null),
    };
    app = createApp({ pool: db.pool, mailer: silentMailer, github: forgetful });

    const second = await read(`/roadmaps/${roadmap}/capstone`);
    const third = await read(`/roadmaps/${roadmap}/capstone`);

    /**
     * The status matters as much as the count. Without `on conflict`, the
     * duplicate insert raises and the request 500s — which adds no rows either,
     * so a count-only assertion cannot tell a crash from working deduplication.
     * That is precisely how the first version of this test passed the mutation.
     */
    expect(second.status).toBe(200);
    expect(third.status).toBe(200);
    expect(db.rows("project_commits").length).toBe(afterFirst);
  });

  /** Nothing to fetch before a repository is chosen. */
  it("does not ask GitHub while the project is still connecting", async () => {
    let asked = false;
    const watching: GitHubClient = {
      ...createDevGitHub(),
      listCommits: (...args) => {
        asked = true;
        return createDevGitHub().listCommits(...args);
      },
    };
    app = createApp({ pool: db.pool, mailer: silentMailer, github: watching });

    const roadmap = await readyRoadmap();
    await choose(`/roadmaps/${roadmap}/capstone`).send({ briefId: ids.brief });
    await read(`/roadmaps/${roadmap}/capstone`);

    expect(asked).toBe(false);
  });

  /**
   * An unreachable GitHub is not a project without commits. The stored history
   * still comes back, flagged, because those are different sentences on §5.14.
   */
  it("keeps the stored history when GitHub cannot be reached", async () => {
    const roadmap = await buildingProject();
    await read(`/roadmaps/${roadmap}/capstone`);
    const stored = db.rows("project_commits").length;

    const unreachable: GitHubClient = {
      ...createDevGitHub(),
      listCommits: () => Promise.reject(new Error("network")),
    };
    app = createApp({ pool: db.pool, mailer: silentMailer, github: unreachable });

    const res = await read(`/roadmaps/${roadmap}/capstone`);

    expect(res.body.project.githubReachable).toBe(false);
    expect(res.body.project.commits).toHaveLength(stored);
  });

  it("does not leak another learner's commits", async () => {
    const roadmap = await buildingProject();
    await read(`/roadmaps/${roadmap}/capstone`);

    const res = await request(app)
      .get(`/roadmaps/${roadmap}/capstone`)
      .set("Cookie", otherCookie);

    expect(res.status).toBe(404);
  });
});

describe("the milestone tracker", () => {
  const INSTALLATION = 1;

  /** A project building, with a commit and the brief's milestones seeded. */
  async function tracking(): Promise<{ roadmap: string; milestones: string[] }> {
    const roadmap = await readyRoadmap();
    await choose(`/roadmaps/${roadmap}/capstone`).send({ briefId: ids.brief });
    await db.pool.query(
      `insert into github_connections (user_id, github_user_id, github_username, installation_id)
       values ($1, 4242, 'learner-x', $2)`,
      [learnerId, INSTALLATION],
    );
    const [repo] = await createDevGitHub().installationRepositories(INSTALLATION);
    await put(app, `/roadmaps/${roadmap}/capstone/repository`)
      .set("Cookie", cookie)
      .send({ repositoryId: repo.id });

    // A second milestone, so "only the current one is checked" has something to
    // be true about.
    const second = (
      await db.pool.query<{ id: string }>(
        `insert into milestones (brief_version_id, sort_order, title, acceptance_criteria, review_checklist)
         values ($1, 1, 'Build the layout', $2, $3) returning id`,
        [
          ids.version,
          JSON.stringify(["A heading", "A form"]),
          JSON.stringify(["SECRET RUBRIC — never shown to a learner"]),
        ],
      )
    ).rows[0].id;

    await db.pool.query(
      `insert into milestone_checks (milestone_id, type, name, config, sort_order)
       values ($1,'file_exists','README.md is present',$2,0)`,
      [ids.milestone, JSON.stringify({ path: "README.md" })],
    );
    await db.pool.query(
      `insert into milestone_checks (milestone_id, type, name, config, sort_order)
       values ($1,'file_exists','A task form exists',$2,0)`,
      [second, JSON.stringify({ path: "src/components/TaskForm.*" })],
    );

    // Brings the commits in, so there is a sha to judge against.
    await read(`/roadmaps/${roadmap}/capstone`);
    return { roadmap, milestones: [ids.milestone, second] };
  }

  const milestones = (roadmap: string) => read(`/roadmaps/${roadmap}/capstone/milestones`);

  it("records an attempt from checks the server ran", async () => {
    const { roadmap } = await tracking();

    const res = await milestones(roadmap);

    expect(res.status).toBe(200);
    expect(res.body.milestones).toHaveLength(2);
    expect(res.body.milestones[0].status).toBe("complete");
    expect(res.body.milestones[0].checks[0].state).toBe("passed");

    // §6 rule 1: the row exists because the API ran the check, not because a
    // browser said anything.
    const attempt = db.rows("milestone_attempts")[0];
    expect(attempt.status).toBe("complete");
    expect(attempt.commit_sha).toBeTruthy();
  });

  /**
   * **§6 rule 2.** `review_checklist` is the rubric the Code Review AI judges
   * against. `acceptance_criteria` is what §5.14 shows the learner. One must
   * never be served, the other must.
   */
  it("never sends the review checklist, and does send the acceptance criteria", async () => {
    const { roadmap } = await tracking();

    const res = await milestones(roadmap);

    expect(JSON.stringify(res.body)).not.toContain("SECRET RUBRIC");
    expect(res.body.milestones[1].acceptanceCriteria).toEqual(["A heading", "A form"]);
  });

  /** Checking all five on every read would be five times the GitHub traffic. */
  it("checks only the milestone being worked on", async () => {
    const { roadmap } = await tracking();

    await milestones(roadmap);

    // One read, one milestone judged — never the whole brief.
    expect(db.rows("milestone_attempts")).toHaveLength(1);
    expect(db.rows("milestone_attempts")[0].milestone_id).toBe(ids.milestone);
  });

  /**
   * The dev repository has no `src/components/TaskForm.*`, so the second
   * milestone fails — and failing is not pending, and not complete.
   */
  it("marks a milestone failed when a check fails", async () => {
    const { roadmap } = await tracking();

    await milestones(roadmap);
    const res = await milestones(roadmap);

    expect(res.body.milestones[1].status).toBe("failed");
    expect(res.body.milestones[1].checks[0].state).toBe("failed");
  });

  /**
   * The current milestone is worked out once per read, so the first read judges
   * milestone 1 and the second judges milestone 2. By the third, both have a
   * verdict against this commit and there is nothing left to ask GitHub.
   */
  it("does not re-judge a commit it has already judged", async () => {
    const { roadmap } = await tracking();
    await milestones(roadmap);
    await milestones(roadmap);

    let calls = 0;
    const counting: GitHubClient = {
      ...createDevGitHub(),
      listFiles: (...args) => {
        calls += 1;
        return createDevGitHub().listFiles(...args);
      },
    };
    app = createApp({ pool: db.pool, mailer: silentMailer, github: counting });

    await milestones(roadmap);

    // The completed milestone is settled, and the failed one was judged against
    // this same commit — nothing to ask GitHub about.
    expect(calls).toBe(0);
  });

  describe("the AI review", () => {
    it("queues one once the checks have a verdict", async () => {
      const { roadmap } = await tracking();

      await milestones(roadmap);

      const [job] = db.rows("ai_jobs").filter((j) => j.type === "milestone_review");
      expect(job).toBeTruthy();

      const payload = job.payload as Record<string, unknown>;
      // §7: the model is handed the conclusions, never asked to reach them.
      expect(payload.checks).toBeTruthy();
      expect(payload.commitSha).toBeTruthy();
      // The diff travels in the payload — the worker has no GitHub credentials.
      expect(Array.isArray(payload.files)).toBe(true);
      // The rubric goes to the worker, which is allowed; §6 rule 2 keeps it out
      // of a *learner* response, and the milestones endpoint does not send it.
      expect(payload.reviewChecklist).toBeTruthy();
    });

    /**
     * The worker runs one job at a time on one 8GB card. A queue filling with
     * duplicates of the same review would starve every other job.
     *
     * **Re-judging has to be forced to reach this.** In the ordinary flow
     * `evaluate` runs once per (milestone, commit), so `queueReview` is never
     * called twice — the first version of this test passed with the guard
     * removed because it exercised nothing. Putting the attempt back to
     * `checking` is the real path to a second call: a workflow that had not
     * finished, re-read once it has. Two tabs polling at once reach it the
     * same way.
     */
    it("does not queue a second review when an attempt is judged again", async () => {
      const { roadmap } = await tracking();
      await milestones(roadmap);

      const before = db.rows("ai_jobs").filter((j) => j.type === "milestone_review").length;
      expect(before).toBeGreaterThan(0);

      await db.pool.query(`update milestone_attempts set status = 'checking'`);
      await milestones(roadmap);

      const reviews = db.rows("ai_jobs").filter((j) => j.type === "milestone_review");
      const perAttempt = new Map<unknown, number>();
      for (const review of reviews) {
        perAttempt.set(review.source_id, (perAttempt.get(review.source_id) ?? 0) + 1);
      }
      expect([...perAttempt.values()].every((n) => n === 1)).toBe(true);
    });

    /**
     * Nothing useful can be said about results that have not arrived — which is
     * exactly what §7 forbids.
     */
    it("queues nothing while the checks are still running", async () => {
      const pendingChecks: GitHubClient = {
        ...createDevGitHub(),
        // No run for this commit yet: every workflow_test is pending.
        workflowSteps: () => Promise.resolve([]),
        listFiles: () => Promise.resolve([]),
      };
      app = createApp({ pool: db.pool, mailer: silentMailer, github: pendingChecks });

      const { roadmap } = await tracking();
      await db.pool.query(`delete from milestone_checks`);
      await db.pool.query(
        `insert into milestone_checks (milestone_id, type, name, config, sort_order)
         values ($1,'workflow_test','Test: adds a task',$2,0)`,
        [ids.milestone, JSON.stringify({ workflow: "test.yml", test_name: "adds a task" })],
      );

      await milestones(roadmap);

      expect(db.rows("ai_jobs").filter((j) => j.type === "milestone_review")).toHaveLength(0);
    });

    /** The panel needs an id to flag, or §7's third requirement is missing. */
    it("returns the review with the id its flag control points at", async () => {
      const { roadmap } = await tracking();
      await milestones(roadmap);

      const attemptId = db.rows("milestone_attempts")[0].id as string;
      const learner = db.rows("users").find((u) => u.email === "learner@example.com")!;
      await db.pool.query(
        `insert into ai_outputs (user_id, source_type, source_id, content)
         values ($1, 'milestone_review', $2, $3)`,
        [
          learner.id,
          attemptId,
          JSON.stringify({
            summary: "Adding works. Empty input still gets through.",
            checklist: [{ criterion: "Stable ids", met: true, note: "crypto.randomUUID." }],
            nextStep: "Look at the submit handler.",
          }),
        ],
      );

      const res = await milestones(roadmap);
      const reviewed = res.body.milestones.find((m: { review: unknown }) => m.review);

      expect(reviewed.review.outputId).toBeTruthy();
      expect(reviewed.review.summary).toMatch(/adding works/i);
      expect(reviewed.review.nextStep).toMatch(/submit handler/i);
    });

    /** A shape that changed between prompt versions must not break the screen. */
    it("ignores a stored review it cannot read", async () => {
      const { roadmap } = await tracking();
      await milestones(roadmap);

      const attemptId = db.rows("milestone_attempts")[0].id as string;
      const learner = db.rows("users").find((u) => u.email === "learner@example.com")!;
      await db.pool.query(
        `insert into ai_outputs (user_id, source_type, source_id, content)
         values ($1, 'milestone_review', $2, $3)`,
        [learner.id, attemptId, JSON.stringify({ unexpected: "shape" })],
      );

      const res = await milestones(roadmap);
      expect(res.status).toBe(200);
      expect(res.body.milestones.every((m: { review: unknown }) => m.review === null)).toBe(true);
    });
  });

  /**
   * **The chain the whole of Phase 4 exists to produce.** Every milestone
   * complete → the project is finished → a Project Certificate is issued → the
   * resume gains a Projects section. Each link is written by the API from
   * evidence it computed; none of it can be asked for (§6 rule 1).
   */
  describe("finishing the project", () => {
    /** Marks every milestone complete the only way the platform allows. */
    async function completeEveryMilestone(roadmap: string): Promise<void> {
      // One read per milestone: the current one is worked out once per read.
      await milestones(roadmap);
      await db.pool.query(`update milestone_attempts set status = 'complete'`);
      await milestones(roadmap);
      await db.pool.query(`update milestone_attempts set status = 'complete'`);
      await milestones(roadmap);
    }

    it("marks the project complete once every milestone is", async () => {
      const { roadmap } = await tracking();
      await completeEveryMilestone(roadmap);

      const project = db.rows("capstone_projects")[0];
      expect(project.status).toBe("completed");
      expect(project.completed_at).toBeTruthy();
    });

    it("leaves it in progress while one milestone is not complete", async () => {
      const { roadmap } = await tracking();
      await milestones(roadmap);

      const project = db.rows("capstone_projects")[0];
      expect(project.completed_at).toBeNull();
      expect(project.status).toBe("in_progress");
    });

    it("issues a Project Certificate, and the capstone screen stops saying locked", async () => {
      const { roadmap } = await tracking();
      await completeEveryMilestone(roadmap);

      // Reading certificates is what runs the check — §6 rule 1: there is no
      // endpoint that issues one.
      const res = await read("/certificates");

      expect(res.body.projectCertificate).toEqual({ available: true });

      const certificate = db
        .rows("certificates")
        .find((c) => c.type === "project") as Record<string, unknown>;
      expect(certificate).toBeTruthy();
      expect(certificate.project_id).toBe(db.rows("capstone_projects")[0].id);
      expect(certificate.public_code).toMatch(/^FC-/);
    });

    /** Snapshotted, like the recipient's name: the certificate must keep saying
     *  what it said the day it was issued. */
    it("snapshots the repository and live address onto the certificate", async () => {
      const { roadmap } = await tracking();
      await put(app, `/roadmaps/${roadmap}/capstone/demo-url`)
        .set("Cookie", cookie)
        .send({ demoUrl: "https://task-tracker.example.com" });
      await completeEveryMilestone(roadmap);
      await read("/certificates");

      const certificate = db.rows("certificates").find((c) => c.type === "project")!;
      const details = certificate.details as Record<string, unknown>;
      expect(details.repoFullName).toMatch(/task-tracker/);
      expect(details.demoUrl).toBe("https://task-tracker.example.com");
    });

    it("issues only one however often certificates are read", async () => {
      const { roadmap } = await tracking();
      await completeEveryMilestone(roadmap);

      await read("/certificates");
      await read("/certificates");
      await read("/certificates");

      expect(db.rows("certificates").filter((c) => c.type === "project")).toHaveLength(1);
    });

    /**
     * Two different claims about two different pieces of evidence. The skills
     * belong to the Certificate of Completion; repeating them would put the same
     * evidence on two documents.
     */
    it("does not repeat the skills on the Project Certificate", async () => {
      const { roadmap } = await tracking();
      await completeEveryMilestone(roadmap);
      await read("/certificates");

      const certificate = db.rows("certificates").find((c) => c.type === "project")!;
      expect((certificate.details as { skills: string[] }).skills).toEqual([]);
    });

    /** §7: no capstone means no Projects section — and a finished one fills it. */
    it("puts the project on the resume", async () => {
      const { roadmap } = await tracking();
      await completeEveryMilestone(roadmap);

      const res = await read("/resume");

      expect(res.body.evidence.projects).toHaveLength(1);
      expect(res.body.evidence.projects[0].title).toBe("Task tracker");
    });

    it("keeps it off the resume until it is finished", async () => {
      const { roadmap } = await tracking();
      await milestones(roadmap);

      expect((await read("/resume")).body.evidence.projects).toEqual([]);
    });
  });

  it("refuses another learner's milestones", async () => {
    const { roadmap } = await tracking();

    const res = await request(app)
      .get(`/roadmaps/${roadmap}/capstone/milestones`)
      .set("Cookie", otherCookie);

    expect(res.status).toBe(404);
  });
});

describe("the live address", () => {
  async function building(): Promise<string> {
    const roadmap = await readyRoadmap();
    await choose(`/roadmaps/${roadmap}/capstone`).send({ briefId: ids.brief });
    return roadmap;
  }

  it("stores what the learner gives", async () => {
    const roadmap = await building();

    const res = await put(app, `/roadmaps/${roadmap}/capstone/demo-url`)
      .set("Cookie", cookie)
      .send({ demoUrl: "https://task-tracker.example.com" });

    expect(res.status).toBe(200);
    expect(db.rows("capstone_projects")[0].demo_url).toBe("https://task-tracker.example.com");
  });

  it("refuses something that is not an address", async () => {
    const roadmap = await building();

    const res = await put(app, `/roadmaps/${roadmap}/capstone/demo-url`)
      .set("Cookie", cookie)
      .send({ demoUrl: "my site" });

    expect(res.status).toBe(400);
  });

  /**
   * The browser says *where*, never *whether*. A body carrying a result is
   * rejected outright rather than ignored (§6 rule 1).
   */
  it("refuses a body that tries to report the result", async () => {
    const roadmap = await building();

    const res = await put(app, `/roadmaps/${roadmap}/capstone/demo-url`)
      .set("Cookie", cookie)
      .send({ demoUrl: "https://example.com", passed: true });

    expect(res.status).toBe(400);
  });

  it("refuses on another learner's roadmap", async () => {
    const roadmap = await building();

    const res = await put(app, `/roadmaps/${roadmap}/capstone/demo-url`)
      .set("Cookie", otherCookie)
      .send({ demoUrl: "https://example.com" });

    expect(res.status).toBe(404);
    expect(db.rows("capstone_projects")[0].demo_url).toBeNull();
  });
});

describe("pointing the project at a repository", () => {
  const INSTALLATION = 1;

  /** Connects the learner, the way `/github/callback` would. */
  const connectGitHub = () =>
    db.pool.query(
      `insert into github_connections (user_id, github_user_id, github_username, installation_id)
       values ($1, 4242, 'learner-x', $2)`,
      [learnerId, INSTALLATION],
    );

  /** What the development client grants — the ids the endpoint checks against. */
  const granted = () => createDevGitHub().installationRepositories(INSTALLATION);

  const setRepository = (roadmapId: string, body: unknown) =>
    put(app, `/roadmaps/${roadmapId}/capstone/repository`)
      .set("Cookie", cookie)
      .send(body as object);

  async function startedProject(): Promise<string> {
    const roadmap = await readyRoadmap();
    await choose(`/roadmaps/${roadmap}/capstone`).send({ briefId: ids.brief });
    return roadmap;
  }

  it("stores GitHub's own name for the repository and starts the build", async () => {
    const roadmap = await startedProject();
    await connectGitHub();
    const [repo] = await granted();

    const res = await setRepository(roadmap, { repositoryId: repo.id });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ stage: "build", repoFullName: repo.fullName });

    const project = db.rows("capstone_projects")[0];
    expect(Number(project.repo_github_id)).toBe(repo.id);
    expect(project.repo_full_name).toBe(repo.fullName);
    expect(project.status).toBe("in_progress");
  });

  /**
   * **The check that matters.** A browser can send any number; only one the
   * learner's installation actually grants is accepted, read live from GitHub
   * rather than from a list the browser was once handed.
   */
  it("refuses a repository the installation does not grant", async () => {
    const roadmap = await startedProject();
    await connectGitHub();

    const res = await setRepository(roadmap, { repositoryId: 999_999_999 });

    expect(res.status).toBe(404);
    expect(db.rows("capstone_projects")[0].repo_github_id).toBeNull();
  });

  it("refuses a name in place of an id", async () => {
    const roadmap = await startedProject();
    await connectGitHub();

    const res = await setRepository(roadmap, { repoFullName: "someone/else" });
    expect(res.status).toBe(400);
  });

  it("refuses before GitHub is connected", async () => {
    const roadmap = await startedProject();

    const [repo] = await granted();
    const res = await setRepository(roadmap, { repositoryId: repo.id });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/connect your github/i);
  });

  it("refuses on another learner's roadmap", async () => {
    const roadmap = await startedProject();
    await connectGitHub();
    const [repo] = await granted();

    const res = await put(app, `/roadmaps/${roadmap}/capstone/repository`)
      .set("Cookie", otherCookie)
      .send({ repositoryId: repo.id });

    expect(res.status).toBe(404);
    expect(db.rows("capstone_projects")[0].repo_github_id).toBeNull();
  });

  it("refuses when no project has been started", async () => {
    const roadmap = await readyRoadmap();
    await connectGitHub();
    const [repo] = await granted();

    expect((await setRepository(roadmap, { repositoryId: repo.id })).status).toBe(404);
  });

  /**
   * Once building, the commits and milestone attempts point at that repository.
   * Repointing would leave them describing work the project no longer claims.
   */
  it("refuses to repoint a project that is already building", async () => {
    const roadmap = await startedProject();
    await connectGitHub();
    const [repo] = await granted();
    await setRepository(roadmap, { repositoryId: repo.id });

    const again = await setRepository(roadmap, { repositoryId: repo.id });

    expect(again.status).toBe(409);
    expect(again.body.error).toMatch(/already has a repository/i);
  });

  /** Not the learner's fault and not permanent, so it says so (§9). */
  it("says GitHub is unreachable rather than failing the request", async () => {
    const unreachable: GitHubClient = {
      ...createDevGitHub(),
      installationRepositories: () => Promise.reject(new Error("network")),
    };
    app = createApp({ pool: db.pool, mailer: silentMailer, github: unreachable });

    const roadmap = await startedProject();
    await connectGitHub();

    const res = await setRepository(roadmap, { repositoryId: 1 });

    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/try again/i);
  });
});
