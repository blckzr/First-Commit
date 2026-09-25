/**
 * Local AI worker. Claims jobs from PostgreSQL one at a time, runs them on
 * Ollama, and writes the results back.
 *
 *   npm run worker
 *
 * The worker only makes outgoing connections: it pulls work from the database
 * rather than waiting to be called, so nothing on the internet needs to reach
 * the machine with the GPU (docs/database-schema.md §1).
 */
import { Pool } from "pg";
import { dbConfig, config } from "./config.js";
import { chatJson } from "./ollama.js";
import { buildCodeFeedbackMessages, type CodeFeedbackInput } from "./prompts/code-feedback.js";
import { PROMPT_VERSION as ROADMAP_PROMPT_VERSION, SYSTEM as ROADMAP_SYSTEM } from "./prompts/roadmap.js";
import { runRoadmapGeneration } from "./roadmap/index.js";
import { CodeFeedback, noSolutionLeak } from "./schemas.js";
import { createRunner } from "./runner.js";
import { queueFeedback, runSubmission, type Submission } from "./submissions.js";

const db = dbConfig();

const pool = new Pool({
  connectionString: db.databaseUrl,
  // One job at a time (docs/model-setup-guide.md §5), so one connection is
  // all that is ever needed.
  max: 1,
  // Supabase requires TLS but presents a certificate this client will not
  // chain to a local root, which is the documented way to connect.
  ssl: { rejectUnauthorized: false },
});

interface AiJob {
  id: string;
  type: string;
  user_id: string | null;
  source_id: string | null;
  payload: unknown;
  attempts: number;
}

type Handler = (job: AiJob) => Promise<{
  result: unknown;
  output?: unknown;
  /** Recorded on the job, so an evaluation result maps to an exact prompt (§7). */
  promptVersion?: number;
}>;

const handlers: Record<string, Handler> = {
  async code_feedback(job) {
    const input = job.payload as CodeFeedbackInput;
    const r = await chatJson({
      schema: CodeFeedback,
      messages: buildCodeFeedbackMessages(input),
      validate: noSolutionLeak,
    });
    return { result: { attempts: r.attempts, durationMs: r.durationMs }, output: r.data };
  },

  roadmap_generation: (job) => runRoadmapGeneration(pool, job),

  // Add milestone_review and resume_generation as you build them.
  // Their output schemas are already in schemas.ts.
};

/**
 * Registers this build's prompts in `ai_prompts` (AGENT.md §7: one active
 * version per component, recorded on every job).
 *
 * **It refuses to start if the stored text for a version differs from the code.**
 * That is the enforcement of "never change a prompt in place without a new
 * version row" — otherwise an edited prompt would quietly invalidate every
 * evaluation result already recorded against that number.
 */
async function registerPrompts(): Promise<void> {
  const prompts = [
    { component: "roadmap_generation", version: ROADMAP_PROMPT_VERSION, content: ROADMAP_SYSTEM },
  ];

  for (const prompt of prompts) {
    const existing = await pool.query<{ content: string }>(
      `select content from ai_prompts where component = $1 and version_no = $2`,
      [prompt.component, prompt.version],
    );

    if (existing.rows[0] && existing.rows[0].content !== prompt.content) {
      throw new Error(
        `The stored ${prompt.component} prompt version ${prompt.version} differs from the code. ` +
          `Bump PROMPT_VERSION instead of editing a published prompt.`,
      );
    }

    if (!existing.rows[0]) {
      await pool.query(
        `insert into ai_prompts (component, version_no, content, is_active) values ($1, $2, $3, false)`,
        [prompt.component, prompt.version, prompt.content],
      );
    }

    // One active version per component; the partial unique index enforces it,
    // so the old one is stood down first.
    await pool.query(
      `update ai_prompts set is_active = false where component = $1 and version_no <> $2 and is_active`,
      [prompt.component, prompt.version],
    );
    await pool.query(
      `update ai_prompts set is_active = true where component = $1 and version_no = $2`,
      [prompt.component, prompt.version],
    );
  }
}

const MAX_JOB_ATTEMPTS = 3;

/**
 * How long to wait before putting a failed job back on the queue, indexed by
 * the attempt that just failed.
 *
 * **Without this the three attempts are not three attempts.** `claim_next_ai_job()`
 * takes the oldest queued job, so a job re-queued immediately is re-claimed on
 * the next poll — and a job that fails because Ollama is not running burns all
 * three inside a second, against the same dead socket, and lands in `failed`
 * before anyone can start it. That is exactly how a learner ended up stuck on
 * the generating screen.
 *
 * The job stays `running` while we wait, which is honest: the worker has not
 * finished with it. A worker killed mid-wait leaves it `running`, which
 * `requeueStranded()` picks up at the next start.
 */
const RETRY_BACKOFF_MS = [15_000, 60_000];

let running = true;

/** Resolves early when the worker is shutting down, so Ctrl+C is not ignored. */
async function wait(ms: number): Promise<void> {
  const step = 500;
  for (let waited = 0; waited < ms && running; waited += step) {
    await new Promise((r) => setTimeout(r, Math.min(step, ms - waited)));
  }
}

/**
 * Puts jobs left `running` by a worker that stopped mid-job back on the queue.
 *
 * A job is only `running` while one worker holds it, and there is only ever one
 * worker (§7: one job at a time on one GPU), so anything still `running` at
 * startup was abandoned — by a crash, a Ctrl+C during the retry wait, or a
 * machine that went to sleep. Left alone it is stranded forever, because
 * `claim_next_ai_job()` only ever looks at `queued`.
 */
async function requeueStranded(): Promise<void> {
  const jobs = await pool.query(
    `update ai_jobs
        set status = 'queued'
      where status = 'running'
        and started_at < now() - interval '15 minutes'`,
  );
  if (jobs.rowCount) console.log(`Requeued ${jobs.rowCount} job(s) left running by a previous worker.`);

  // Submissions strand the same way, and for the same reason.
  const submissions = await pool.query(
    `update code_submissions
        set status = 'queued'
      where status = 'running'
        and submitted_at < now() - interval '15 minutes'`,
  );
  if (submissions.rowCount) {
    console.log(`Requeued ${submissions.rowCount} submission(s) left running by a previous worker.`);
  }
}

const runner = createRunner();

/**
 * Takes one code submission, if there is one (design.md §5.11).
 *
 * Separate from `processOne` because a submission is not an AI job: it has its
 * own table, its own claim function, and it runs **before** any model call —
 * §7's rule that tests and checks produce the facts the model then explains.
 */
async function processSubmission(): Promise<boolean> {
  const claimed = await pool.query<Submission>("select * from claim_next_code_submission()");
  const submission = claimed.rows[0];
  if (!submission) return false;

  const started = Date.now();
  console.log(`→ submission ${submission.id} (${runner.name})`);

  try {
    const { passed, status } = await runSubmission(pool, runner, submission);

    const stored = await pool.query<{ test_results: unknown }>(
      `select test_results from code_submissions where id = $1`,
      [submission.id],
    );
    const outcomes = Array.isArray(stored.rows[0]?.test_results)
      ? (stored.rows[0].test_results as { name: string; passed: boolean }[])
      : [];
    await queueFeedback(pool, submission, outcomes as never);

    const took = ((Date.now() - started) / 1000).toFixed(1);
    console.log(
      status === "error"
        ? `✕ submission ${submission.id}: could not be run in ${took}s`
        : `${passed ? "✓" : "✕"} submission ${submission.id} in ${took}s`,
    );
    await notifyApi({
      id: submission.id,
      type: "code_submission",
      user_id: submission.user_id,
    } as AiJob);
  } catch (err) {
    // A database failure, not a failed test run — those are recorded as
    // results. Put it back so a restart tries again.
    await pool.query(`update code_submissions set status = 'queued' where id = $1`, [
      submission.id,
    ]);
    console.error(`✕ submission ${submission.id}: ${(err as Error).message} (requeued)`);
  }
  return true;
}

/**
 * Tell the API a result is ready, so it can push it to the learner's open SSE
 * stream (AGENT.md §3).
 *
 * Deliberately non-fatal: the result is already committed, and the API sweeps
 * for unsent rows. A failure here delays an update, it does not lose one.
 */
async function notifyApi(job: AiJob): Promise<void> {
  if (!db.apiUrl || !db.workerSecret) return;
  try {
    const res = await fetch(`${db.apiUrl}/internal/events`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-worker-secret": db.workerSecret,
      },
      body: JSON.stringify({ jobId: job.id, userId: job.user_id, type: job.type }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) console.warn(`  notify: API replied ${res.status}; the sweep will catch it`);
  } catch (err) {
    console.warn(`  notify: ${(err as Error).message}; the sweep will catch it`);
  }
}

async function processOne(): Promise<boolean> {
  const claimed = await pool.query<AiJob>("select * from claim_next_ai_job()");
  const job = claimed.rows[0];
  if (!job) return false;

  const started = Date.now();
  console.log(`→ ${job.type} ${job.id} (attempt ${job.attempts})`);

  try {
    const handler = handlers[job.type];
    if (!handler) throw new Error(`No handler for job type ${job.type}`);
    const { result, output, promptVersion } = await handler(job);

    if (output !== undefined && job.user_id && job.source_id) {
      await pool.query(
        `insert into ai_outputs (job_id, user_id, source_type, source_id, content)
         values ($1, $2, $3, $4, $5)`,
        [job.id, job.user_id, job.type, job.source_id, output],
      );
    }

    await pool.query(
      `update ai_jobs
          set status = 'completed', result = $1, model = $2, prompt_version = $3, completed_at = now()
        where id = $4`,
      [result, config.model, promptVersion ?? null, job.id],
    );

    console.log(`✓ ${job.type} ${job.id} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    await notifyApi(job);
  } catch (err) {
    const message = (err as Error).message;
    const retry = job.attempts < MAX_JOB_ATTEMPTS;

    // Recorded before the wait, so the row says what went wrong even if the
    // worker is killed before it gets back to the queue.
    await pool.query(`update ai_jobs set error = $1, model = $2 where id = $3`, [
      message,
      config.model,
      job.id,
    ]);

    if (retry) {
      const backoff = RETRY_BACKOFF_MS[job.attempts - 1] ?? RETRY_BACKOFF_MS.at(-1)!;
      console.error(
        `✕ ${job.type} ${job.id}: ${message} (retrying in ${backoff / 1000}s)`,
      );
      await wait(backoff);
      await pool.query(`update ai_jobs set status = 'queued' where id = $1`, [job.id]);
    } else {
      await pool.query(`update ai_jobs set status = 'failed' where id = $1`, [job.id]);
      console.error(`✕ ${job.type} ${job.id}: ${message} (gave up after ${job.attempts} attempts)`);
    }
  }
  return true;
}

async function main() {
  console.log(`First Commit AI worker started. Model ${config.model}, mode ${config.jsonMode}.`);
  console.log(
    runner.name === "none"
      ? "No code sandbox configured: submissions will fail with an explanation. Set CODE_RUNNER."
      : `Code sandbox: ${runner.name}.`,
  );
  await registerPrompts();
  await requeueStranded();
  if (!db.apiUrl || !db.workerSecret) {
    console.log("API_URL or WORKER_SECRET unset: results are written but not announced.");
  }

  while (running) {
    try {
      // Submissions first: a learner is watching one, and nothing else on the
      // queue has somebody sitting in front of it.
      const ranSubmission = await processSubmission();
      const didWork = ranSubmission || (await processOne());
      if (!didWork) await new Promise((r) => setTimeout(r, db.pollMs));
    } catch (err) {
      console.error((err as Error).message);
      await new Promise((r) => setTimeout(r, db.pollMs * 3));
    }
  }

  await pool.end();
  console.log("Worker stopped.");
}

process.on("SIGINT", () => {
  console.log("\nStopping after the current job...");
  running = false;
});

main();
