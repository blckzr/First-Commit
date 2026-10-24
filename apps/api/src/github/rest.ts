import { createSign } from "node:crypto";
import type {
  GitHubClient,
  GitHubCommit,
  GitHubFileDiff,
  GitHubIdentity,
  GitHubRepository,
  GitHubStep,
} from "./index.js";

/**
 * GitHub's REST API.
 *
 * **Unexercised until an App exists**, like `mail/brevo.ts` before a Brevo
 * account. The shapes come from GitHub's documented responses and the flow from
 * `project-proposal.md` §6.2; the first real installation is what proves it.
 *
 * ### Two kinds of credential, which is the part that trips people up
 *
 * - **The OAuth client id and secret** identify *the learner*. They exchange the
 *   `code` from the callback for a user token, which answers "who is this".
 * - **The App id and private key** identify *the application*. They sign a short
 *   JWT, which is exchanged for an **installation** token — the only thing that
 *   can read the repository the learner selected.
 *
 * They are not interchangeable and neither alone is enough: the first cannot
 * read a repository, the second cannot name a person.
 *
 * ### No dependency for the JWT
 *
 * RS256 is `crypto.createSign("RSA-SHA256")` plus base64url. A signing library
 * for one 20-line function would be a dependency to audit and update for no gain
 * (AGENT.md §10: do not install beyond what was asked).
 */

interface RestOptions {
  appId: string;
  appSlug: string;
  clientId: string;
  clientSecret: string;
  privateKey: string;
}

const API = "https://api.github.com";

export function createRestGitHub(options: RestOptions): GitHubClient {
  return {
    name: "github",
    configured: true,

    installUrl(state: string): string {
      return `https://github.com/apps/${options.appSlug}/installations/new?state=${encodeURIComponent(state)}`;
    },

    async identify(code: string): Promise<GitHubIdentity> {
      const token = await exchangeCode(options, code);

      const user = await request<{ id: number; login: string }>("/user", token);
      return { githubUserId: user.id, login: user.login };
    },

    async installationRepositories(installationId: number): Promise<GitHubRepository[]> {
      const token = await installationToken(options, installationId);

      const body = await request<{
        repositories: { id: number; full_name: string; private: boolean }[];
      }>("/installation/repositories?per_page=100", token);

      return body.repositories.map((r) => ({
        id: r.id,
        fullName: r.full_name,
        private: r.private,
      }));
    },

    async listCommits(
      installationId: number,
      fullName: string,
      since?: string | null,
    ): Promise<GitHubCommit[]> {
      const token = await installationToken(options, installationId);

      const query = new URLSearchParams({ per_page: "100" });
      if (since) query.set("since", since);

      /**
       * `since` is GitHub's own filter, so the history is fetched once rather
       * than on every read. One page: a learner past a hundred commits since
       * the last check has bigger news than a missing page, and the periodic
       * sweep will pick up the rest.
       */
      const commits = await request<
        {
          sha: string;
          commit: { message: string; author: { date: string } | null };
          author: { login: string } | null;
        }[]
      >(`/repos/${fullName}/commits?${query.toString()}`, token);

      return commits.map((c) => ({
        sha: c.sha,
        message: c.commit.message,
        // Null when the commit email matches no GitHub account — common with a
        // misconfigured local git, and not a reason to drop the commit.
        authorLogin: c.author?.login ?? null,
        pushedAt: c.commit.author?.date ?? new Date().toISOString(),
      }));
    },

    async listFiles(installationId: number, fullName: string, ref: string): Promise<string[]> {
      const token = await installationToken(options, installationId);

      /**
       * The git trees API with `recursive=1`: one request for the whole tree,
       * rather than walking directories. GitHub truncates very large trees and
       * says so — a starter-template-sized project is nowhere near the limit,
       * and a truncated tree is reported as a check that could not run rather
       * than a file that is missing.
       */
      const tree = await request<{
        tree: { path: string; type: string }[];
        truncated: boolean;
      }>(`/repos/${fullName}/git/trees/${ref}?recursive=1`, token);

      if (tree.truncated) {
        throw new Error("The repository tree is too large to read in one request");
      }

      return tree.tree.filter((entry) => entry.type === "blob").map((entry) => entry.path);
    },

    async workflowSteps(
      installationId: number,
      fullName: string,
      workflow: string,
      sha: string,
    ): Promise<GitHubStep[]> {
      const token = await installationToken(options, installationId);

      // The run of *this* workflow file for *this* commit. `head_sha` is what
      // ties a result to a commit rather than to whatever ran most recently.
      const runs = await request<{ workflow_runs: { id: number }[] }>(
        `/repos/${fullName}/actions/workflows/${encodeURIComponent(workflow)}/runs` +
          `?head_sha=${encodeURIComponent(sha)}&per_page=1`,
        token,
      );

      const run = runs.workflow_runs[0];
      // No run yet: pending, not failed. The caller draws that distinction.
      if (!run) return [];

      const jobs = await request<{
        jobs: { steps?: { name: string; conclusion: string | null }[] }[];
      }>(`/repos/${fullName}/actions/runs/${run.id}/jobs?per_page=100`, token);

      return jobs.jobs.flatMap((job) => job.steps ?? []);
    },

    async commitDiff(
      installationId: number,
      fullName: string,
      sha: string,
    ): Promise<GitHubFileDiff[]> {
      const token = await installationToken(options, installationId);

      const commit = await request<{
        files?: { filename: string; patch?: string }[];
      }>(`/repos/${fullName}/commits/${sha}`, token);

      /**
       * A file with no `patch` is a binary or a rename GitHub does not diff.
       * Dropped rather than sent as an empty hunk, which would have the model
       * remarking on a change it cannot see.
       */
      return (commit.files ?? [])
        .filter((file) => file.patch)
        .map((file) => ({ path: file.filename, patch: file.patch! }));
    },
  };
}

/**
 * The OAuth half. GitHub answers **200 with an `error` field** when a code is
 * wrong rather than a 4xx, so the body has to be read either way — checking the
 * status alone would treat an expired code as a successful exchange and then
 * fail further along with something unrecognisable.
 */
async function exchangeCode(options: RestOptions, code: string): Promise<string> {
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({
      client_id: options.clientId,
      client_secret: options.clientSecret,
      code,
    }),
  });

  const body = (await response.json()) as { access_token?: string; error_description?: string };
  if (!body.access_token) {
    throw new Error(body.error_description ?? "GitHub did not return an access token");
  }
  return body.access_token;
}

/** An installation token: sign a JWT as the App, trade it for one. Expires in an hour. */
async function installationToken(options: RestOptions, installationId: number): Promise<string> {
  const response = await fetch(`${API}/app/installations/${installationId}/access_tokens`, {
    method: "POST",
    headers: headers(appJwt(options)),
  });

  if (!response.ok) {
    throw new Error(`GitHub refused an installation token (${response.status})`);
  }
  const body = (await response.json()) as { token: string };
  return body.token;
}

/**
 * A JWT signed with the App's private key.
 *
 * `iat` is backdated a minute: GitHub rejects a token whose issue time is in the
 * future, and a clock a few seconds fast is enough to cause it. Ten minutes is
 * the maximum lifetime GitHub accepts.
 */
function appJwt(options: RestOptions): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({ iat: now - 60, exp: now + 9 * 60, iss: options.appId }),
  );

  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  const signature = signer.sign(options.privateKey).toString("base64url");

  return `${header}.${payload}.${signature}`;
}

async function request<T>(path: string, token: string): Promise<T> {
  const response = await fetch(`${API}${path}`, { headers: headers(token) });
  if (!response.ok) {
    throw new Error(`GitHub answered ${response.status} for ${path}`);
  }
  return (await response.json()) as T;
}

function headers(token: string): Record<string, string> {
  return {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "x-github-api-version": "2022-11-28",
    "user-agent": "first-commit",
  };
}

function base64url(value: string): string {
  return Buffer.from(value).toString("base64url");
}
