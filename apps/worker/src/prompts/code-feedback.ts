import { z } from "zod";
import type { ChatMessage } from "../ollama.js";

export interface TestResult {
  name: string;
  passed: boolean;
  expected?: string;
  actual?: string;
}

/**
 * What a `code_feedback` job carries.
 *
 * **A Zod schema, not just an interface.** The handler used to cast
 * `job.payload as CodeFeedbackInput`, and when `submissions.ts` queued a
 * different shape the failure was `Cannot read properties of undefined (reading
 * 'map')`, three times, across two retries. §8's rule — validate at the
 * boundary, not just at the type level — applies to a job payload as much as to
 * an HTTP response: it crossed a process and a database on the way here.
 */
export const CodeFeedbackInput = z.object({
  exerciseTitle: z.string(),
  instructions: z.string(),
  /** `assessments.runtime` — `javascript`, `python`, `react`, `vue`. */
  language: z.string(),
  files: z.array(z.object({ path: z.string(), content: z.string() })).min(1),
  /**
   * Every case, passes included: the prompt shows the whole picture so the model
   * can tell a learner what already works. Already redacted — a hidden case
   * arrives as a name and an outcome, so the model cannot repeat a value the
   * learner is not allowed to see.
   */
  testResults: z.array(
    z.object({
      name: z.string(),
      passed: z.boolean(),
      expected: z.string().optional(),
      actual: z.string().optional(),
    }),
  ),
  /** Nothing lints yet. §5's flow names a linter; it is not built. */
  lintResults: z.array(z.string()),
  rubric: z.array(z.object({ name: z.string(), description: z.string() })),
});
export type CodeFeedbackInput = z.infer<typeof CodeFeedbackInput>;

const SYSTEM = `You are a patient code reviewer for First Commit, a platform for beginner programmers.

Rules:
- The test results are the source of truth. Never claim code works or fails if the tests say otherwise.
- Explain problems in simple words a beginner understands.
- Give hints as questions or nudges. Never write the corrected code or a full solution.
- Point to a line number when it helps.
- Mention at most 3 issues, most important first.
- Judge each rubric criterion honestly.
- Keep encouragement short, specific, and true. No exaggerated praise.`;

function numbered(content: string): string {
  return content
    .split("\n")
    .map((line, i) => `${String(i + 1).padStart(3)} | ${line}`)
    .join("\n");
}

export function buildCodeFeedbackMessages(input: CodeFeedbackInput): ChatMessage[] {
  const files = input.files.map((f) => `File: ${f.path}\n${numbered(f.content)}`).join("\n\n");
  const tests = input.testResults
    .map((t) =>
      t.passed
        ? `PASS ${t.name}`
        : `FAIL ${t.name}${t.expected !== undefined ? ` (expected ${t.expected}, got ${t.actual})` : ""}`,
    )
    .join("\n");
  const rubric = input.rubric.map((r) => `- ${r.name}: ${r.description}`).join("\n");
  const lint = input.lintResults.length ? input.lintResults.join("\n") : "No linter issues.";

  return [
    { role: "system", content: SYSTEM },
    {
      role: "user",
      content: `Exercise: ${input.exerciseTitle}
Language: ${input.language}

Instructions:
${input.instructions}

Learner's code:
${files}

Test results:
${tests}

Linter:
${lint}

Rubric:
${rubric}`,
    },
  ];
}
