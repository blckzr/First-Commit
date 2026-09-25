import { describe, expect, it } from "vitest";
import { containerArgs, DockerRunner } from "./docker.js";

/**
 * The local container sandbox.
 *
 * Two halves are tested here, and only two, because the rest belongs elsewhere:
 * reading a run's output is `results.test.ts` (shared with Judge0), and building
 * the program is `harness.test.ts`.
 *
 * - **The flag list**, because every flag is a limit and dropping one is silent.
 * - **Refusing honestly**, because a runtime this cannot run must not be
 *   reported as the learner's syntax error.
 *
 * What a unit test *cannot* prove is that the kernel applied the limits. That is
 * `npm run sandbox:check` against a real container, which reads `pids.max`,
 * `memory.max` and `cpu.max` back out and runs a program that never stops.
 */

const args = (runtime = "javascript", seconds = 5) =>
  containerArgs(runtime, "fc-run-test", seconds);

/** Reads the value that follows a flag, so order cannot silently drift. */
const valueOf = (list: string[], flag: string) => list[list.indexOf(flag) + 1];

describe("the container's flags", () => {
  /**
   * **`--init` is the one with a story.** Without it the in-container `timeout`
   * runs as PID 1, where signal defaults differ, and it silently does nothing —
   * an infinite loop ran for 631 seconds before it was killed by hand. A
   * sandbox that cannot stop a runaway program would hold the worker's only
   * slot indefinitely.
   */
  it("uses --init, so the in-container timeout actually fires", () => {
    expect(args()).toContain("--init");
  });

  it.each([
    ["--network", "none"],
    ["--cap-drop", "ALL"],
    ["--security-opt", "no-new-privileges"],
    ["--user", "1000:1000"],
  ])("passes %s %s", (flag, value) => {
    expect(valueOf(args(), flag)).toBe(value);
  });

  it.each(["--rm", "--read-only", "--init", "--interactive"])("passes %s", (flag) => {
    expect(args()).toContain(flag);
  });

  /** A program can otherwise swap its way around the memory cap. */
  it("caps swap at the same figure as memory", () => {
    const list = containerArgs("javascript", "c", 5, { memoryMb: 256 });
    expect(valueOf(list, "--memory")).toBe("256m");
    expect(valueOf(list, "--memory-swap")).toBe("256m");
  });

  it("limits processes, which is what stops a fork bomb", () => {
    expect(valueOf(args(), "--pids-limit")).toBe("64");
    expect(valueOf(containerArgs("javascript", "c", 5, { pidsLimit: 16 }), "--pids-limit")).toBe("16");
  });

  it("limits CPU", () => {
    expect(valueOf(args(), "--cpus")).toBe("1");
  });

  /** Scratch space, but nothing may be executed from it. */
  it("mounts /tmp noexec rather than leaving it read-only", () => {
    const tmpfs = valueOf(args(), "--tmpfs");
    expect(tmpfs).toContain("/tmp");
    expect(tmpfs).toContain("noexec");
    expect(tmpfs).toContain("nosuid");
  });

  it("names the container, so a run that must be killed can be found", () => {
    expect(valueOf(args(), "--name")).toBe("fc-run-test");
  });

  /**
   * The inner half of the double timeout. The outer half is this process
   * killing the container, and it exists because the inner half failing
   * silently is the bug that was found here.
   */
  it("gives the program a hard timeout inside the container", () => {
    const list = args("javascript", 9);
    expect(list.slice(-5)).toEqual(["timeout", "-s", "KILL", "9", "node"]);
  });

  it("runs the program from stdin, with nothing bind-mounted", () => {
    // No `-v` and no `--mount`: the source arrives on stdin, so there is no
    // temporary file and no Windows path to translate.
    expect(args()).not.toContain("-v");
    expect(args()).not.toContain("--mount");
    expect(args().at(-1)).toBe("node");
  });
});

describe("per-runtime images and commands", () => {
  it("runs javascript on a node image", () => {
    expect(args("javascript")).toContain("node:20-alpine");
  });

  /** `python3 -` reads the program from stdin, the same way bare `node` does. */
  it("runs python on a python image, reading stdin", () => {
    const list = args("python");
    expect(list).toContain("python:3.12-alpine");
    expect(list.slice(-2)).toEqual(["python3", "-"]);
  });

  it("takes an image override", () => {
    const list = containerArgs("javascript", "c", 5, { images: { javascript: "node:22-alpine" } });
    expect(list).toContain("node:22-alpine");
    expect(list).not.toContain("node:20-alpine");
  });
});

describe("which runtimes it takes", () => {
  const runner = new DockerRunner();

  it.each(["javascript", "python"])("supports %s", (runtime) => {
    expect(runner.supports(runtime)).toBe(true);
  });

  /**
   * React and Vue need a component test run — Vitest with jsdom and a
   * node_modules tree — so this is a different image and a different harness.
   * Claiming them would mean sending a component test to a bare runtime and
   * reporting the resulting syntax error as the learner's fault.
   */
  it.each(["react", "vue"])("does not claim to support %s", (runtime) => {
    expect(runner.supports(runtime)).toBe(false);
  });

  it("refuses a react submission without pretending to run it", async () => {
    const result = await runner.run({
      runtime: "react",
      files: [{ path: "App.jsx", content: "export default function App() {}" }],
      cases: [{ id: "c1", name: "renders", code: "expect(true).toBe(true);", visible: true }],
    });

    expect(result.outcomes[0].passed).toBe(false);
    expect(result.error).toContain("component test runner");
    expect(result.error).toContain("Your work is saved");
  });

  /** A hidden case stays hidden even in a refusal. */
  it("keeps a hidden case hidden when refusing", async () => {
    const result = await runner.run({
      runtime: "vue",
      files: [{ path: "App.vue", content: "" }],
      cases: [{ id: "h1", name: "hidden one", code: "expect(1).toBe(1);", visible: false }],
    });

    expect(result.outcomes[0].hidden).toBe(true);
  });
});

describe("when docker itself is not there", () => {
  /**
   * The generating screen taught this lesson once: a process that waits
   * silently is worse than one that says what is wrong. The learner's files are
   * already in `code_submissions`, so the message can honestly say so.
   */
  it("fails every case and says the work is saved", async () => {
    const runner = new DockerRunner({ binary: "definitely-not-a-real-binary" });

    const result = await runner.run({
      runtime: "javascript",
      files: [{ path: "s.js", content: "function f() {}" }],
      cases: [
        { id: "c1", name: "one", code: "expect(1).toBe(1);", visible: true },
        { id: "c2", name: "two", code: "expect(2).toBe(2);", visible: false },
      ],
    });

    expect(result.outcomes).toHaveLength(2);
    expect(result.outcomes.every((o) => !o.passed)).toBe(true);
    expect(result.error).toContain("Your work is saved");
    // Not "your tests failed" — nothing ran, and saying otherwise blames them.
    expect(result.error).not.toContain("failed");
  }, 30_000);

  /**
   * **The two audiences get different sentences.** A learner is told their work
   * is safe; they must not be told to restart a terminal they do not have. The
   * operator hint is what `sandbox:check` prints.
   */
  it("keeps the operator hint out of the learner message", async () => {
    const runner = new DockerRunner({ binary: "definitely-not-a-real-binary" });

    const result = await runner.run({
      runtime: "javascript",
      files: [{ path: "s.js", content: "function f() {}" }],
      cases: [{ id: "c1", name: "one", code: "expect(1).toBe(1);", visible: true }],
    });

    expect(result.error).not.toContain("PATH");
    expect(result.error).not.toContain("terminal");
    expect(runner.lastUnavailable).not.toBeNull();
  }, 30_000);

  /**
   * `ENOENT` is almost always a shell older than the Docker install, not a
   * missing Docker — and "spawn docker ENOENT" said none of that the first time
   * it happened. The hint has to name the actual cause.
   */
  it("explains a missing binary as a stale PATH", async () => {
    const runner = new DockerRunner({ binary: "definitely-not-a-real-binary" });

    await runner.run({
      runtime: "javascript",
      files: [{ path: "s.js", content: "function f() {}" }],
      cases: [{ id: "c1", name: "one", code: "expect(1).toBe(1);", visible: true }],
    });

    const hint = runner.lastUnavailable!.operatorHint;
    expect(hint).toContain("not on PATH");
    expect(hint).toContain("open a new");
    expect(hint).toContain("DOCKER_BINARY");
  }, 30_000);
});
