import { config } from "./config.js";
import { Judge0Runner } from "./judge0/index.js";

/**
 * Where a learner's code is run.
 *
 * **Every submission goes through here**, so swapping sandbox is a one-file
 * change — the same reason `src/ollama.ts` is the single point every model
 * call passes through.
 *
 * `database-schema.md` §8 specifies Judge0 for JavaScript and Python, and a
 * Node test runner for React and Vue. **Judge0 is built** — see `src/judge0/`
 * and `docker/judge0/README.md` — and is selected with `CODE_RUNNER=judge0`.
 * The React and Vue runner is not.
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

/** One case as the worker reports it. The shape `code_submissions.test_results` holds. */
export interface TestOutcome {
  testCaseId: string;
  name: string;
  passed: boolean;
  /**
   * What the case expected and what it got, for §5.11's "Expected 2, got 0".
   * Absent when the run never reached the assertion.
   */
  expected?: string;
  actual?: string;
  /** Present on a case the learner may not read. Its name is still shown. */
  hidden: boolean;
}

export interface RunRequest {
  runtime: string;
  files: { path: string; content: string }[];
  cases: { id: string; name: string; code: string; visible: boolean }[];
}

export interface RunResult {
  outcomes: TestOutcome[];
  /** Compiler or interpreter output when the code did not run at all. */
  error?: string;
}

export interface Runner {
  name: string;
  /** Whether this runner can handle a `code_runtime`. */
  supports(runtime: string): boolean;
  run(request: RunRequest): Promise<RunResult>;
}

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
        `CODE_RUNNER is "${config.codeRunner}", which is not a runner. Use "judge0" or "none".`,
      );
  }
}
