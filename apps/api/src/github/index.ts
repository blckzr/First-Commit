import { createDevGitHub } from "./dev.js";
import { createRestGitHub } from "./rest.js";

/**
 * GitHub, for the capstone (`project-proposal.md` §6.2, `design.md` §5.14).
 *
 * **Two implementations behind one interface**, the same shape as `mail/`. In
 * development there is no App and nothing leaves the machine: the client invents
 * a stable identity and a repository, so the whole connect flow can be built and
 * tested without registering anything — exactly as all of §6.3's auth was built
 * against the console mailer. In production it goes through GitHub's REST API.
 *
 * Registering the App is therefore not a prerequisite for the code; it is what
 * has to happen before a *real* repository can be tracked.
 *
 * ### An App, not a token
 *
 * §5.14 promises "Only the repository you select is shared". A personal access
 * token cannot keep that promise — a classic one reaches every repository the
 * learner owns — and unauthenticated reads cannot receive pushes or prove a
 * repository belongs to anybody. An App installation is the only mechanism that
 * gives per-repository access chosen by the learner, webhooks, and an identity.
 *
 * ### Why both halves of the flow are needed
 *
 * An **installation** grants access to the chosen repositories and gives an
 * `installation_id`. It does not say *who* installed it. **User authorization**
 * — the OAuth half — is what returns the GitHub account, and
 * `github_connections` stores both because the repository has to be attributable
 * to a person for the certificate and the resume.
 */

/** The GitHub account behind an authorization. */
export interface GitHubIdentity {
  /** `github_connections.github_user_id`. Numeric and stable; the login is not. */
  githubUserId: number;
  login: string;
}

export interface GitHubRepository {
  /** `capstone_projects.repo_github_id`. Survives a rename, unlike the name. */
  id: number;
  /** `owner/name`, as §5.14 shows it. */
  fullName: string;
  private: boolean;
}

/** One commit, as `project_commits` stores it. */
export interface GitHubCommit {
  sha: string;
  message: string;
  /** Null when the commit's author has no GitHub account attached to the email. */
  authorLogin: string | null;
  pushedAt: string;
}

export interface GitHubClient {
  /** The implementation's name, for logging and tests. */
  readonly name: string;

  /** Whether a real App is configured. False means the development client. */
  readonly configured: boolean;

  /**
   * Where to send a learner to install the App and choose a repository.
   *
   * `state` is echoed back to the callback and is what makes the round trip
   * safe — see `github/routes.ts`.
   */
  installUrl(state: string): string;

  /**
   * Exchanges the OAuth code for the account that authorized it.
   *
   * Throws when the code is invalid or expired; the caller turns that into a
   * message rather than a stack trace, because an expired code is something a
   * learner can simply do again.
   */
  identify(code: string): Promise<GitHubIdentity>;

  /** The repositories an installation grants access to. */
  installationRepositories(installationId: number): Promise<GitHubRepository[]>;

  /**
   * Commits on the repository's default branch, newest first.
   *
   * `since` is an ISO timestamp: only what arrived after the newest commit
   * already stored, so a long history is fetched once rather than every read.
   *
   * **Additions and deletions are not included.** GitHub only gives them
   * per-commit, one request each, which would turn a 30-commit history into 31
   * calls against a rate limit shared by every learner on the installation.
   * `project_commits` allows null for both, and §5.14 shows neither.
   */
  listCommits(
    installationId: number,
    fullName: string,
    since?: string | null,
  ): Promise<GitHubCommit[]>;

  /**
   * Every file path in the repository at `ref`, as one list.
   *
   * The whole tree in a single call rather than a request per check: a
   * milestone with three `file_exists` checks would otherwise be three round
   * trips, and a brief has several milestones. Matching the glob happens here,
   * against the list.
   */
  listFiles(installationId: number, fullName: string, ref: string): Promise<string[]>;

  /**
   * The steps of the workflow run for one commit, with how each finished.
   *
   * A `workflow_test` check names a step, which is why the starter templates
   * run each test as its own named step — it is the only way to tell "rejects
   * empty input" passed from "the suite passed" without parsing a report.
   *
   * An empty list means no run exists yet for that commit, which is a
   * *pending* check rather than a failed one.
   */
  workflowSteps(
    installationId: number,
    fullName: string,
    workflow: string,
    sha: string,
  ): Promise<GitHubStep[]>;

  /**
   * The changed files of one commit, with their diffs.
   *
   * **The diff only** — AGENT.md's hardware budget says a milestone review
   * looks at that and nothing more, because 8GB of VRAM and a 16,384 context do
   * not stretch to a repository. The API fetches it because the worker has no
   * GitHub credentials, and sends it in the job payload the way `code_feedback`
   * carries files and test results.
   */
  commitDiff(installationId: number, fullName: string, sha: string): Promise<GitHubFileDiff[]>;
}

export interface GitHubStep {
  name: string;
  /** `success`, `failure`, `skipped`, … or null while still running. */
  conclusion: string | null;
}

/** One changed file of a commit, with its unified diff. */
export interface GitHubFileDiff {
  path: string;
  patch: string;
}

export interface GitHubOptions {
  appId: string | null;
  appSlug: string | null;
  clientId: string | null;
  clientSecret: string | null;
  privateKey: string | null;
}

/**
 * Picks the implementation.
 *
 * **All five settings or none.** A half-configured App fails at the first API
 * call with something unhelpful, so a partial configuration is refused at boot
 * with a message naming what is missing — the same reasoning as `secret()`
 * refusing a placeholder.
 */
export function createGitHub(options: GitHubOptions): GitHubClient {
  const present = Object.entries(options).filter(([, value]) => value);

  if (present.length === 0) return createDevGitHub();

  if (present.length < Object.keys(options).length) {
    const missing = Object.entries(options)
      .filter(([, value]) => !value)
      .map(([key]) => key);
    throw new Error(
      `GitHub is partly configured — missing ${missing.join(", ")}. ` +
        `Set all of GITHUB_APP_ID, GITHUB_APP_SLUG, GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET ` +
        `and GITHUB_PRIVATE_KEY, or none of them to use the development client.`,
    );
  }

  return createRestGitHub({
    appId: options.appId!,
    appSlug: options.appSlug!,
    clientId: options.clientId!,
    clientSecret: options.clientSecret!,
    privateKey: options.privateKey!,
  });
}
