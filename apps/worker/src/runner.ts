import { config } from "./config.js";
import type { Runner, RunRequest, RunResult } from "./sandbox/types.js";
import { DockerRunner } from "./sandbox/docker.js";
import { Judge0Runner } from "./sandbox/judge0.js";

/**
 * Where a learner's code is run.
 *
 * **Every submission goes through here**, so swapping sandbox is a one-file
 * change — the same reason `src/ollama.ts` is the single point every model
 * call passes through.
 *
 * `database-schema.md` §8 specifies Judge0 for JavaScript and Python, and a
 * Node test runner for React and Vue.
 *
 * **Judge0 does not run on Docker Desktop for Windows** — `isolate` needs cgroup
 * v1 and the WSL 2 VM is cgroup v2 unified. So the sandbox in use here is
 * `DockerRunner` (`CODE_RUNNER=docker`): one throwaway container per submission,
 * on the Docker that is already installed. `Judge0Runner` is kept and tested for
 * a Linux host, where it works unchanged. `docker/judge0/README.md` records the
 * measurement. The React and Vue runner is built in neither.
 *
 * With `CODE_RUNNER=none`, the default implementation **refuses honestly**: a
 * submission it cannot run is marked `error` with a message saying why, rather
 * than left `queued` for a learner to stare at. That failure mode has bitten
 * this project once already, on the generating screen.
 *
 * ### Why this is not just `eval` in the worker
 *
 * The worker process holds `DATABASE_URL`. Learner code running inside it
 * could read `process.env` and print the credentials into its own test output.
 * It could also read the disk, open sockets, or simply never return. A sandbox
 * is not caution here; it is the only thing that makes running somebody else's
 * code survivable — which is the same reason AGENT.md §6 rule 4 refuses to
 * trust results the browser computed.
 */

/**
 * The types live in `sandbox/types.ts`, which imports nothing — otherwise this
 * file and the implementations it constructs form a cycle. Re-exported here so
 * every existing `from "./runner.js"` keeps working.
 */
export type { Runner, RunRequest, RunResult, TestOutcome } from "./sandbox/types.js";

/**
 * The runner used when none is configured.
 *
 * It reports every case as failed with an explanation, which the worker turns
 * into an `error` submission. **It never reports a pass**: an unrun submission
 * must not be able to write a completion, and a runner that cannot run
 * anything is the most obvious way that could happen by accident.
 */
export class UnconfiguredRunner implements Runner {
  readonly name = "none";

  supports(): boolean {
    return false;
  }

  run(request: RunRequest): Promise<RunResult> {
    return Promise.resolve({
      outcomes: request.cases.map((c) => ({
        testCaseId: c.id,
        name: c.name,
        passed: false,
        hidden: !c.visible,
      })),
      error:
        `No sandbox is configured, so ${request.runtime} submissions cannot be run. ` +
        `Set CODE_RUNNER and its URL in apps/worker/.env — see docs/model-setup-guide.md.`,
    });
  }
}

/**
 * The runner this worker will use.
 *
 * Reads `CODE_RUNNER` so the choice is a setting rather than an edit. Adding
 * Judge0 means one more case here and one more file; nothing else in the
 * worker changes.
 */
export function createRunner(): Runner {
  switch (config.codeRunner) {
    /**
     * The default sandbox here. One throwaway container per submission, on the
     * Docker that is already installed. `project-proposal.md` §8.3 records why
     * this rather than Judge0.
     */
    case "docker":
      return new DockerRunner({
        binary: config.dockerBinary ?? undefined,
        timeoutSeconds: config.sandboxTimeoutSeconds,
        memoryMb: config.sandboxMemoryMb,
        cpus: config.sandboxCpus,
        pidsLimit: config.sandboxPidsLimit,
      });

    case "judge0":
      return new Judge0Runner({
        url: config.judge0Url,
        token: config.judge0Token,
        cpuTimeLimitSeconds: config.judge0CpuSeconds,
        memoryLimitKb: config.judge0MemoryKb,
      });
    case "none":
      return new UnconfiguredRunner();
    default:
      /**
       * A typo in `CODE_RUNNER` must not quietly become "no sandbox". It would
       * still refuse honestly, but the operator would be reading a message
       * about setup they believe they have done.
       */
      throw new Error(
        `CODE_RUNNER is "${config.codeRunner}", which is not a runner. ` +
          `Use "docker", "judge0", or "none".`,
      );
  }
}
