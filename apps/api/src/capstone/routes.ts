import { Router } from "express";
import { z } from "zod";
import type { Pool } from "pg";
import { HttpError } from "../middleware/errors.js";
import { assertOwned, requireAuth, sessionUser } from "../middleware/session.js";
import type { GitHubClient } from "../github/index.js";
import { readCommits, syncCommits, type StoredCommit } from "./commits.js";
import { readMilestones, type ProjectForMilestones } from "./milestones.js";

/**
 * The capstone (design.md §5.14), stage 1: choosing a brief.
 *
 * ### What decides whether a learner may start
 *
 * Three things, **all read from the server's own rows**, none of them sent by
 * the browser:
 *
 * 1. The roadmap belongs to the session user (§6.1 step 4).
 * 2. A **completion certificate** exists for it. That is the same gate
 *    `roadmaps/build.ts` already draws — the capstone step is `locked` until the
 *    Certificate of Completion is earned — so the screen and the endpoint cannot
 *    disagree about who may begin.
 * 3. A technology has been chosen on that roadmap. The capstone is built with
 *    it, and a brief only appears if it has a starter template for it.
 *
 * ### The technology is never taken from the request
 *
 * `POST` accepts a brief id and nothing else. The technology comes from
 * `roadmap_technology_choices`, so a learner cannot start a React capstone on a
 * roadmap where they chose Vue by posting a different id — which would put a
 * framework they never studied on their Project Certificate.
 *
 * ### No "Recommended" badge
 *
 * §5.14 stage 1 shows one. There is no `brief_recommendation` job type in
 * `ai_job_type`, so nothing could write it, and a badge picked by the API would
 * be an unlabelled recommendation with no reason and nothing to flag — which
 * §7 forbids. It arrives with the job type, like the technology panel's.
 */

const ChooseBody = z.object({ briefId: z.string().uuid("Choose a project brief.") }).strict();

/**
 * The repository, by **GitHub's numeric id**, not its name.
 *
 * A name can be changed or transferred by the learner at any moment; the id
 * cannot, which is why `capstone_projects.repo_github_id` is what the project
 * holds and `repo_full_name` is only there to be shown. Taking a name here
 * would also make the endpoint trust a string the browser composed.
 */
const RepositoryBody = z
  .object({ repositoryId: z.number().int().positive("Choose a repository.") })
  .strict();

/**
 * The live address. Shape only — whether it answers, and whether it is even
 * allowed to be fetched, is decided by `isLive()` when the check runs.
 */
const DemoUrlBody = z
  .object({ demoUrl: z.string().url("Enter the full address, starting with https://") })
  .strict();

/** Not graded, and it decides nothing (§5.14). Stored for admin review only. */
const ExplanationBody = z
  .object({ answer: z.string().trim().min(1, "Write a few sentences.").max(4000) })
  .strict();

interface RoadmapRow {
  id: string;
  track_id: string | null;
}

export function capstoneRoutes(pool: Pool, github: GitHubClient): Router {
  const router = Router();

  /**
   * §5.14 lives at `/app/capstone`, which carries no roadmap id — so the active
   * roadmap is resolved here rather than picked by the browser. Same rule as
   * Home's continue panel, and the same reason: which roadmap a learner is on
   * is the server's answer, not a parameter.
   */
  router.get("/capstone", requireAuth, async (req, res) => {
    const user = sessionUser(req);

    const active = await pool.query<{ id: string }>(
      `select id from roadmaps
        where user_id = $1 and status = 'active'
        order by created_at desc limit 1`,
      [user.id],
    );
    if (!active.rows[0]) {
      res.json({
        stage: "locked",
        reason: "Build a roadmap first — the capstone comes at the end of one.",
        technology: null,
        briefs: [],
        project: null,
        roadmapId: null,
      });
      return;
    }

    const state = await readState(pool, github, user.id, active.rows[0].id);
    res.json({ ...state, roadmapId: active.rows[0].id });
  });

  router.get("/roadmaps/:id/capstone", requireAuth, async (req, res) => {
    const user = sessionUser(req);
    const state = await readState(pool, github, user.id, roadmapId(req.params.id));
    res.json(state);
  });

  /**
   * Starts a project. Not evidence (§6 rule 1) — it records an intention, and
   * every milestone after it is decided by checks the server runs.
   */
  router.post("/roadmaps/:id/capstone", requireAuth, async (req, res) => {
    const user = sessionUser(req);
    const parsed = ChooseBody.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0].message);

    const id = roadmapId(req.params.id);
    const state = await readState(pool, github, user.id, id);
    if (state.project) {
      throw new HttpError(409, "You have already started a project on this roadmap.");
    }
    if (state.stage === "locked") {
      throw new HttpError(409, state.reason ?? "This roadmap is not ready for a capstone yet.");
    }

    /**
     * The brief must be one this learner could actually have been offered:
     * published, on their track, and with a starter template for the technology
     * they chose. Checked here rather than trusted from the list, because the
     * list was sent to a browser and came back.
     */
    const offered = state.briefs.find((b) => b.id === parsed.data.briefId);
    if (!offered) throw new HttpError(404, "Not found");

    /**
     * The check above catches the ordinary second click. This catches the race
     * between two of them: `capstone_projects` has `unique (roadmap_id)`, so the
     * database is the thing that actually guarantees one project per roadmap,
     * and a violation here is the same outcome arriving twice rather than an
     * error worth showing.
     *
     * Deliberately not `on conflict (roadmap_id) do nothing`: pg-mem will not
     * match `on conflict` to a **table-level** unique constraint, so that form
     * threw 500 under the endpoint tests while working in PostgreSQL — the
     * failure mode `packages/test-db` exists to prevent.
     */
    let projectId: string;
    try {
      const { rows } = await pool.query<{ id: string }>(
        `insert into capstone_projects
           (user_id, roadmap_id, brief_version_id, technology_id, status)
         values ($1, $2, $3, $4, 'connecting')
         returning id`,
        [user.id, id, offered.versionId, state.technology!.id],
      );
      projectId = rows[0].id;
    } catch (err) {
      if ((err as { code?: string }).code === "23505") {
        throw new HttpError(409, "You have already started a project on this roadmap.");
      }
      throw err;
    }

    res.status(201).json({ projectId, stage: "connect" });
  });

  /**
   * §5.14 stage 2, step 3: point the project at a repository.
   *
   * ### The id is checked against the installation, not taken on trust
   *
   * A browser could send any number. What makes this safe is that the id must
   * appear in the repositories **this learner's installation currently grants**
   * — read live from GitHub, not from a list the browser was once given. So a
   * learner cannot attach a repository they do not own, or one they have since
   * removed the App from, and `repo_full_name` is GitHub's answer rather than a
   * string the browser composed.
   *
   * ### Only while connecting
   *
   * Once a project is `in_progress` its commits and milestone attempts point at
   * that repository. Repointing it would leave them describing work in a
   * repository the project no longer claims, so it is refused — changing
   * repository is starting again, and that is a different action with a
   * different conversation.
   */
  router.put("/roadmaps/:id/capstone/repository", requireAuth, async (req, res) => {
    const user = sessionUser(req);
    const parsed = RepositoryBody.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0].message);

    const id = roadmapId(req.params.id);

    const project = await pool.query<{ id: string; status: string }>(
      `select id, status from capstone_projects where roadmap_id = $1 and user_id = $2`,
      [id, user.id],
    );
    assertOwned(project.rowCount);

    if (project.rows[0].status !== "connecting") {
      throw new HttpError(
        409,
        "This project already has a repository. Ask an admin if you need to change it.",
      );
    }

    const connection = await pool.query<{ installation_id: string }>(
      `select installation_id from github_connections where user_id = $1`,
      [user.id],
    );
    if (!connection.rows[0]) {
      throw new HttpError(409, "Connect your GitHub account first.");
    }

    let repositories;
    try {
      repositories = await github.installationRepositories(
        Number(connection.rows[0].installation_id),
      );
    } catch {
      // Not the learner's fault and not permanent, so it says so rather than
      // becoming a 500 (§9).
      throw new HttpError(
        503,
        "GitHub isn't answering right now. Your choice is safe — try again in a minute.",
      );
    }

    const repository = repositories.find((r) => r.id === parsed.data.repositoryId);
    if (!repository) {
      throw new HttpError(
        404,
        "That repository isn't one this installation can see. Choose one from the list.",
      );
    }

    /**
     * `repo_github_id` is `unique` across projects: one repository backs one
     * capstone. Two learners pointing at the same repository would be two
     * Project Certificates for one piece of work.
     */
    try {
      await pool.query(
        `update capstone_projects
            set repo_github_id = $1, repo_full_name = $2, status = 'in_progress'
          where id = $3`,
        [repository.id, repository.fullName, project.rows[0].id],
      );
    } catch (err) {
      if ((err as { code?: string }).code === "23505") {
        throw new HttpError(409, "That repository is already tracked by another project.");
      }
      throw err;
    }

    res.json({ stage: "build", repoFullName: repository.fullName });
  });

  /**
   * §5.14 stage 3 — the milestone tracker.
   *
   * Reading runs the checks for the milestone being worked on, against the
   * newest commit, and records the attempt. That is the same sync-on-read
   * arrangement `commits.ts` explains, for the same reason: no timer in a
   * service that sleeps, and the answer is current at the moment somebody is
   * looking at it.
   */
  router.get("/roadmaps/:id/capstone/milestones", requireAuth, async (req, res) => {
    const user = sessionUser(req);
    const id = roadmapId(req.params.id);

    const project = await loadProject(pool, user.id, id);
    const latest = await pool.query<{ sha: string }>(
      `select sha from project_commits where project_id = $1 order by pushed_at desc limit 1`,
      [project.id],
    );

    const milestones = await readMilestones(
      pool,
      github,
      project,
      latest.rows[0]?.sha ?? null,
    );

    res.json({ milestones, latestCommitSha: latest.rows[0]?.sha ?? null });
  });

  /**
   * The live address for the deployment check (§5.14: milestone 5 "asks for the
   * live demo link, which is checked to confirm it loads").
   *
   * **This is not a result.** The learner says where to look; whether it answers
   * is decided by `isLive()` on the server, which also refuses anything that is
   * not a public HTTP address — see `checks.ts` for why that fence exists.
   */
  router.put("/roadmaps/:id/capstone/demo-url", requireAuth, async (req, res) => {
    const user = sessionUser(req);
    const parsed = DemoUrlBody.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0].message);

    const id = roadmapId(req.params.id);
    const project = await loadProject(pool, user.id, id);

    await pool.query(`update capstone_projects set demo_url = $1 where id = $2`, [
      parsed.data.demoUrl,
      project.id,
    ]);

    res.json({ demoUrl: parsed.data.demoUrl });
  });

  /**
   * §5.14's explanation question. Saved for admin review if the project is ever
   * flagged — it is **not graded**, and it decides no milestone. The checks do
   * that, which is why this writes only `explanation_answer`.
   */
  router.put("/roadmaps/:id/capstone/milestones/:milestoneId/explanation", requireAuth, async (req, res) => {
    const user = sessionUser(req);
    const parsed = ExplanationBody.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0].message);

    const id = roadmapId(req.params.id);
    const project = await loadProject(pool, user.id, id);

    const milestoneId = req.params.milestoneId;
    if (typeof milestoneId !== "string") throw new HttpError(404, "Not found");

    /**
     * Only onto an attempt that exists for this project — which also makes the
     * milestone id ownership-checked, since an attempt only exists for a
     * milestone of the brief this project is building.
     */
    const updated = await pool.query(
      `update milestone_attempts
          set explanation_answer = $1
        where project_id = $2 and milestone_id = $3`,
      [parsed.data.answer, project.id, milestoneId],
    );
    assertOwned(updated.rowCount);

    res.json({ saved: true });
  });

  return router;
}

/** The project on a roadmap the session user owns, or 404. */
async function loadProject(
  pool: Pool,
  userId: string,
  roadmapId: string,
): Promise<ProjectForMilestones> {
  const { rows, rowCount } = await pool.query<ProjectForMilestones>(
    `select p.id, p.brief_version_id, p.technology_id, p.repo_full_name, p.demo_url,
            c.installation_id
       from capstone_projects p
       left join github_connections c on c.user_id = p.user_id
      where p.roadmap_id = $1 and p.user_id = $2`,
    [roadmapId, userId],
  );
  assertOwned(rowCount);
  return rows[0];
}

/**
 * Express 5 types a route param as `string | string[]`, so a repeated `?id=`
 * must not reach a query, and a malformed id is a 404 rather than a uuid cast
 * surfacing as a 500.
 */
function roadmapId(value: string | string[] | undefined): string {
  if (typeof value !== "string" || !/^[0-9a-f-]{36}$/i.test(value)) {
    throw new HttpError(404, "Not found");
  }
  return value;
}

export interface CapstoneBrief {
  id: string;
  versionId: string;
  slug: string;
  title: string;
  description: string;
  goals: string;
  estimatedWeeks: number;
  milestoneCount: number;
  /** The skills it draws on, for §5.14's "Uses:" line. */
  uses: string[];
  starterRepo: string;
}

export interface CapstoneState {
  stage: "locked" | "choose" | "connect" | "build";
  /** Why it is locked, in the learner's words (§9). Null otherwise. */
  reason: string | null;
  technology: { id: string; name: string } | null;
  briefs: CapstoneBrief[];
  project: {
    id: string;
    status: string;
    repoFullName: string | null;
    briefTitle: string;
    /** The template to copy (§5.14 stage 2, step 1). Null if it was withdrawn. */
    starterRepo: string | null;
    /** §5.14 stage 3's push history, newest first. Empty while connecting. */
    commits: StoredCommit[];
    /**
     * Whether GitHub answered on this read. False means the history below is
     * what was last known — not that there is none, which is a different thing
     * to tell somebody.
     */
    githubReachable: boolean;
  } | null;
}

async function readState(
  pool: Pool,
  github: GitHubClient,
  userId: string,
  roadmapId: string,
): Promise<CapstoneState> {
  const roadmap = await pool.query<RoadmapRow>(
    `select id, track_id from roadmaps where id = $1 and user_id = $2`,
    [roadmapId, userId],
  );
  assertOwned(roadmap.rowCount);
  const trackId = roadmap.rows[0].track_id;

  const empty: CapstoneState = {
    stage: "locked",
    reason: null,
    technology: null,
    briefs: [],
    project: null,
  };

  /**
   * An existing project short-circuits everything else. A learner who has
   * started keeps their brief even if the content behind it later changes
   * (§6 rule 6), so nothing below needs to be recomputed for them.
   */
  const existing = await pool.query<{
    id: string;
    status: string;
    repo_full_name: string | null;
    title: string;
    starter_repo: string | null;
    technology_id: string;
    technology_name: string;
  }>(
    /**
     * The starter template comes along because §5.14 stage 2's first step is
     * "create your repository from the starter template" — and it is the one
     * per *technology*, joined on the project's own choice rather than looked
     * up again from the roadmap.
     *
     * A `left join`: a brief whose template for this technology was removed
     * after the learner started must still show them the project they have,
     * with the step that cannot be taken missing rather than the whole screen
     * failing.
     */
    `select p.id, p.status, p.repo_full_name, bv.title,
            st.repo_full_name as starter_repo, t.id as technology_id, t.name as technology_name
       from capstone_projects p
       join capstone_brief_versions bv on bv.id = p.brief_version_id
       join technologies t on t.id = p.technology_id
       left join starter_templates st
         on st.brief_version_id = p.brief_version_id and st.technology_id = p.technology_id
      where p.roadmap_id = $1 and p.user_id = $2`,
    [roadmapId, userId],
  );
  if (existing.rows[0]) {
    const row = existing.rows[0];

    /**
     * Brought up to date on read — see `commits.ts` for why here rather than on
     * a timer. Only once building: a project still choosing a repository has
     * nothing to fetch, and asking GitHub would be a round trip for an empty
     * answer on every poll of the connect screen.
     */
    const sync =
      row.status === "connecting"
        ? { added: 0, reachable: true }
        : await syncCommits(pool, github, row.id);

    return {
      ...empty,
      stage: row.status === "connecting" ? "connect" : "build",
      technology: { id: row.technology_id, name: row.technology_name },
      project: {
        id: row.id,
        status: row.status,
        repoFullName: row.repo_full_name,
        briefTitle: row.title,
        starterRepo: row.starter_repo,
        commits: row.status === "connecting" ? [] : await readCommits(pool, row.id),
        githubReachable: sync.reachable,
      },
    };
  }

  /**
   * §5.14 puts the capstone after the Certificate of Completion, and
   * `roadmaps/build.ts` locks the step until it exists. The same row decides it
   * here so the screen and the endpoint cannot drift apart.
   */
  const certificate = await pool.query<{ id: string }>(
    `select id from certificates
      where user_id = $1 and roadmap_id = $2 and type = 'completion' and status = 'valid'`,
    [userId, roadmapId],
  );
  if (!certificate.rows[0]) {
    return {
      ...empty,
      reason: "Finish the modules on this roadmap to unlock the capstone project.",
    };
  }

  const chosen = await pool.query<{ id: string; name: string }>(
    `select t.id, t.name
       from roadmap_technology_choices c
       join technologies t on t.id = c.technology_id
      where c.roadmap_id = $1 and c.technology_id is not null
      limit 1`,
    [roadmapId],
  );
  if (!chosen.rows[0]) {
    return { ...empty, reason: "Choose your technology on the roadmap first." };
  }
  const technology = chosen.rows[0];

  /**
   * Published briefs for this track that have a starter template for the
   * technology this learner chose. The join to `starter_templates` is what
   * makes that last part true rather than assumed — a brief with no template
   * for their framework would send them to §5.14 stage 2 with nothing to open.
   */
  const briefs = await pool.query<{
    id: string;
    version_id: string;
    slug: string;
    title: string;
    description: string;
    goals: string;
    estimated_weeks: number;
    repo_full_name: string;
  }>(
    `select b.id, bv.id as version_id, b.slug, bv.title, bv.description, bv.goals,
            bv.estimated_weeks, st.repo_full_name
       from capstone_briefs b
       join capstone_brief_versions bv
         on bv.brief_id = b.id and bv.status = 'published'
       join starter_templates st
         on st.brief_version_id = bv.id and st.technology_id = $2
      where b.track_id = $1 and b.status = 'published'
      order by bv.title`,
    [trackId, technology.id],
  );

  const versionIds = briefs.rows.map((b) => b.version_id);

  /**
   * Milestone counts and the skills each brief draws on, for §5.14's card.
   *
   * Two queries merged in JavaScript rather than one with a correlated
   * subquery: pg-mem cannot plan the latter (`column "bv.id" does not exist`),
   * so the endpoint tests would be exercising SQL the database never runs.
   */
  const milestones = versionIds.length
    ? await pool.query<{ brief_version_id: string; id: string }>(
        `select brief_version_id, id from milestones`,
      )
    : { rows: [] as { brief_version_id: string; id: string }[] };

  const skills = versionIds.length
    ? await pool.query<{ brief_version_id: string; name: string }>(
        `select m.brief_version_id, s.name
           from milestones m
           join milestone_modules mm on mm.milestone_id = m.id
           join modules mo on mo.id = mm.module_id
           join skills s on s.id = mo.skill_id`,
      )
    : { rows: [] as { brief_version_id: string; name: string }[] };

  return {
    stage: "choose",
    reason: null,
    technology: { id: technology.id, name: technology.name },
    project: null,
    briefs: briefs.rows.map((b) => ({
      id: b.id,
      versionId: b.version_id,
      slug: b.slug,
      title: b.title,
      description: b.description,
      goals: b.goals,
      estimatedWeeks: Number(b.estimated_weeks),
      milestoneCount: milestones.rows.filter((m) => m.brief_version_id === b.version_id).length,
      uses: [
        ...new Set(
          skills.rows.filter((s) => s.brief_version_id === b.version_id).map((s) => s.name),
        ),
      ].sort(),
      starterRepo: b.repo_full_name,
    })),
  };
}
