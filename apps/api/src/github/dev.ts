import { createHash } from "node:crypto";
import type {
  GitHubClient,
  GitHubCommit,
  GitHubFileDiff,
  GitHubIdentity,
  GitHubRepository,
  GitHubStep,
} from "./index.js";

/**
 * The development GitHub client. Nothing leaves the machine.
 *
 * The counterpart of `mail/console.ts`: it exists so the connect flow, the
 * commit path and the milestone checks can all be built and tested before an
 * App is registered, rather than the whole of Phase 4 waiting on an account.
 *
 * ### It invents, but it invents *consistently*
 *
 * Identity and repository are derived from the code by hash, so the same code
 * always gives the same account and the same numeric ids. A client that returned
 * random values would pass a single test and hide every bug about storing the
 * wrong id, or about a second connect overwriting the first.
 *
 * ### `installUrl` points at the API, not at GitHub
 *
 * There is no App to install, so it returns the callback directly with a code
 * already attached. Following it completes the flow end to end — which is what
 * makes the screen testable by hand, in the same way the console mailer's
 * printed link makes password reset testable by hand.
 */
export function createDevGitHub(): GitHubClient {
  return {
    name: "development",
    configured: false,

    installUrl(state: string): string {
      const code = `dev-${state.slice(0, 8)}`;
      // Relative: the API mounts the callback, and the caller knows its own
      // origin. Nothing here should have to be told what host it is on.
      return `/github/callback?installation_id=1&code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`;
    },

    identify(code: string): Promise<GitHubIdentity> {
      if (!code) return Promise.reject(new Error("No authorization code"));
      return Promise.resolve({
        githubUserId: numberFrom(code, 100_000),
        login: `learner-${short(code)}`,
      });
    },

    installationRepositories(installationId: number): Promise<GitHubRepository[]> {
      return Promise.resolve([
        {
          id: numberFrom(`repo-${installationId}`, 900_000),
          fullName: `learner-${short(String(installationId))}/task-tracker`,
          private: false,
        },
      ]);
    },

    /**
     * A small invented history, newest first, **fixed in time**.
     *
     * Dates are derived from the repository name rather than from `Date.now()`,
     * so two reads a second apart do not look like two different histories —
     * which would make "how many commits are new" untestable and would have the
     * screen redraw a different push every time it polled.
     *
     * `since` is honoured so the filtering itself is exercised: the sync only
     * inserts what it has not seen, and a client that ignored `since` would let
     * that pass untested.
     */
    listCommits(
      installationId: number,
      fullName: string,
      since?: string | null,
    ): Promise<GitHubCommit[]> {
      const epoch = Date.UTC(2026, 0, 1) + (numberFrom(fullName, 0) % 1000) * 60_000;

      const commits: GitHubCommit[] = ["Add the task form", "Build the layout", "Initial commit"].map(
        (message, i) => ({
          sha: digest(`${fullName}-${i}`).slice(0, 40),
          message,
          authorLogin: `learner-${short(String(installationId))}`,
          // Newest first: index 0 is the most recent.
          pushedAt: new Date(epoch + (2 - i) * 3_600_000).toISOString(),
        }),
      );

      return Promise.resolve(
        since ? commits.filter((c) => c.pushedAt > since) : commits,
      );
    },

    /**
     * A repository that looks like the starter template, so the seeded brief's
     * checks have something real to match against.
     *
     * Deliberately **missing `src/components/TaskForm.*`** — milestone 2 asks
     * for it and a learner who has only just cloned the template does not have
     * it yet. A tree where every check passes would make a passing result mean
     * nothing.
     */
    listFiles(): Promise<string[]> {
      return Promise.resolve([
        "README.md",
        ".github/workflows/test.yml",
        "package.json",
        "src/main.jsx",
        "src/App.jsx",
      ]);
    },

    /**
     * A small diff that matches the invented tree — enough for a review to have
     * something to say, and short enough that the trimmer is not what is being
     * exercised. A generated file is included so the skipping is reachable from
     * the development client too.
     */
    commitDiff(): Promise<GitHubFileDiff[]> {
      return Promise.resolve([
        {
          path: "src/App.jsx",
          patch:
            "@@ -1,3 +1,8 @@\n" +
            "+const [tasks, setTasks] = useState([]);\n" +
            "+function addTask(text) {\n" +
            "+  setTasks([...tasks, { id: crypto.randomUUID(), text }]);\n" +
            "+}\n",
        },
        { path: "package-lock.json", patch: "@@ -1 +1 @@\n+{}\n" },
      ]);
    },

    /**
     * One step per test the seeded brief names, and **one of them failing** —
     * for the same reason the tree is incomplete.
     */
    workflowSteps(): Promise<GitHubStep[]> {
      return Promise.resolve([
        { name: "renders the app shell", conclusion: "success" },
        { name: "adds a task", conclusion: "success" },
        { name: "edits a task", conclusion: "success" },
        { name: "rejects empty input", conclusion: "failure" },
        { name: "keeps tasks after a reload", conclusion: null },
      ]);
    },
  };
}

const digest = (value: string) => createHash("sha256").update(value).digest("hex");

/** A stable positive integer, so ids look like GitHub's and never collide by luck. */
function numberFrom(value: string, floor: number): number {
  return floor + (parseInt(digest(value).slice(0, 8), 16) % 1_000_000);
}

function short(value: string): string {
  return digest(value).slice(0, 6);
}
