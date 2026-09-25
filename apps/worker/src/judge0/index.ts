import { z } from "zod";
import type { Runner, RunRequest, RunResult, TestOutcome } from "../runner.js";
import { buildHarness, RESULT_MARKER, UnsupportedRuntime, type HarnessCase } from "./harness.js";

/**
 * Judge0 — the sandbox `project-proposal.md` §8 and `database-schema.md` §1
 * and §8 name.
 *
 * **It runs on your machine, beside Ollama.** The worker already pulls work
 * rather than being called, so nothing on the internet needs to reach either.
 * Setup is `docker/judge0/README.md`; `npm run judge0:check` proves it works
 * before a learner depends on it.
 *
 * ### What this trusts, and what it does not
 *
 * Judge0 is trusted to *contain* the code, which is the whole reason it exists
 * (see `runner.ts` for what happens without it). It is **not** trusted to
 * report the truth about the run: the outcomes come out of the learner's own
 * stdout, so a learner could print a line that looks like a result.
 *
 * Two things make that harmless. The harness never puts a database id in the
 * source, so a forged line has no real case to attach to — it carries an index,
 * and an index this runner did not send is dropped. And **a case with no result
 * is a failure**, never a pass, so deleting the assertions or exiting early
 * fails the exercise rather than clearing it.
 *
 * ### Language ids are discovered, not hard-coded
 *
 * Judge0's numeric ids move between releases, and a wrong one is a submission
 * that runs the wrong language. `GET /languages` is read once and matched by
 * name, so the setup on this machine decides rather than a constant in this
 * file.
 */

const Language = z.object({ id: z.number(), name: z.string() });
const Languages = z.array(Language);

/**
 * `wait=true` returns the finished submission, which suits one-job-at-a-time.
 * Judge0's own docs discourage it at scale; the worker claims a single
 * submission via `claim_next_code_submission()`, so there is no scale here to
 * spend a polling loop on.
 */
const Submission = z.object({
  stdout: z.string().nullable().default(null),
  stderr: z.string().nullable().default(null),
  compile_output: z.string().nullable().default(null),
  message: z.string().nullable().default(null),
  time: z.string().nullable().default(null),
  status: z.object({ id: z.number(), description: z.string() }),
});
export type Judge0Submission = z.infer<typeof Submission>;

/** One reported case, as the harness prints it. */
const ResultLine = z.object({
  i: z.number().int().nonnegative(),
  passed: z.boolean(),
  expected: z.string().optional(),
  actual: z.string().optional(),
  error: z.string().optional(),
});

/**
 * Judge0 status ids. 3 is Accepted; everything above it is a way of not
 * finishing. Only the ones that need different wording are named — the rest
 * fall through to the description Judge0 gives, which is already plain.
 */
const STATUS = {
  accepted: 3,
  wrongAnswer: 4,
  timeLimit: 5,
  compileError: 6,
  runtimeErrorFirst: 7,
  runtimeErrorLast: 12,
} as const;

export interface Judge0Options {
  url: string;
  /** Set when Judge0 is configured with `AUTHN_TOKEN`; usually unset locally. */
  token?: string | null;
  cpuTimeLimitSeconds?: number;
  memoryLimitKb?: number;
  requestTimeoutMs?: number;
}

export class Judge0Runner implements Runner {
  readonly name = "judge0";

  /** Read once from `GET /languages` and kept for the process's life. */
  private languages: Map<string, number> | null = null;

  constructor(private readonly options: Judge0Options) {}

  /**
   * §5.11's React and Vue exercises are **not** Judge0's job: they need Vitest
   * with jsdom and a node_modules tree. Saying so here means the worker records
   * an honest error instead of sending a component test to a bare Node runtime
   * and reporting the resulting syntax error as the learner's fault.
   */
  supports(runtime: string): boolean {
    return runtime === "javascript" || runtime === "python";
  }

  async run(request: RunRequest): Promise<RunResult> {
    if (!this.supports(request.runtime)) {
      return this.allFailed(
        request,
        `${request.runtime} exercises need a component test runner, which is not set up yet. ` +
          `Your work is saved.`,
      );
    }

    let harness;
    try {
      harness = buildHarness(request);
    } catch (err) {
      if (err instanceof UnsupportedRuntime) return this.allFailed(request, err.message);
      throw err;
    }

    let languageId: number;
    try {
      languageId = await this.languageFor(request.runtime);
    } catch (err) {
      return this.allFailed(request, reachError(err, this.options.url));
    }

    let submission: Judge0Submission;
    try {
      submission = await this.submit(harness.source, languageId);
    } catch (err) {
      return this.allFailed(request, reachError(err, this.options.url));
    }

    return this.readResult(submission, harness.cases);
  }

  /**
   * Turns one finished Judge0 submission into per-case outcomes.
   *
   * Exported through the class so the tests can drive it with a recorded
   * response — the mapping from Judge0's single status to §5.11's list of ticks
   * is where the interesting mistakes live, and it needs no container to test.
   */
  readResult(submission: Judge0Submission, cases: HarnessCase[]): RunResult {
    const status = submission.status.id;

    /**
     * The program did not run, so there is nothing per-case to report. §9: say
     * what happened and what to do, without apologising. The compiler's own
     * output is the most useful thing here, so it is passed through.
     */
    if (status === STATUS.compileError) {
      return {
        outcomes: failAll(cases),
        error: trim(submission.compile_output) ?? "Your code could not be parsed.",
      };
    }

    if (status === STATUS.timeLimit) {
      return {
        outcomes: failAll(cases),
        error:
          "Your code took too long to finish. That usually means a loop that never ends — " +
          "check the condition that should stop it.",
      };
    }

    if (status >= STATUS.runtimeErrorFirst && status <= STATUS.runtimeErrorLast) {
      return {
        outcomes: failAll(cases),
        error: trim(submission.stderr) ?? submission.status.description,
      };
    }

    if (status !== STATUS.accepted && status !== STATUS.wrongAnswer) {
      // Queued, processing, or an internal error. Either way the platform has
      // no results, and it must not say the learner failed their tests.
      return {
        outcomes: failAll(cases),
        error: trim(submission.message) ?? submission.status.description,
      };
    }

    const reported = this.parseLines(submission.stdout ?? "", cases.length);

    /**
     * **A case with no line is a failure.** The program ran but said nothing
     * about this case: it exited early, or the assertions were removed. Neither
     * is a pass, and treating silence as success is exactly how hidden cases
     * would stop meaning anything.
     */
    const outcomes: TestOutcome[] = cases.map((c) => {
      const line = reported.get(c.i);
      if (!line) {
        return {
          testCaseId: c.id,
          name: c.name,
          passed: false,
          hidden: false,
          actual: "the test did not report a result",
        };
      }
      return {
        testCaseId: c.id,
        name: c.name,
        passed: line.passed,
        hidden: false,
        ...(line.expected !== undefined ? { expected: line.expected } : {}),
        ...(line.actual !== undefined ? { actual: line.actual } : {}),
        ...(line.error !== undefined && line.actual === undefined
          ? { actual: line.error }
          : {}),
      };
    });

    /**
     * Nothing parsed at all, with the program reporting success. stdout is not
     * what the harness writes — a runtime that printed nothing, or output
     * mangled beyond use. Reported as an error rather than as every test
     * failing, because the learner's code is not what went wrong.
     */
    if (reported.size === 0 && cases.length > 0) {
      return {
        outcomes,
        error:
          "The tests ran but reported nothing back. This is a problem on our side, not with " +
          "your code — your work is saved.",
      };
    }

    return { outcomes };
  }

  /**
   * Reads result lines out of stdout, ignoring everything else.
   *
   * A learner's own `console.log` shares this stream, so only lines carrying the
   * marker *and* parsing as a result *and* naming an index this run actually
   * sent are kept. The first line for an index wins, so a forged duplicate
   * cannot overwrite a real failure.
   */
  private parseLines(stdout: string, count: number): Map<number, z.infer<typeof ResultLine>> {
    const found = new Map<number, z.infer<typeof ResultLine>>();

    for (const raw of stdout.split("\n")) {
      const line = raw.trim();
      if (!line.startsWith(RESULT_MARKER)) continue;

      let json: unknown;
      try {
        json = JSON.parse(line.slice(RESULT_MARKER.length).trim());
      } catch {
        continue;
      }

      const parsed = ResultLine.safeParse(json);
      if (!parsed.success) continue;
      if (parsed.data.i >= count) continue;
      if (found.has(parsed.data.i)) continue;

      found.set(parsed.data.i, parsed.data);
    }

    return found;
  }

  private async languageFor(runtime: string): Promise<number> {
    if (!this.languages) {
      const res = await this.fetch("/languages", { method: "GET" });
      this.languages = new Map(
        Languages.parse(await res.json()).map((l) => [l.name.toLowerCase(), l.id]),
      );
    }

    /**
     * Matched by name because the ids move between releases. Judge0 names a
     * language with its version — "JavaScript (Node.js 12.14.0)" — so this
     * takes the highest id whose name starts with the language, which is
     * Judge0's own newest build of it.
     */
    const want = runtime === "python" ? "python" : "javascript";
    const matches = [...this.languages.entries()]
      .filter(([name]) => name.startsWith(want))
      .map(([, id]) => id)
      .sort((a, b) => b - a);

    if (matches.length === 0) {
      throw new Error(
        `Judge0 at ${this.options.url} offers no ${want} runtime. ` +
          `Run \`npm run judge0:check\` to see what it does offer.`,
      );
    }
    return matches[0];
  }

  private async submit(source: string, languageId: number): Promise<Judge0Submission> {
    const res = await this.fetch("/submissions?base64_encoded=false&wait=true", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source_code: source,
        language_id: languageId,
        /**
         * Limits, not suggestions. The wall-clock limit is what stops a loop
         * that never ends from holding the worker's one slot; the memory limit
         * is what stops an array that grows forever from pressuring a machine
         * that is also holding a model in VRAM.
         */
        cpu_time_limit: this.options.cpuTimeLimitSeconds ?? 5,
        memory_limit: this.options.memoryLimitKb ?? 128_000,
        /**
         * §5.11 exercises are self-contained. No network means a solution
         * cannot fetch an answer, and cannot reach anything on this machine.
         */
        enable_network: false,
      }),
    });

    return Submission.parse(await res.json());
  }

  private async fetch(path: string, init: RequestInit): Promise<Response> {
    const headers = new Headers(init.headers);
    if (this.options.token) headers.set("X-Auth-Token", this.options.token);

    const res = await fetch(`${this.options.url.replace(/\/$/, "")}${path}`, {
      ...init,
      headers,
      signal: AbortSignal.timeout(this.options.requestTimeoutMs ?? 30_000),
    });

    if (!res.ok) {
      throw new Error(`Judge0 answered ${res.status} ${res.statusText} for ${path}`);
    }
    return res;
  }

  /** Every case failed for a reason that is not the learner's fault. */
  private allFailed(request: RunRequest, error: string): RunResult {
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

function failAll(cases: HarnessCase[]): TestOutcome[] {
  return cases.map((c) => ({
    testCaseId: c.id,
    name: c.name,
    passed: false,
    hidden: false,
  }));
}

function trim(value: string | null): string | null {
  const text = value?.trim();
  if (!text) return null;
  // Long compiler output is read on a phone too (§11). Enough to find the
  // problem, not the whole trace.
  return text.length > 2000 ? `${text.slice(0, 2000)}\n…` : text;
}

/**
 * The message a learner sees when Judge0 is not answering.
 *
 * This is the failure mode the generating screen already taught us about: a
 * process that waits silently is worse than one that says what is wrong. The
 * learner is told their work is safe, because it is — the files are already in
 * `code_submissions`.
 */
function reachError(err: unknown, url: string): string {
  const message = err instanceof Error ? err.message : String(err);
  const unreachable =
    err instanceof TypeError ||
    (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError"));

  if (unreachable) {
    return (
      `The code runner isn't responding right now, so your tests haven't run yet. ` +
      `Your work is saved — try again in a minute. (No answer from ${url}.)`
    );
  }
  return `The code runner couldn't run your tests: ${message} Your work is saved.`;
}
