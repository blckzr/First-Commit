import type { Pool } from "pg";
import type { GitHubClient } from "../github/index.js";
import { syncCommits } from "./commits.js";

/**
 * The commit backstop (`project-proposal.md` §6.2).
 *
 * §6.2 names two paths into `project_commits`, and the second is "the worker
 * also checks for new commits periodically, in case a delivery fails while the
 * API is waking from sleep".
 *
 * ### It lives in the API, not the worker
 *
 * That is a deliberate departure from §6.2's wording, and the reason is simple:
 * **the worker has no GitHub credentials.** The App's private key is the API's
 * alone (AGENT.md §10 lists it beside `SESSION_SECRET`), and the whole point of
 * the worker is that it makes only outgoing connections to Ollama and the
 * database. Giving it the key to satisfy the letter of §6.2 would spread the
 * most sensitive secret in the project across two processes to save one timer.
 *
 * Everything §6.2 actually wants is kept: a push that arrives while the API is
 * asleep is picked up later rather than lost. §6.2 should be amended to say
 * "the API" rather than "the worker"; the behaviour is what it describes.
 *
 * ### Three paths now, and they cannot double
 *
 * The webhook, the read, and this. All three go through the same
 * `on conflict (project_id, sha) do nothing`, which is why that clause has a
 * test of its own rather than being assumed.
 *
 * ### Only projects that are building
 *
 * A finished project gains no commits worth chasing, and one still choosing a
 * repository has none. Sweeping everything would spend an installation's rate
 * limit on projects nobody is pushing to.
 */

/** Ten minutes. A webhook is seconds; this only has to beat the next page load. */
const SWEEP_MS = 10 * 60 * 1000;

/** At most this many per tick, so one sweep cannot exhaust a rate limit. */
const BATCH = 20;

export function startCommitSweep(
  pool: Pool,
  github: GitHubClient,
  intervalMs = SWEEP_MS,
): () => void {
  const timer = setInterval(() => {
    sweepCommits(pool, github).catch((err: unknown) => {
      // Never fatal: the read path still works, and the next tick tries again.
      console.error("[capstone] commit sweep failed:", (err as Error).message);
    });
  }, intervalMs);

  // `unref` so the timer never holds the process open — the same courtesy the
  // SSE hub's heartbeat extends.
  timer.unref();

  return () => clearInterval(timer);
}

export async function sweepCommits(pool: Pool, github: GitHubClient): Promise<number> {
  const { rows } = await pool.query<{ id: string }>(
    `select p.id
       from capstone_projects p
       join github_connections c on c.user_id = p.user_id
      where p.status = 'in_progress' and p.repo_full_name is not null
      order by p.started_at
      limit $1`,
    [BATCH],
  );

  let synced = 0;
  for (const project of rows) {
    /**
     * One project's failure must not stop the rest. An installation the learner
     * removed, a repository they deleted — both are ordinary, and neither is a
     * reason to skip everybody behind them in the list.
     */
    try {
      const result = await syncCommits(pool, github, project.id);
      if (result.reachable) synced += 1;
    } catch (err) {
      console.error(
        `[capstone] sweep failed for project ${project.id}:`,
        (err as Error).message,
      );
    }
  }

  return synced;
}
