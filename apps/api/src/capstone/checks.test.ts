import { describe, expect, it } from "vitest";
import { createDevGitHub } from "../github/dev.js";
import type { GitHubClient } from "../github/index.js";
import { isLive, isPublicAddress, matchesGlob, runChecks, type MilestoneCheck } from "./checks.js";

/**
 * The automatic milestone checks (`project-proposal.md` §6.3).
 *
 * Two things get most of the attention here. **Pending is not failure** — a
 * learner who pushed ten seconds ago has no workflow run yet, and telling them
 * their code is wrong would be a lie the platform has no basis for. And the
 * **deployment check fetches an address the learner chose**, which is
 * server-side request forgery unless it is fenced.
 */

const context = {
  installationId: 1,
  repoFullName: "learner/task-tracker",
  sha: "a1b2c3d",
  demoUrl: null,
};

const check = (over: Partial<MilestoneCheck>): MilestoneCheck => ({
  id: "c1",
  type: "file_exists",
  name: "A check",
  config: {},
  ...over,
});

describe("matching a path against a glob", () => {
  it.each([
    ["README.md", "README.md"],
    [".github/workflows/test.yml", ".github/workflows/*.yml"],
    ["src/components/TaskForm.jsx", "src/components/TaskForm.*"],
    ["src/components/TaskForm.vue", "src/components/TaskForm.*"],
    ["src/a/b/c.js", "src/**/c.js"],
  ])("%s matches %s", (path, pattern) => {
    expect(matchesGlob(path, pattern)).toBe(true);
  });

  it.each([
    ["src/components/TaskForm.jsx", "src/TaskForm.*"],
    ["readme.md", "README.md"],
    // A single star must not cross a directory boundary, or
    // `.github/workflows/*.yml` would match a yml anywhere below it.
    [".github/workflows/nested/test.yml", ".github/workflows/*.yml"],
    ["TaskFormXjsx", "TaskForm.*"],
  ])("%s does not match %s", (path, pattern) => {
    expect(matchesGlob(path, pattern)).toBe(false);
  });

  it("does not match anything on an empty pattern", () => {
    expect(matchesGlob("README.md", "")).toBe(false);
  });
});

describe("file_exists", () => {
  const github = createDevGitHub();

  it("passes when something matches", async () => {
    const [result] = await runChecks(
      github,
      [check({ config: { path: ".github/workflows/*.yml" } })],
      context,
    );
    expect(result.state).toBe("passed");
  });

  /**
   * The development repository deliberately lacks this file: milestone 2 asks
   * for it and a learner who has only just cloned the template has not written
   * it. A tree where everything passed would make passing mean nothing.
   */
  it("fails when nothing does, and names what it looked for", async () => {
    const [result] = await runChecks(
      github,
      [check({ config: { path: "src/components/TaskForm.*" } })],
      context,
    );
    expect(result.state).toBe("failed");
    expect(result.detail).toContain("src/components/TaskForm.*");
  });

  /** Unreadable is not missing, and must not read as the learner's fault. */
  it("is pending when the repository cannot be read", async () => {
    const broken: GitHubClient = {
      ...github,
      listFiles: () => Promise.reject(new Error("boom")),
    };
    const [result] = await runChecks(broken, [check({ config: { path: "README.md" } })], context);

    expect(result.state).toBe("pending");
    expect(result.detail).toMatch(/couldn't read/i);
  });

  /** Several file checks in one milestone must not be several tree fetches. */
  it("reads the tree once for the whole milestone", async () => {
    let calls = 0;
    const counting: GitHubClient = {
      ...github,
      listFiles: (...args) => {
        calls += 1;
        return github.listFiles(...args);
      },
    };

    await runChecks(
      counting,
      [
        check({ id: "a", config: { path: "README.md" } }),
        check({ id: "b", config: { path: "package.json" } }),
        check({ id: "c", config: { path: "src/*.jsx" } }),
      ],
      context,
    );

    expect(calls).toBe(1);
  });
});

describe("workflow_test", () => {
  const github = createDevGitHub();
  const test = (name: string) =>
    check({ type: "workflow_test", config: { workflow: "test.yml", test_name: name } });

  it("passes on a successful step", async () => {
    const [result] = await runChecks(github, [test("adds a task")], context);
    expect(result.state).toBe("passed");
  });

  it("fails on a failing step", async () => {
    const [result] = await runChecks(github, [test("rejects empty input")], context);
    expect(result.state).toBe("failed");
    expect(result.detail).toContain("rejects empty input");
  });

  /** Still running is not failed. §5.14 shows "Running checks on commit…". */
  it("is pending while a step is still running", async () => {
    const [result] = await runChecks(github, [test("keeps tasks after a reload")], context);
    expect(result.state).toBe("pending");
    expect(result.detail).toMatch(/still running/i);
  });

  /**
   * No run yet, or the template's tests were renamed. The platform cannot tell
   * which from here, so it says the neutral true thing instead of blaming the
   * learner for a test it cannot find.
   */
  it("is pending when there is no step of that name", async () => {
    const [result] = await runChecks(github, [test("a test nobody wrote")], context);
    expect(result.state).toBe("pending");
    expect(result.detail).toMatch(/waiting for/i);
  });

  it("is pending when no run exists for the commit", async () => {
    const noRuns: GitHubClient = { ...github, workflowSteps: () => Promise.resolve([]) };
    const [result] = await runChecks(noRuns, [test("adds a task")], context);
    expect(result.state).toBe("pending");
  });

  it("reads the workflow once for several checks on it", async () => {
    let calls = 0;
    const counting: GitHubClient = {
      ...github,
      workflowSteps: (...args) => {
        calls += 1;
        return github.workflowSteps(...args);
      },
    };

    await runChecks(counting, [test("adds a task"), test("edits a task")], context);
    expect(calls).toBe(1);
  });
});

describe("deployment_url", () => {
  const github = createDevGitHub();
  const deployment = check({ type: "deployment_url", name: "The live address answers" });

  it("is pending until the learner gives an address", async () => {
    const [result] = await runChecks(github, [deployment], context);
    expect(result.state).toBe("pending");
    expect(result.detail).toMatch(/add your live address/i);
  });
});

/**
 * **The server-side request forgery guard.**
 *
 * This is the only check that fetches somewhere a learner chose. Without the
 * fence, `demo_url` could point at another service inside the host's network,
 * or at a cloud metadata endpoint that hands out credentials — and the pass or
 * fail would be a readable answer about what is there.
 *
 * None of these reach the network: each is refused before a request is made.
 */
describe("what the deployment check refuses to fetch", () => {
  /**
   * **Each asserts the *reason*, not just the outcome.**
   *
   * `ok: false` is also what a failed fetch returns, so a test that checked
   * only that would pass with the guard removed entirely — nothing listens on
   * `127.0.0.1:80` here either. The message is what distinguishes "refused
   * before any request" from "tried it and it did not answer", and only the
   * first is the guard working.
   */
  it.each([
    ["http://localhost:4000/health", "loopback by name"],
    ["http://127.0.0.1/", "loopback"],
    ["http://[::1]/", "IPv6 loopback"],
    ["http://169.254.169.254/latest/meta-data/", "cloud metadata"],
    ["http://10.0.0.5/", "private range"],
    ["http://192.168.1.1/", "private range"],
    ["http://172.16.4.2/", "private range"],
  ])("refuses %s (%s) without making a request", async (url) => {
    const result = await isLive(url);
    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/isn't reachable from the internet/i);
  });

  it.each(["file:///etc/passwd", "ftp://example.com/", "gopher://example.com/"])(
    "refuses %s for not being HTTP",
    async (url) => {
      const result = await isLive(url);
      expect(result.ok).toBe(false);
      expect(result.detail).toMatch(/http:\/\/ or https:\/\//i);
    },
  );

  it("refuses credentials embedded in the address", async () => {
    const result = await isLive("http://user:pass@example.com/");
    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/username and password/i);
  });

  it("refuses something that is not a URL at all", async () => {
    expect((await isLive("not a url")).ok).toBe(false);
  });
});

describe("which addresses count as public", () => {
  it.each(["10.0.0.1", "127.0.0.1", "169.254.169.254", "192.168.0.1", "172.20.1.1", "0.0.0.0"])(
    "%s is not public",
    (address) => {
      expect(isPublicAddress(address)).toBe(false);
    },
  );

  it.each(["::1", "fc00::1", "fd12:3456::1", "fe80::1"])("%s is not public", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  /** An IPv4-mapped IPv6 address is judged as the address it wraps. */
  it("sees through an IPv4-mapped address", () => {
    expect(isPublicAddress("::ffff:127.0.0.1")).toBe(false);
    expect(isPublicAddress("::ffff:93.184.216.34")).toBe(true);
  });

  it.each(["93.184.216.34", "8.8.8.8", "2606:2800:220:1::1"])("%s is public", (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });
});
