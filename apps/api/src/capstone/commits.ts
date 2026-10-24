import type { Pool } from "pg";
import type { GitHubClient } from "../github/index.js";

/**
 * Bringing a project's commits in from GitHub (`project-proposal.md` §6.2).
 *
 * ### Why this runs when the capstone is read
 *
 * §6.2 names two paths into `project_commits`: a webhook on every push, and a
 * periodic check "in case a delivery fails while the API is waking from sleep".
 * Neither exists yet — webhooks need a public address the API does not have.
 *
 * So the third path is the one this repo already uses for exactly this shape of
 * problem: **sync on read**, the way `syncCertificates()` decides about
 * certificates when a learner opens the screen. A learner looking at their
 * capstone is the moment the answer has to be current, and it needs no timer in
 * a service that sleeps after fifteen minutes.
 *
 * It does not replace the webhook. When the API has an address, a push will
 * arrive in seconds instead of on the next read, and this becomes the backstop
 * §6.2 describes.
 *
 * ### Nothing here is evidence
 *
 * A commit is a fact about a repository, not a claim about a learner
 * (AGENT.md §6 rule 1). It is read from GitHub rather than sent by a browser,
 * and no milestone is decided by it — the checks do that, and they run against
 * a commit that is already stored.
 */

export interface SyncResult {
  /** How many commits were new. Zero is the ordinary case. */
  added: number;
  /**
   * Whether GitHub answered. False means the stored history is what it was —
   * not that the project has no commits, which is a different sentence on
   * §5.14 and a different thing to tell somebody.
   */
  reachable: boolean;
}

interface ProjectRow {
  id: string;
  repo_full_name: string;
  installation_id: string;
}

export async function syncCommits(
  pool: Pool,
  github: GitHubClient,
  projectId: string,
): Promise<SyncResult> {
  const project = await pool.query<ProjectRow>(
    `select p.id, p.repo_full_name, c.installation_id
       from capstone_projects p
       join github_connections c on c.user_id = p.user_id
      where p.id = $1 and p.repo_full_name is not null`,
    [projectId],
  );

  // No repository yet, or the learner disconnected GitHub. Neither is an error:
  // there is simply nothing to fetch.
  if (!project.rows[0]) return { added: 0, reachable: true };
  const row = project.rows[0];

  /**
   * Only what is newer than the newest commit already stored.
   *
   * `pushed_at` rather than a count or a cursor, because GitHub's own `since`
   * filter takes a timestamp — and because a repository whose history was
   * rewritten does not renumber, it just stops matching, which this notices on
   * the next sync rather than silently duplicating.
   */
  const newest = await pool.query<{ pushed_at: string }>(
    `select pushed_at from project_commits
      where project_id = $1 order by pushed_at desc limit 1`,
    [row.id],
  );

  let commits;
  try {
    commits = await github.listCommits(
      Number(row.installation_id),
      row.repo_full_name,
      newest.rows[0]?.pushed_at ?? null,
    );
  } catch {
    return { added: 0, reachable: false };
  }

  let added = 0;
  for (const commit of commits) {
    /**
     * `unique (project_id, sha)`, so a commit already stored is skipped rather
     * than duplicated. This matters more than it looks: once webhooks are on,
     * the same push will arrive twice — once by delivery and once by this — and
     * the two must not double the history.
     *
     * `do nothing` with no `returning`, then `rowCount`: pg-mem returns the
     * existing row from `do nothing … returning`, where PostgreSQL returns
     * none, so counting the rows a `returning` gives back would be right in
     * production and wrong under test.
     */
    const result = await pool.query(
      `insert into project_commits (project_id, sha, message, author_login, pushed_at)
       values ($1, $2, $3, $4, $5)
       on conflict (project_id, sha) do nothing`,
      [row.id, commit.sha, commit.message, commit.authorLogin, commit.pushedAt],
    );
    added += result.rowCount ?? 0;
  }

  return { added, reachable: true };
}

export interface StoredCommit {
  sha: string;
  message: string;
  authorLogin: string | null;
  pushedAt: string;
}

/** The push history §5.14 stage 3 shows, newest first. */
export async function readCommits(
  pool: Pool,
  projectId: string,
  limit = 20,
): Promise<StoredCommit[]> {
  const { rows } = await pool.query<{
    sha: string;
    message: string;
    author_login: string | null;
    pushed_at: string;
  }>(
    `select sha, message, author_login, pushed_at
       from project_commits
      where project_id = $1
      order by pushed_at desc
      limit $2`,
    [projectId, limit],
  );

  return rows.map((r) => ({
    sha: r.sha,
    message: r.message,
    authorLogin: r.author_login,
    pushedAt: typeof r.pushed_at === "string" ? r.pushed_at : new Date(r.pushed_at).toISOString(),
  }));
}
