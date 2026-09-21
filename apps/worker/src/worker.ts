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
let running = true;

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
    await pool.query(
      `update ai_jobs set status = $1, error = $2, model = $3 where id = $4`,
      [retry ? "queued" : "failed", message, config.model, job.id],
    );
    console.error(`✕ ${job.type} ${job.id}: ${message}${retry ? " (will retry)" : ""}`);
  }
  return true;
}

async function main() {
  console.log(`First Commit AI worker started. Model ${config.model}, mode ${config.jsonMode}.`);
  await registerPrompts();
  if (!db.apiUrl || !db.workerSecret) {
    console.log("API_URL or WORKER_SECRET unset: results are written but not announced.");
  }

  while (running) {
    try {
      const didWork = await processOne();
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
