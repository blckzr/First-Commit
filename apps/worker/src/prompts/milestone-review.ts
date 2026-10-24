import { z } from "zod";
import type { ChatMessage } from "../ollama.js";

/**
 * The Code Review AI's second half: a capstone milestone review
 * (`design.md` §5.14, `project-proposal.md` §6.3).
 *
 * **Bump `PROMPT_VERSION` when `SYSTEM` changes.** `registerPrompts()` refuses
 * to start if the database holds different text for the same number.
 *
 * ### The diff arrives in the payload
 *
 * The worker has no GitHub credentials — the App's private key lives only in
 * the API — so the API fetches the diff and puts it in the job, exactly as it
 * puts files and test results into a `code_feedback` job. That also keeps the
 * §7 ordering intact: the checks have already run and their results travel
 * alongside, so the model is handed conclusions rather than asked for them.
 *
 * ### The diff only, and split if it is long
 *
 * AGENT.md's hardware budget is explicit: "Milestone reviews look at **the diff
 * only**, split by file if too large." 8GB of VRAM and a 16,384 context do not
 * stretch to a repository. `trimDiff()` below enforces that rather than trusting
 * the caller, because a single large file would otherwise push the checks and
 * the checklist out of the window and the review would be about nothing.
 */

export const PROMPT_VERSION = 1;

export const SYSTEM = `You review one milestone of a beginner's capstone project for First Commit.

You are given the milestone's acceptance criteria, a review checklist, the results of automatic checks that have ALREADY RUN, and the diff of the learner's latest push.

Rules:
- The check results are the source of truth. Never say a check passed or failed differently from what you are given.
- You do not decide whether the milestone is complete. That is already decided by the checks.
- Judge each review checklist item from the diff, and say what in the diff made you think so.
- If a check did not pass, say what works and what still needs doing. Never say the milestone is finished.
- A check that is still running is not a failure. Say it is still running.
- The next step names ONE thing to look at. Never write the corrected code, and never quote the operator, call or assignment to use — naming a file or a function is fine.
- Speak to the learner as "you". Plain, specific, no cheerleading.
- Judge only what is in the diff. If the diff does not show something a criterion needs, say you cannot see it rather than assuming.

Return JSON only.`;

/**
 * What a `milestone_review` job carries.
 *
 * **A Zod schema, not an interface.** The payload crosses a process and a
 * database, which makes it a boundary (§8) — and `code_feedback` cost three
 * silent retries and an error naming neither the field nor the producer by
 * being cast instead.
 */
export const MilestoneReviewInput = z.object({
  milestoneTitle: z.string(),
  /** What §5.14 shows the learner. */
  acceptanceCriteria: z.array(z.string()),
  /**
   * The brief's `review_checklist` — admin-side (§6 rule 2), and the only part
   * the model is asked to assess.
   */
  reviewChecklist: z.array(z.string()),
  /** Already computed. `pending` means still running, not failed. */
  checks: z.array(
    z.object({
      name: z.string(),
      state: z.enum(["passed", "failed", "pending"]),
      detail: z.string(),
    }),
  ),
  commitSha: z.string(),
  /** One entry per changed file, newest push only. */
  files: z.array(
    z.object({
      path: z.string(),
      /** A unified diff hunk. Already trimmed by the producer; trimmed again here. */
      patch: z.string(),
    }),
  ),
});
export type MilestoneReviewInput = z.infer<typeof MilestoneReviewInput>;

/** Roughly four characters to a token — enough to budget by, not to bill by. */
const CHARS_PER_TOKEN = 4;

/**
 * Keeps the diff inside the context, newest-looking files first.
 *
 * **Per file, then overall.** A single generated lockfile can be longer than
 * the whole budget, so each file is capped before the total is — otherwise one
 * file would consume the window and the checks, the checklist and the criteria
 * would fall out of the prompt entirely, which is exactly the failure that
 * makes a review sound confident about nothing.
 *
 * Truncation is **announced in the text** rather than silent, so the model is
 * told it is seeing part of a file and can say so instead of concluding the
 * rest is missing.
 */
export function trimDiff(
  files: MilestoneReviewInput["files"],
  budgetTokens = 8000,
): { files: MilestoneReviewInput["files"]; omitted: number } {
  const perFile = Math.floor((budgetTokens * CHARS_PER_TOKEN) / 4);
  let remaining = budgetTokens * CHARS_PER_TOKEN;
  const kept: MilestoneReviewInput["files"] = [];

  /**
   * Generated files are skipped outright: a lockfile diff is thousands of lines
   * that say nothing about whether the learner built the form.
   */
  const interesting = files.filter((file) => !GENERATED.test(file.path));

  for (const file of interesting) {
    if (remaining <= 0) break;

    let patch = file.patch;
    if (patch.length > perFile) {
      patch = `${patch.slice(0, perFile)}\n… (this file's diff is longer; showing the first part)`;
    }
    if (patch.length > remaining) {
      patch = `${patch.slice(0, remaining)}\n… (truncated to fit)`;
    }

    kept.push({ path: file.path, patch });
    remaining -= patch.length;
  }

  return { files: kept, omitted: files.length - kept.length };
}

const GENERATED =
  /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|dist\/|build\/|node_modules\/|\.min\.(js|css)$)/;

export function buildMilestoneReviewMessages(input: MilestoneReviewInput): ChatMessage[] {
  const { files, omitted } = trimDiff(input.files);

  const checks = input.checks.length
    ? input.checks
        .map((check) => `- [${label(check.state)}] ${check.name} — ${check.detail}`)
        .join("\n")
    : "No checks have reported yet.";

  const diff = files.length
    ? files.map((file) => `--- ${file.path}\n${file.patch}`).join("\n\n")
    : "The push changed no files this review can read.";

  return [
    { role: "system", content: SYSTEM },
    {
      role: "user",
      content: `Milestone: ${input.milestoneTitle}
Commit: ${input.commitSha}

Acceptance criteria (what the learner was asked for):
${bullets(input.acceptanceCriteria)}

Review checklist (judge each of these from the diff):
${bullets(input.reviewChecklist)}

Automatic check results (already decided — do not contradict these):
${checks}

Diff of the latest push:
${diff}
${omitted > 0 ? `\n(${omitted} file${omitted === 1 ? "" : "s"} left out: generated or too long to include.)` : ""}

Write the summary, judge each checklist item, and name one next step.`,
    },
  ];
}

const label = (state: string) =>
  state === "passed" ? "PASSED" : state === "failed" ? "DID NOT PASS" : "STILL RUNNING";

const bullets = (lines: string[]) =>
  lines.length ? lines.map((line) => `- ${line}`).join("\n") : "- (none given)";
