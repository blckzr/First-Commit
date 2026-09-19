/**
 * Checks that Ollama is running, the model is installed, and finds which
 * structured-output mode returns valid JSON reliably on your Ollama version.
 *
 *   npm run check
 *   npm run check -- qwen3.5:9b
 */
import { z } from "zod";
import { config, type JsonMode } from "./config.js";
import { chatJson, listModels } from "./ollama.js";

const model = process.argv[2] ?? config.model;
const RUNS = 5;

const TestSchema = z.object({
  language: z.string(),
  isCompiled: z.boolean(),
  beginnerFriendly: z.number().int().min(1).max(5),
  reasons: z.array(z.string()).min(1).max(3),
});

const messages = [
  { role: "user" as const, content: "Describe the Python programming language for a beginner." },
];

async function main() {
  console.log(`\nFirst Commit AI setup check`);
  console.log(`Ollama: ${config.ollamaUrl}\nModel:  ${model}\n`);

  let models: string[];
  try {
    models = await listModels();
  } catch {
    console.error("✕ Cannot reach Ollama. Is it running? Try opening the Ollama app or running `ollama serve`.");
    process.exit(1);
  }
  console.log("✓ Ollama is running");

  if (!models.includes(model)) {
    console.error(`✕ ${model} is not installed. Run: ollama pull ${model}`);
    console.error(`  Installed: ${models.join(", ") || "(none)"}`);
    process.exit(1);
  }
  console.log(`✓ ${model} is installed`);

  console.log("\nLoading the model (the first request can take a while)...");
  await chatJson({ schema: TestSchema, messages, model, mode: "prompt_only", maxAttempts: 3 }).catch(() => undefined);

  const modes: JsonMode[] = ["think_off_schema", "think_on_schema", "prompt_only"];
  const results: { mode: JsonMode; valid: number; firstTry: number; avgMs: number }[] = [];

  for (const mode of modes) {
    let valid = 0;
    let firstTry = 0;
    let totalMs = 0;
    for (let i = 0; i < RUNS; i++) {
      try {
        const r = await chatJson({ schema: TestSchema, messages, model, mode, maxAttempts: 2 });
        valid++;
        if (r.attempts === 1) firstTry++;
        totalMs += r.durationMs;
      } catch {
        // Counted as invalid.
      }
      process.stdout.write(".");
    }
    results.push({ mode, valid, firstTry, avgMs: valid ? Math.round(totalMs / valid) : 0 });
    console.log(` ${mode}`);
  }

  console.log("\nMode               Valid  First try  Avg time");
  for (const r of results) {
    console.log(
      `${r.mode.padEnd(18)} ${`${r.valid}/${RUNS}`.padEnd(6)} ${`${r.firstTry}/${RUNS}`.padEnd(10)} ${r.avgMs ? `${(r.avgMs / 1000).toFixed(1)}s` : "-"}`,
    );
  }

  // Prefer the mode with the most valid results, then most first-try successes, then fastest.
  const best = [...results]
    .filter((r) => r.valid > 0)
    .sort((a, b) => b.valid - a.valid || b.firstTry - a.firstTry || a.avgMs - b.avgMs)[0];

  if (!best) {
    console.error("\n✕ No mode produced valid JSON. Update Ollama, pull the model again, and rerun this check.");
    process.exit(1);
  }
  console.log(`\n✓ Recommended: set AI_JSON_MODE=${best.mode} in your .env file`);
  if (best.valid < RUNS) {
    console.log("  Some requests still failed. The worker retries automatically, but consider updating Ollama.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
