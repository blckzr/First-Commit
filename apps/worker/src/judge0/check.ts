import { config } from "../config.js";
import { Judge0Runner } from "./index.js";
import { buildHarness } from "./harness.js";

/**
 * `npm run judge0:check` — proves the sandbox works before a learner needs it.
 *
 * The same idea as `npm run check` for Ollama: the setup guide says what should
 * be true, and this says what *is* true on this machine. Judge0's language ids
 * move between releases and its cgroup requirement is the fiddly part of a
 * Windows install, so both are verified here rather than assumed.
 *
 * It ends with a **real submission of the seeded exercise's starter code**,
 * which carries §5.11's deliberate bug. So the expected outcome is not "all
 * green" — it is four passes and one failure, with "Expected 2, got 0" on the
 * case the bug breaks. Anything else means the harness, not the learner.
 */

const ok = (s: string) => `  \x1b[32m✓\x1b[0m ${s}`;
const bad = (s: string) => `  \x1b[31m✗\x1b[0m ${s}`;
const note = (s: string) => `    \x1b[2m${s}\x1b[0m`;

/** The seeded starter, bug and all — see `supabase/seed/exercises.mjs`. */
const STARTER = `function sumEven(numbers) {
  let total = 0;
  for (let i = 1; i < numbers.length; i++) {
    if (numbers[i] % 2 === 0) {
      total += numbers[i];
    }
  }
  return total;
}

module.exports = { sumEven };
`;

const CASES = [
  { id: "c1", name: "Sums [2, 4, 6] to 12", code: "expect(sumEven([2, 4, 6])).toBe(12);", visible: true },
  { id: "c2", name: "Ignores odd numbers", code: "expect(sumEven([1, 2, 3, 4])).toBe(6);", visible: true },
  { id: "c3", name: "Includes the first item", code: "expect(sumEven([2, 1])).toBe(2);", visible: true },
  { id: "c4", name: "Totals an empty array to zero", code: "expect(sumEven([])).toBe(0);", visible: true },
  { id: "c5", name: "Works on a longer list", code: "expect(sumEven([5, 8, 13, 21, 34, 2])).toBe(44);", visible: false },
];

async function main(): Promise<void> {
  const url = config.judge0Url;
  console.log(`\nJudge0 at ${url}\n`);

  let failures = 0;
  const fail = (message: string, hint?: string) => {
    console.log(bad(message));
    if (hint) console.log(note(hint));
    failures++;
  };

  // ---- 1. Is anything there? -----------------------------------------------
  let about: unknown;
  try {
    const res = await fetch(`${url}/about`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`answered ${res.status}`);
    about = await res.json();
    const version = (about as { version?: string }).version ?? "unknown";
    console.log(ok(`reachable — version ${version}`));
    if (version.startsWith("1.13.0")) {
      console.log(
        note("1.13.0 has three known CVEs. Use the v1.13.1 release zip instead."),
      );
    }
  } catch (err) {
    fail(
      `not reachable — ${(err as Error).message}`,
      "Is the stack up? `docker compose ps` in your judge0-v1.13.1 folder.",
    );
    console.log(`\n${failures} problem(s). Nothing else can be checked until it answers.\n`);
    process.exit(1);
  }

  // ---- 2. Which runtimes does it actually offer? ---------------------------
  try {
    const res = await fetch(`${url}/languages`, { signal: AbortSignal.timeout(10_000) });
    const languages = (await res.json()) as { id: number; name: string }[];
    const js = languages.filter((l) => l.name.toLowerCase().startsWith("javascript"));
    const py = languages.filter((l) => l.name.toLowerCase().startsWith("python"));

    if (js.length === 0) fail("no JavaScript runtime");
    else console.log(ok(`JavaScript — ${js.map((l) => `${l.name} (id ${l.id})`).join(", ")}`));

    if (py.length === 0) {
      console.log(note("no Python runtime — the seeded Django module will need one later"));
    } else {
      console.log(ok(`Python — ${py.map((l) => `${l.name} (id ${l.id})`).join(", ")}`));
    }
  } catch (err) {
    fail(`could not list languages — ${(err as Error).message}`);
  }

  // ---- 3. Does isolate actually work? -------------------------------------
  /**
   * The cgroup check, and the reason this script exists. Judge0 needs cgroup v1;
   * a WSL2 kernel defaults to v2, and the symptom is not a clear error — it is
   * every submission coming back as an internal error. So the smallest possible
   * program is run before anything real depends on it.
   */
  try {
    const res = await fetch(`${url}/submissions?base64_encoded=false&wait=true`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source_code: 'console.log("judge0 ok");',
        language_id: await javascriptId(url),
        cpu_time_limit: 5,
      }),
      signal: AbortSignal.timeout(60_000),
    });
    const body = (await res.json()) as {
      stdout: string | null;
      status: { id: number; description: string };
      message: string | null;
    };

    if (body.status.id === 3 && (body.stdout ?? "").includes("judge0 ok")) {
      console.log(ok("ran a program and got its output back"));
    } else {
      fail(
        `a trivial program did not run — ${body.status.description}${
          body.message ? ` (${body.message})` : ""
        }`,
        "Almost always cgroups. On Windows, put this in %UserProfile%\\.wslconfig:\n" +
          "      [wsl2]\n" +
          "      kernelCommandLine = systemd.unified_cgroup_hierarchy=0\n" +
          "    then `wsl --shutdown` and start Docker Desktop again.",
      );
    }
  } catch (err) {
    fail(`could not submit — ${(err as Error).message}`);
  }

  // ---- 4. The whole path, on real content ---------------------------------
  if (failures === 0) {
    const runner = new Judge0Runner({
      url,
      token: config.judge0Token,
      cpuTimeLimitSeconds: config.judge0CpuSeconds,
      memoryLimitKb: config.judge0MemoryKb,
    });

    const result = await runner.run({ runtime: "javascript", files: [{ path: "script.js", content: STARTER }], cases: CASES });

    console.log("\n  The seeded exercise, with its starter code:");
    for (const outcome of result.outcomes) {
      const mark = outcome.passed ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";
      const detail =
        outcome.expected !== undefined
          ? ` — expected ${outcome.expected}, got ${outcome.actual}`
          : "";
      console.log(`    ${mark} ${outcome.name}${detail}`);
    }
    if (result.error) console.log(note(`error: ${result.error}`));

    const passed = result.outcomes.filter((o) => o.passed).length;
    /**
     * 4 of 5. The starter's loop starts at index 1, so "Includes the first
     * item" must fail and the rest must pass. All five passing would mean the
     * harness is not running the assertions.
     */
    if (passed === 4 && !result.outcomes[2].passed) {
      console.log(ok("\n  4 of 5, failing on the starter's deliberate bug — exactly right"));
    } else {
      fail(
        `\n  expected 4 of 5 with "Includes the first item" failing, got ${passed} of 5`,
        "The harness is not reporting what the assertions actually did.",
      );
    }
  }

  // ---- 5. What to write in .env -------------------------------------------
  console.log(
    failures === 0
      ? `\n\x1b[32mReady.\x1b[0m Set CODE_RUNNER=judge0 in apps/worker/.env and restart the worker.\n`
      : `\n${failures} problem(s). Leave CODE_RUNNER=none until they are fixed — ` +
          `a half-working sandbox is worse than an honest refusal.\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

async function javascriptId(url: string): Promise<number> {
  const res = await fetch(`${url}/languages`, { signal: AbortSignal.timeout(10_000) });
  const languages = (await res.json()) as { id: number; name: string }[];
  const js = languages
    .filter((l) => l.name.toLowerCase().startsWith("javascript"))
    .sort((a, b) => b.id - a.id);
  if (js.length === 0) throw new Error("no JavaScript runtime to test with");
  return js[0].id;
}

/** Printed so a reader can see the harness without running anything. */
if (process.argv.includes("source")) {
  console.log(
    buildHarness({
      runtime: "javascript",
      files: [{ path: "script.js", content: STARTER }],
      cases: CASES,
    }).source,
  );
} else {
  main().catch((err) => {
    console.error(`\n${(err as Error).message}\n`);
    process.exit(1);
  });
}
