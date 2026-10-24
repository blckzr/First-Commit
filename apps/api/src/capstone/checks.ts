import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { GitHubClient } from "../github/index.js";

/**
 * The automatic milestone checks (`project-proposal.md` §6.3, `design.md` §5.14).
 *
 * Three types, and the schema's `check_type` enum is the whole list:
 * `file_exists`, `workflow_test`, `deployment_url`. A milestone is complete
 * only when every one of its checks passes.
 *
 * ### Three outcomes, not two
 *
 * A check is `passed`, `failed`, or **`pending`**. Pending is not a failure and
 * must not read as one: a learner who pushed ten seconds ago has no workflow
 * run yet, and telling them their code is wrong would be false. §5.14 shows
 * "Running checks on commit a1b2c3d…" for exactly this state.
 *
 * ### These are the platform's own results
 *
 * Everything here is computed from what GitHub reports about the learner's
 * repository. Nothing is taken from a browser, and the AI review that follows
 * explains these results rather than producing them (AGENT.md §7).
 */

export type CheckState = "passed" | "failed" | "pending";

export interface CheckResult {
  checkId: string;
  name: string;
  state: CheckState;
  /** One sentence for §5.14's list, in the learner's language (§9). */
  detail: string;
}

export interface MilestoneCheck {
  id: string;
  type: "file_exists" | "workflow_test" | "deployment_url";
  name: string;
  config: Record<string, unknown>;
}

export interface CheckContext {
  installationId: number;
  repoFullName: string;
  /** The commit being checked. */
  sha: string;
  /** `capstone_projects.demo_url`, for the deployment check. */
  demoUrl: string | null;
}

/**
 * Runs every check for one milestone against one commit.
 *
 * The repository tree is fetched **once** and shared by every `file_exists`
 * check, because a milestone can have several and each would otherwise be its
 * own round trip.
 */
export async function runChecks(
  github: GitHubClient,
  checks: MilestoneCheck[],
  context: CheckContext,
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  /** Fetched lazily: a milestone with no file check should not pay for a tree. */
  let files: string[] | null = null;
  let filesFailed = false;

  /** Cached per workflow file, for the same reason. */
  const steps = new Map<string, Awaited<ReturnType<GitHubClient["workflowSteps"]>>>();

  for (const check of checks) {
    if (check.type === "file_exists") {
      const path = String(check.config.path ?? "");

      if (files === null && !filesFailed) {
        try {
          files = await github.listFiles(context.installationId, context.repoFullName, context.sha);
        } catch {
          filesFailed = true;
        }
      }
      if (filesFailed || files === null) {
        results.push(pending(check, "We couldn't read your repository just now."));
        continue;
      }

      const found = files.some((file) => matchesGlob(file, path));
      results.push({
        checkId: check.id,
        name: check.name,
        state: found ? "passed" : "failed",
        detail: found ? `Found ${path}.` : `Nothing in your repository matches ${path}.`,
      });
      continue;
    }

    if (check.type === "workflow_test") {
      const workflow = String(check.config.workflow ?? "");
      const testName = String(check.config.test_name ?? "");

      if (!steps.has(workflow)) {
        try {
          steps.set(
            workflow,
            await github.workflowSteps(
              context.installationId,
              context.repoFullName,
              workflow,
              context.sha,
            ),
          );
        } catch {
          results.push(pending(check, "We couldn't read your test results just now."));
          continue;
        }
      }

      const found = steps.get(workflow)!.find((step) => step.name === testName);

      if (!found) {
        /**
         * No step of that name. Either the run has not started, or the template's
         * tests were renamed — and the platform cannot tell which from here, so
         * it says the neutral true thing rather than blaming the learner for a
         * test it cannot find.
         */
        results.push(pending(check, `Waiting for "${testName}" to run.`));
        continue;
      }

      if (found.conclusion === null) {
        results.push(pending(check, `"${testName}" is still running.`));
        continue;
      }

      const passed = found.conclusion === "success";
      results.push({
        checkId: check.id,
        name: check.name,
        state: passed ? "passed" : "failed",
        detail: passed ? `"${testName}" passed.` : `"${testName}" did not pass.`,
      });
      continue;
    }

    // deployment_url
    if (!context.demoUrl) {
      results.push(pending(check, "Add your live address to finish this milestone."));
      continue;
    }

    const reachable = await isLive(context.demoUrl);
    results.push({
      checkId: check.id,
      name: check.name,
      state: reachable.ok ? "passed" : "failed",
      detail: reachable.detail,
    });
  }

  return results;
}

function pending(check: MilestoneCheck, detail: string): CheckResult {
  return { checkId: check.id, name: check.name, state: "pending", detail };
}

/**
 * Matches a path against a glob.
 *
 * Only what the briefs use: `*` for "anything but a slash" and `**` for
 * "anything". A full glob implementation would be a dependency and a larger
 * surface for no gain — `src/components/TaskForm.*` and
 * `.github/workflows/*.yml` are the shapes that exist.
 */
export function matchesGlob(path: string, pattern: string): boolean {
  if (!pattern) return false;

  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const expression = escaped
    // `**` first, or the single-star rule would eat it.
    .replace(/\*\*/g, "\u0000")
    .replace(/\*/g, "[^/]*")
    .replace(/\u0000/g, ".*");

  return new RegExp(`^${expression}$`).test(path);
}

/**
 * Whether a learner's deployed address answers.
 *
 * ### This is the one check that fetches an address the learner chose
 *
 * Which makes it server-side request forgery unless it is fenced. Without the
 * guard below, a learner could point `demo_url` at `localhost`, at another
 * service inside the host's network, or at a cloud metadata endpoint
 * (`169.254.169.254`, which hands out credentials on some providers) and read
 * the check result as an oracle for what exists there.
 *
 * So: HTTP(S) only, no credentials in the URL, and the resolved address must be
 * a public one. Resolution happens **before** the request and the request goes
 * to the resolved address' hostname — a name that resolves privately is refused
 * outright rather than followed.
 *
 * Redirects are not followed, for the same reason: a public address that
 * redirects to `127.0.0.1` would walk straight past a check done only on the
 * original URL.
 */
export async function isLive(rawUrl: string): Promise<{ ok: boolean; detail: string }> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, detail: "That doesn't look like a web address." };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, detail: "The address needs to start with http:// or https://." };
  }
  if (url.username || url.password) {
    return { ok: false, detail: "Remove the username and password from the address." };
  }

  if (!(await isPublicHost(url.hostname))) {
    return { ok: false, detail: "That address isn't reachable from the internet." };
  }

  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
      headers: { "user-agent": "first-commit-check" },
    });

    // A redirect is a working site, and following it is what the guard above
    // exists to prevent — so it counts without being chased.
    if (response.status >= 200 && response.status < 400) {
      return { ok: true, detail: `Your site answered (${response.status}).` };
    }
    return { ok: false, detail: `Your site answered ${response.status}.` };
  } catch {
    return { ok: false, detail: "Your site didn't answer. Check it is deployed and public." };
  }
}

/** Refuses loopback, private, link-local and unique-local addresses. */
async function isPublicHost(hostname: string): Promise<boolean> {
  const addresses: string[] = [];

  if (isIP(hostname)) {
    addresses.push(hostname);
  } else {
    try {
      const resolved = await lookup(hostname, { all: true });
      addresses.push(...resolved.map((r) => r.address));
    } catch {
      return false;
    }
  }

  // Every resolved address has to be public: one private answer among several
  // is enough to reach something that should not be reachable.
  return addresses.length > 0 && addresses.every(isPublicAddress);
}

export function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const parts = address.split(".").map(Number);
    const [a, b] = parts;
    if (a === 10 || a === 127 || a === 0) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    // Link-local, which includes the cloud metadata address 169.254.169.254.
    if (a === 169 && b === 254) return false;
    // Carrier-grade NAT, and anything from 224 up (multicast, reserved).
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a >= 224) return false;
    return true;
  }

  const lower = address.toLowerCase();
  if (lower === "::1" || lower === "::") return false;
  // Unique-local (fc00::/7) and link-local (fe80::/10).
  if (/^f[cd]/.test(lower)) return false;
  if (/^fe[89ab]/.test(lower)) return false;
  // IPv4-mapped, e.g. ::ffff:127.0.0.1 — judged as the address it wraps.
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPublicAddress(mapped[1]);
  return true;
}
