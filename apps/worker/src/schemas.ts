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

/** Roadmap plan. Module IDs must exist; the worker checks prerequisites after parsing. */
export const RoadmapPlan = z.object({
  skipModuleIds: z.array(z.string()).describe("Core modules the learner proved in placement"),
  recommendedTrackId: z.string(),
  orderedModuleIds: z.array(z.string()),
  weeklySchedule: z.array(z.object({ week: z.number().int().min(1), moduleIds: z.array(z.string()) })),
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
