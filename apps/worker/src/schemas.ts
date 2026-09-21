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

/** Rejects feedback that hands the learner a solution. */
export function noSolutionLeak(feedback: CodeFeedback): string | null {
  for (const issue of feedback.issues) {
    const codeLines = issue.hint.split("\n").filter((l) => /[;{}()=]/.test(l)).length;
    if (/```/.test(issue.hint) || codeLines > 1) {
      return "A hint contains code. Hints must guide the learner with words or a question, not give code.";
    }
  }
  return null;
}
