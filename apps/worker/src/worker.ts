/**
 * Local AI worker. Claims jobs from Supabase one at a time, runs them on Ollama,
 * and writes results back.
 *
 *   npm run worker
 */
import { createClient } from "@supabase/supabase-js";
import { supabaseConfig, config } from "./config.js";
import { chatJson } from "./ollama.js";
import { buildCodeFeedbackMessages, type CodeFeedbackInput } from "./prompts/code-feedback.js";
import { CodeFeedback, noSolutionLeak } from "./schemas.js";

const sb = supabaseConfig();
const supabase = createClient(sb.url, sb.serviceRoleKey, { auth: { persistSession: false } });

interface AiJob {
  id: string;
  type: string;
  user_id: string | null;
  source_id: string | null;
  payload: unknown;
  attempts: number;
}

type Handler = (job: AiJob) => Promise<{ result: unknown; output?: unknown }>;

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
  // Add roadmap_generation, milestone_review, resume_generation, etc. as you build them.
};

const MAX_JOB_ATTEMPTS = 3;
let running = true;

async function processOne(): Promise<boolean> {
  const { data, error } = await supabase.rpc("claim_next_ai_job");
  if (error) throw new Error(`claim_next_ai_job failed: ${error.message}`);
  const job = (data as AiJob[] | null)?.[0];
  if (!job) return false;

  const started = Date.now();
  console.log(`→ ${job.type} ${job.id} (attempt ${job.attempts})`);

  try {
    const handler = handlers[job.type];
    if (!handler) throw new Error(`No handler for job type ${job.type}`);
    const { result, output } = await handler(job);

    if (output !== undefined && job.user_id && job.source_id) {
      const { error: outErr } = await supabase.from("ai_outputs").insert({
        job_id: job.id,
        user_id: job.user_id,
        source_type: job.type,
        source_id: job.source_id,
        content: output,
      });
      if (outErr) throw new Error(`Saving output failed: ${outErr.message}`);
    }

    await supabase
      .from("ai_jobs")
      .update({ status: "completed", result, model: config.model, completed_at: new Date().toISOString() })
      .eq("id", job.id);
    console.log(`✓ ${job.type} ${job.id} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  } catch (err) {
    const message = (err as Error).message;
    const retry = job.attempts < MAX_JOB_ATTEMPTS;
    await supabase
      .from("ai_jobs")
      .update({ status: retry ? "queued" : "failed", error: message, model: config.model })
      .eq("id", job.id);
    console.error(`✕ ${job.type} ${job.id}: ${message}${retry ? " (will retry)" : ""}`);
  }
  return true;
}

async function main() {
  console.log(`First Commit AI worker started. Model ${config.model}, mode ${config.jsonMode}.`);
  while (running) {
    try {
      const didWork = await processOne();
      if (!didWork) await new Promise((r) => setTimeout(r, sb.pollMs));
    } catch (err) {
      console.error((err as Error).message);
      await new Promise((r) => setTimeout(r, sb.pollMs * 3));
    }
  }
  console.log("Worker stopped.");
}

process.on("SIGINT", () => {
  console.log("\nStopping after the current job...");
  running = false;
});

main();
