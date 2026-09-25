import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { Runner, RunRequest, RunResult } from "./types.js";
import { buildHarness, UnsupportedRuntime } from "./harness.js";
import { failAll, readOutcomes, trim } from "./results.js";

/**
 * The local container sandbox — one throwaway container per submission.
 *
 * **Why this and not Judge0**, which `project-proposal.md` §8.3 records in full: Judge0
 * sandboxes with `isolate`, which speaks cgroup v1 only, and the WSL 2 VM that
 * Docker Desktop runs on Windows is cgroup v2 unified. Measured on this machine:
 * a *privileged* container cannot mount a v1 hierarchy (`Invalid argument`), and
 * the `systemd.unified_cgroup_hierarchy=0` flag does not help because the
 * `docker-desktop` distro has no systemd to read it. That is
 * [judge0#583](https://github.com/judge0/judge0/issues/583), open with no fix.
 * Judge0 would need a real Linux VM. `Judge0Runner` is kept and tested for that
 * day; this runs on what is already installed.
 *
 * It also fits the runtimes this platform actually has. `code_runtime` is
 * `javascript, python, react, vue`; Judge0 covers the first two and **cannot**
 * do the last two, which need Vitest with jsdom and a `node_modules` tree. A
 * container runner is the natural shape for that one too, later.
 *
 * ### The isolation, and why each flag is here
 *
 * Every one of these was verified against a real container before being written
 * down — the whole point is that a learner's code cannot reach the worker's
 * environment, which holds `DATABASE_URL` and `WORKER_SECRET`.
 *
 * | Flag | Stops |
 * |---|---|
 * | `--init` | **A loop that never ends.** Without it the in-container `timeout` is PID 1, where signals behave differently, and it silently does nothing — measured: 631 seconds |
 * | `--network none` | Fetching an answer, or reaching anything on this machine. DNS fails with `EAI_AGAIN` |
 * | `--memory` + `--memory-swap` equal | An array that grows forever, and swapping around the cap |
 * | `--cpus` | One submission pinning the host while a model is loaded |
 * | `--pids-limit` | Fork bombs. Verified as `pids.max` in the container's own cgroup |
 * | `--read-only` + a small `noexec` tmpfs | Writing anywhere but scratch, and running anything from scratch |
 * | `--cap-drop ALL`, `--security-opt no-new-privileges` | Privilege escalation inside the container |
 * | `--user 1000:1000` | Running as root. Verified: `uid 1000` |
 * | `--rm` and a fresh container each time | One learner's run affecting the next |
 *
 * **The timeout is enforced twice**: `timeout -s KILL` inside, and this process
 * killing the container if that fails. Belt and braces, because the inside one
 * failing silently is exactly the bug that was found here.
 */

export interface DockerOptions {
  /**
   * `docker`, or a full path. `DOCKER_BINARY` sets it, for an install that is
   * not on PATH — see the ENOENT note further down.
   */
  binary?: string;
  images?: Partial<Record<string, string>>;
  /** Wall-clock seconds for the learner's program. */
  timeoutSeconds?: number;
  memoryMb?: number;
  cpus?: number;
  pidsLimit?: number;
  /** How long to wait for `docker` itself, beyond the program's own limit. */
  overheadMs?: number;
}

const DEFAULT_IMAGES: Record<string, string> = {
  javascript: "node:20-alpine",
  python: "python:3.12-alpine",
};

/** `docker` could not be started at all — an operator problem, not a learner's. */
export class DockerUnavailable extends Error {
  constructor(
    readonly learnerMessage: string,
    readonly operatorHint: string,
    cause: string,
  ) {
    super(cause);
    this.name = "DockerUnavailable";
  }
}

interface Spawned {
  stdout: string;
  stderr: string;
  code: number | null;
  /** True when *we* killed it, rather than the in-container `timeout`. */
  timedOut: boolean;
  /** How long the container took. Used to tell a timeout from an OOM. */
  elapsedMs: number;
  /** `docker` itself could not be run — not the learner's problem. */
  unavailable?: DockerUnavailable;
}

/**
 * The full `docker run` argument list for one submission.
 *
 * **Exported so the flags can be tested.** Every one is a limit, and dropping
 * one is silent — `--init` was missing at first and an infinite loop ran for
 * **631 seconds** before it was killed by hand, because the in-container
 * `timeout` is PID 1 without it and signals behave differently there. A unit
 * test over this list is what turns "somebody removed a flag" into a failure
 * instead of a submission that quietly cannot be stopped.
 *
 * The limits themselves are verified against a real container by
 * `npm run sandbox:check` — the test proves the flags are *asked for*, the check
 * proves the kernel *applied* them.
 */
export function containerArgs(
  runtime: string,
  container: string,
  seconds: number,
  options: DockerOptions = {},
): string[] {
  const image = options.images?.[runtime] ?? DEFAULT_IMAGES[runtime];
  const memory = `${options.memoryMb ?? 128}m`;

  /**
   * Both read a program from **stdin**, which is why nothing is bind-mounted:
   * no temporary file, and no Windows path translation — the part of
   * Docker-on-Windows most likely to break.
   */
  const command =
    runtime === "python"
      ? ["timeout", "-s", "KILL", String(seconds), "python3", "-"]
      : ["timeout", "-s", "KILL", String(seconds), "node"];

  return [
    "run",
    "--rm",
    "--interactive",
    "--name",
    container,
    // Every flag below was measured against a real container. See the table above.
    "--init",
    "--network",
    "none",
    "--memory",
    memory,
    // Equal to --memory, or a program can swap its way around the cap.
    "--memory-swap",
    memory,
    "--cpus",
    String(options.cpus ?? 1),
    "--pids-limit",
    String(options.pidsLimit ?? 64),
    "--read-only",
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,size=8m",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--user",
    "1000:1000",
    image,
    ...command,
  ];
}

export class DockerRunner implements Runner {
  readonly name = "docker";

  /**
   * Set when the last run could not start `docker` at all. Read by
   * `sandbox:check` to turn "spawn docker ENOENT" into something an operator can
   * act on — which is what it failed to do the first time somebody ran it.
   */
  lastUnavailable: DockerUnavailable | null = null;

  constructor(private readonly options: DockerOptions = {}) {}

  /**
   * §5.11's React and Vue exercises need a component test run — Vitest with
   * jsdom and a `node_modules` tree. That is a different image and a different
   * harness, so saying no here means the worker records an honest error rather
   * than reporting the resulting syntax error as the learner's fault.
   */
  supports(runtime: string): boolean {
    return runtime === "javascript" || runtime === "python";
  }

  async run(request: RunRequest): Promise<RunResult> {
    if (!this.supports(request.runtime)) {
      return this.refuse(
        request,
        `${request.runtime} exercises need a component test runner, which is not set up yet. ` +
          `Your work is saved.`,
      );
    }

    let harness;
    try {
      harness = buildHarness(request);
    } catch (err) {
      if (err instanceof UnsupportedRuntime) return this.refuse(request, err.message);
      throw err;
    }

    const seconds = this.options.timeoutSeconds ?? 5;
    const result = await this.spawnContainer(request.runtime, harness.source, seconds);

    if (result.unavailable) {
      /**
       * The learner gets a message about their work being safe; the operator
       * needs to know `docker` is not on PATH. `unavailable` carries both, and
       * `sandbox:check` prints the second — a learner reading "restart your
       * terminal" would be reading somebody else's instruction.
       */
      this.lastUnavailable = result.unavailable;
      return { outcomes: failAll(harness.cases), error: result.unavailable.learnerMessage };
    }
    this.lastUnavailable = null;

    /**
     * **137 is SIGKILL, and both limits produce it.** `timeout -s KILL` killing a
     * program that would not stop, and the kernel killing one that asked for too
     * much memory, are indistinguishable by exit code — and they need different
     * sentences, because they tell a learner to look at different things (§9).
     *
     * Elapsed time separates them. A timeout takes, by definition, the whole
     * allowance; an out-of-memory kill against a 128 MB cap happens long before
     * that. The margin is generous, so a slow container start cannot make a
     * memory failure look like a timeout.
     */
    if (result.timedOut || result.code === 137) {
      const ranOutOfTime =
        result.timedOut || result.elapsedMs >= seconds * 1000 * 0.9;

      return {
        outcomes: failAll(harness.cases),
        error: ranOutOfTime
          ? `Your code was still running after ${seconds} seconds. That usually means a loop ` +
            `that never ends — check the condition that should stop it.`
          : `Your code used more memory than the exercise allows. That usually means something ` +
            `being added to a list on every pass of a loop that never stops.`,
      };
    }

    /**
     * A non-zero exit with nothing on stdout is a program that did not get as
     * far as the assertions — a syntax error, or a throw at the top level. The
     * interpreter's own message is the useful part (§9).
     */
    if (result.code !== 0 && !result.stdout.includes("{")) {
      return {
        outcomes: failAll(harness.cases),
        error: trim(result.stderr) ?? `Your code exited with status ${result.code}.`,
      };
    }

    return readOutcomes(result.stdout, harness.cases);
  }

  /**
   * Runs one container and returns what it said.
   *
   * **The program goes in on stdin**, not a bind mount. `node` and `python3 -`
   * both read a program from stdin, which means no temporary file and no Windows
   * path translation — the part of Docker-on-Windows most likely to break.
   */
  private spawnContainer(runtime: string, source: string, seconds: number): Promise<Spawned> {
    const container = `fc-run-${randomUUID()}`;
    const args = containerArgs(runtime, container, seconds, this.options);

    const started = Date.now();

    return new Promise<Spawned>((resolve) => {
      const child = spawn(this.options.binary ?? "docker", args, {
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let settled = false;

      /**
       * A learner can print in a loop. Capped so a runaway `console.log` cannot
       * fill this process's memory — the cap is generous next to anything a
       * §5.11 exercise legitimately prints.
       */
      const LIMIT = 256 * 1024;
      child.stdout.on("data", (d: Buffer) => {
        if (stdout.length < LIMIT) stdout += d.toString("utf8");
      });
      child.stderr.on("data", (d: Buffer) => {
        if (stderr.length < LIMIT) stderr += d.toString("utf8");
      });

      /**
       * The outer half of the double timeout. `timeout -s KILL` inside the
       * container is the first line; this is what catches it not working, which
       * it did not before `--init` was added.
       */
      const timer = setTimeout(
        () => {
          timedOut = true;
          spawn(this.options.binary ?? "docker", ["kill", container], {
            stdio: "ignore",
          }).on("error", () => {});
          child.kill("SIGKILL");
        },
        seconds * 1000 + (this.options.overheadMs ?? 20_000),
      );

      const done = (value: Spawned) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };

      /**
       * `docker` could not be started. The learner's files are already saved and
       * the message says so (§9); the operator hint is kept separate because the
       * two audiences need different sentences.
       *
       * **`ENOENT` is almost always a stale PATH**, not a missing Docker: a
       * terminal opened before Docker Desktop was installed hands npm a PATH
       * without it, so `docker` works when typed and fails when spawned. That
       * happened on the first real run of this script, and "spawn docker ENOENT"
       * explained none of it.
       */
      child.on("error", (err) => {
        const enoent = (err as NodeJS.ErrnoException).code === "ENOENT";
        done({
          stdout: "",
          stderr: "",
          code: null,
          timedOut: false,
          elapsedMs: Date.now() - started,
          unavailable: new DockerUnavailable(
            `The code runner isn't available right now, so your tests haven't run yet. ` +
              `Your work is saved — try again in a minute.`,
            enoent
              ? `"${this.options.binary ?? "docker"}" is not on PATH in this shell. If Docker ` +
                `Desktop was installed after this terminal was opened, close it and open a new ` +
                `one — the old PATH has no Docker in it. Otherwise check that Docker Desktop is ` +
                `installed, or set DOCKER_BINARY to its full path.`
              : `Could not start "${this.options.binary ?? "docker"}": ${err.message}`,
            err.message,
          ),
        });
      });

      child.on("close", (code) =>
        done({ stdout, stderr, code, timedOut, elapsedMs: Date.now() - started }),
      );

      child.stdin.on("error", () => {});
      child.stdin.end(source, "utf8");
    });
  }

  /** Every case failed for a reason that is not the learner's fault. */
  private refuse(request: RunRequest, error: string): RunResult {
    return {
      outcomes: request.cases.map((c) => ({
        testCaseId: c.id,
        name: c.name,
        passed: false,
        hidden: !c.visible,
      })),
      error,
    };
  }
}
