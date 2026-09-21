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

  /**
   * What this check is actually for.
   *
   * AGENT.md §7: "Every response is JSON-schema constrained **and** re-validated
   * with Zod… Both layers stay — schema mode is unreliable on some Ollama
   * versions, which is exactly what `npm run check` measures."
   *
   * So the question is **whether schema mode is reliable on this machine**, not
   * which mode is quickest. `prompt_only` sends no `format`, so the model is
   * merely asked for JSON and Zod is the only thing standing behind it — one
   * layer, not two. It is the fallback for when schema mode misbehaves, and
   * recommending it over a schema mode that scored identically would trade a
   * correctness layer for a fraction of a second.
   *
   * Order: most valid, then most first-try, then **schema over prompt-only**,
   * then fastest.
   */
  const schemaConstrained = (mode: JsonMode) => (mode === "prompt_only" ? 0 : 1);

  const best = [...results]
    .filter((r) => r.valid > 0)
    .sort(
      (a, b) =>
        b.valid - a.valid ||
        b.firstTry - a.firstTry ||
        schemaConstrained(b.mode) - schemaConstrained(a.mode) ||
        a.avgMs - b.avgMs,
    )[0];

  if (!best) {
    console.error("\n✕ No mode produced valid JSON. Update Ollama, pull the model again, and rerun this check.");
    process.exit(1);
  }

  console.log(`\n✓ Recommended: set AI_JSON_MODE=${best.mode} in your .env file`);

  if (best.mode === "prompt_only") {
    console.log(
      "  Note: no schema mode did better here, so the model is only *asked* for JSON\n" +
        "  and Zod is the sole check. That is the fallback §7 anticipates. Re-run this\n" +
        "  after updating Ollama — schema mode is the second layer and worth having.",
    );
  } else {
    const fastest = [...results].sort((a, b) => a.avgMs - b.avgMs)[0];
    if (fastest.mode === "prompt_only" && fastest.avgMs < best.avgMs) {
      const gap = ((best.avgMs - fastest.avgMs) / 1000).toFixed(1);
      console.log(
        `  prompt_only was ${gap}s faster but sends no schema, leaving Zod as the only\n` +
          "  check. Both layers stay (§7), so the schema mode is recommended.",
      );
    }
  }

  if (best.valid < RUNS) {
    console.log("  Some requests still failed. The worker retries automatically, but consider updating Ollama.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
