import type { ChatMessage } from "../ollama.js";

export interface TestResult {
  name: string;
  passed: boolean;
  expected?: string;
  actual?: string;
}

export interface CodeFeedbackInput {
  exerciseTitle: string;
  instructions: string;
  language: string;
  files: { path: string; content: string }[];
  testResults: TestResult[];
  lintResults: string[];
  rubric: { name: string; description: string }[];
}

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
