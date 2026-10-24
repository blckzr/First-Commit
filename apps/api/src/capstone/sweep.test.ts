import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@first-commit/test-db";
import { createDevGitHub } from "../github/dev.js";
import type { GitHubClient } from "../github/index.js";
import { sweepCommits } from "./sweep.js";

/**
 * The commit backstop (§6.2).
 *
 * The behaviour that matters is **who gets swept and who does not** — a sweep
 * that touched every project would spend an installation's rate limit on
 * finished work — and that **one project's failure does not stop the rest**,
 * which is what turns a deleted repository from an outage into a log line.
 */

let db: TestDb;

/** A project in the given state, with GitHub connected. */
async function project(status: string, repo: string | null = "learner/task-tracker"): Promise<string> {
  const one = async (sql: string, values: unknown[] = []) =>
    (await db.pool.query<{ id: string }>(sql, values)).rows[0].id;

  const user = await one(
    `insert into users (email, full_name, password_hash, role, status, email_verified_at)
     values ($1,'A Learner','x','learner','active', now()) returning id`,
    [`learner-${Math.random().toString(36).slice(2)}@example.com`],
  );
  await db.pool.query(
    `insert into github_connections (user_id, github_user_id, github_username, installation_id)
     values ($1, $2, 'learner', 1)`,
    [user, Math.floor(Math.random() * 1_000_000)],
  );

  const path = await one(
    `insert into career_paths (slug, title, status) values ($1,'JWD','published') returning id`,
    [`jwd-${Math.random().toString(36).slice(2)}`],
  );
  const track = await one(
    `insert into tracks (career_path_id, title, status) values ($1,'Frontend','published') returning id`,
    [path],
  );
  const tech = await one(
    `insert into technologies (slug, name) values ($1,'React') returning id`,
    [`react-${Math.random().toString(36).slice(2)}`],
  );
  const roadmap = await one(
    `insert into roadmaps (user_id, career_path_id, track_id, status) values ($1,$2,$3,'active') returning id`,
    [user, path, track],
  );
  const brief = await one(
    `insert into capstone_briefs (track_id, slug, status) values ($1,$2,'published') returning id`,
    [track, `tt-${Math.random().toString(36).slice(2)}`],
  );
  const version = await one(
    `insert into capstone_brief_versions (brief_id, version_no, title, status)
     values ($1,1,'Task tracker','published') returning id`,
    [brief],
  );

  return one(
    `insert into capstone_projects
       (user_id, roadmap_id, brief_version_id, technology_id, status, repo_full_name)
     values ($1,$2,$3,$4,$5,$6) returning id`,
    [user, roadmap, version, tech, status, repo],
  );
}

beforeEach(() => {
  db = createTestDb();
});

describe("which projects are swept", () => {
  it("brings in commits for a project that is building", async () => {
    await project("in_progress");

    const synced = await sweepCommits(db.pool, createDevGitHub());

    expect(synced).toBe(1);
    expect(db.rows("project_commits").length).toBeGreaterThan(0);
  });

  /** A finished project gains nothing worth chasing. */
  it("skips a completed project", async () => {
    await project("completed");

    expect(await sweepCommits(db.pool, createDevGitHub())).toBe(0);
    expect(db.rows("project_commits")).toHaveLength(0);
  });

  /** One still choosing a repository has none to read. */
  it("skips a project that is still connecting", async () => {
    await project("connecting", null);

    expect(await sweepCommits(db.pool, createDevGitHub())).toBe(0);
  });

  it("skips a learner who has disconnected GitHub", async () => {
    const id = await project("in_progress");
    await db.pool.query(
      `delete from github_connections where user_id = (select user_id from capstone_projects where id = $1)`,
      [id],
    );

    expect(await sweepCommits(db.pool, createDevGitHub())).toBe(0);
  });
});

describe("when one project cannot be read", () => {
  /**
   * A deleted repository or a removed installation is ordinary, and is not a
   * reason to skip everybody behind it in the list.
   */
  it("carries on with the others", async () => {
    await project("in_progress");
    await project("in_progress");
    await project("in_progress");

    let call = 0;
    const flaky: GitHubClient = {
      ...createDevGitHub(),
      listCommits: (...args) => {
        call += 1;
        if (call === 2) return Promise.reject(new Error("repository not found"));
        return createDevGitHub().listCommits(...args);
      },
    };

    const synced = await sweepCommits(db.pool, flaky);

    // Two succeeded; the middle one failed and was logged, not thrown.
    expect(synced).toBe(2);
  });

  /** An unreachable GitHub is not a sync — it is counted as what it was. */
  it("does not count a project it could not reach", async () => {
    await project("in_progress");

    const unreachable: GitHubClient = {
      ...createDevGitHub(),
      listCommits: () => Promise.reject(new Error("network")),
    };

    expect(await sweepCommits(db.pool, unreachable)).toBe(0);
  });
});

describe("three paths, one history", () => {
  /**
   * The webhook, the read and the sweep all write the same commits. This is the
   * third of them, and the `on conflict (project_id, sha) do nothing` clause is
   * what keeps the history from tripling.
   */
  it("does not duplicate what another path already stored", async () => {
    await project("in_progress");

    await sweepCommits(db.pool, createDevGitHub());
    const afterFirst = db.rows("project_commits").length;

    const forgetful: GitHubClient = {
      ...createDevGitHub(),
      // The whole history every time, as a webhook redelivery would send.
      listCommits: (installationId, fullName) =>
        createDevGitHub().listCommits(installationId, fullName, null),
    };

    await sweepCommits(db.pool, forgetful);
    await sweepCommits(db.pool, forgetful);

    expect(db.rows("project_commits").length).toBe(afterFirst);
  });
});
