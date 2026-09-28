import { z } from "zod";

/** Feedback on a coding exercise. Shown in the exercise screen's AI panel. */
export const CodeFeedback = z.object({
  summary: z.string().describe("One or two sentences on what works and what doesn't"),
  issues: z
    .array(
      z.object({
        line: z.number().int().nullable().describe("Line number the learner should look at, or null"),
        problem: z.string().describe("What is wrong, in beginner-friendly words"),
        hint: z.string().describe("A question or nudge toward the fix. Never the corrected code."),
      }),
    )
    .max(3),
  rubric: z.array(
    z.object({
      criterion: z.string(),
      met: z.boolean(),
      note: z.string(),
    }),
  ),
  encouragement: z.string().describe("One short, specific, honest sentence"),
});
export type CodeFeedback = z.infer<typeof CodeFeedback>;

/**
 * Roadmap plan.
 *
 * Zod only proves the shape. Everything that makes a roadmap *correct* — real
 * module ids, prerequisite order, full core coverage — is checked afterwards by
 * `roadmap/validate.ts` against the catalogue read from the database, and
 * invalid output is fed back and regenerated (AGENT.md §7).
 *
 * **`weeklySchedule` was removed.** An earlier draft asked the model for a
 * week-by-week plan, but nothing stores one and design.md §5.5 shows a figure
 * the platform can compute exactly — "16 modules, about 14 weeks at 6 hours a
 * week" is `sum(estimated_hours) / weekly_hours`. Asking a model to do
 * arithmetic the platform already has is the thing §7 exists to prevent, and it
 * costs tokens on an 8GB budget.
 */
/**
 * What the **model** returns: modules by slug, the track by title.
 *
 * It used to answer in UUIDs, because that is what the catalogue stores. Three
 * evaluation runs found that every single rejected attempt was a miscopied id —
 * not one prerequisite violation, not one core-coverage miss — including a
 * splice of two different UUIDs and a well-formed id belonging to nothing. A 4B
 * model asked to reproduce a 36-character hex string a dozen-plus times per
 * answer will eventually get one wrong, and there is no reason to ask it to:
 * `modules.slug` is unique, short, and meaningful, and a track's title is unique
 * within its career path.
 *
 * `resolvePlan()` in `roadmap/resolve.ts` turns this into `RoadmapPlan` before
 * anything is validated or written, so ids never leave the server.
 */
export const RoadmapPlanDraft = z.object({
  recommendedTrack: z.string().describe("The title of one published track, exactly as listed"),
  skipModuleSlugs: z
    .array(z.string())
    .describe("Modules the placement result proves the learner already knows"),
  orderedModuleSlugs: z
    .array(z.string())
    .describe("Every module the learner will take, in the order to take them, by slug"),
  explanation: z.string().describe("Two or three sentences shown on the roadmap review page"),
});
export type RoadmapPlanDraft = z.infer<typeof RoadmapPlanDraft>;

/** The same plan in the platform's own terms, after slugs are resolved to ids. */
export const RoadmapPlan = z.object({
  recommendedTrackId: z.string().describe("The id of one published track"),
  skipModuleIds: z
    .array(z.string())
    .describe("Modules the placement result proves the learner already knows"),
  orderedModuleIds: z
    .array(z.string())
    .describe("Every module the learner will take, in the order to take them"),
  explanation: z.string().describe("Two or three sentences shown on the roadmap review page"),
});
export type RoadmapPlan = z.infer<typeof RoadmapPlan>;

/** Resume text. Skills are checked against verified evidence after parsing. */
export const ResumeContent = z.object({
  summary: z.string(),
  skills: z.array(z.string()),
  projects: z.array(z.object({ projectId: z.string(), description: z.string() })),
});
export type ResumeContent = z.infer<typeof ResumeContent>;

/**
 * Whether a hint hands over a fragment of the fix rather than pointing at the
 * problem.
 *
 * **Naming a thing is allowed; spelling the answer is not.** "Use the
 * `minLength` variable" and "try an `if` statement" point somewhere, which is
 * what §7 asks a hint to do. A backticked span holding an operator, a call or an
 * assignment — `>=`, `count++`, `sentence.split(" ")` — is the answer written
 * out, and there is nothing left for the learner to work out.
 *
 * Exported so the evaluation harness can check accepted answers with the same
 * rule the guard applies, rather than keeping a second copy that could drift.
 */
export function givesCode(hint: string): boolean {
  const spans = hint.match(/`[^`]+`/g) ?? [];
  return spans.some((span) => /[=<>(){};]|\+\+|--/.test(span.slice(1, -1)));
}

/**
 * Rejects feedback that hands the learner a solution (§7: "never the corrected
 * code").
 *
 * **This used to miss the common case.** It rejected a hint only for a fenced
 * block or *more than one* line containing code punctuation, so every
 * single-line fix passed — "change the comparison operator from `>` to `>=` on
 * line 5" reached the learner untouched. The first evaluation run shipped ten
 * such hints across eight of seventeen answers while §9.1's leakage metric read
 * 0%, because the metric counted this function's rejections rather than what the
 * model actually wrote.
 *
 * The inline check costs retries, and it will also reject a fair question that
 * quotes the operator — "is `>=` what you want here?". That is the accepted
 * trade, decided rather than stumbled into: §7's rule is the stricter reading,
 * and the same question can always be asked in words.
 */
export function noSolutionLeak(feedback: CodeFeedback): string | null {
  for (const issue of feedback.issues) {
    const codeLines = issue.hint.split("\n").filter((l) => /[;{}()=]/.test(l)).length;
    if (/```/.test(issue.hint) || codeLines > 1 || givesCode(issue.hint)) {
      return (
        "A hint contains code. Hints must guide the learner with words or a question, " +
        "not give code — describe the change to make instead of writing it out."
      );
    }
  }
  return null;
}
