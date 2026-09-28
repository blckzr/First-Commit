import type { Recorder } from "./report.js";
import { hintGivesCode } from "./code-feedback.js";

/**
 * The scoring sheet: everything §9.1 marks "rated by evaluators".
 *
 * Bug detection, false alarms, explanation clarity, track appropriateness,
 * writing quality and the ATS parse check are judgments, and the harness does
 * not pretend to make them. It lays the evidence out — the known bug beside the
 * model's feedback, the learner's profile beside the recommended track, the
 * verified skills beside the resume — with empty columns to fill in.
 *
 * **Deliberately not keyword-scored.** "Off-by-one" and "starts counting from
 * the second item" are the same finding; a matcher would call one a hit and the
 * other a miss, and the resulting percentage would look like a measurement.
 *
 * Filled in, this file is the evaluation's raw data. It is written next to the
 * run's `cases.jsonl`, so a score always sits with the outputs it scored and
 * the model and prompt version that produced them.
 */

export function scoringSheet(recorder: Recorder): string {
  const lines = [
    `# Scoring sheet — ${recorder.model}`,
    "",
    "Fill in the blank columns. Everything here is an evaluator judgment;",
    "the counted metrics are in `summary.md`.",
    "",
    "Scales: **Found** yes/no · **False alarm** yes/no · **Clarity** 1–5",
    "(1 = a beginner would be more confused after reading it, 5 = they would know",
    "what to try next) · **Appropriate** yes/no · **Quality** 1–5.",
    "",
  ];

  // ------------------------------------------------------ Code Review AI
  const feedback = recorder.of("code_feedback").filter((c) => c.ok && c.scoring);
  lines.push(
    "## Code Review AI",
    "",
    "For each submission: was the documented bug identified? Did the feedback",
    "report a problem that does not exist? How clear is it to a beginner?",
    "",
  );
  for (const c of feedback) {
    const s = c.scoring as Record<string, unknown>;
    const fb = s.feedback as {
      summary?: string;
      issues?: { problem: string; hint: string; line: number | null }[];
    };
    lines.push(
      `### \`${c.caseId}\``,
      "",
      `**The bug:** ${String(s.knownBug)}`,
      "",
      `**Tests that failed:** ${(s.failingTests as string[]).join(", ")}`,
      "",
      `**Summary the learner sees:** ${fb.summary ?? "—"}`,
      "",
      "**Issues raised:**",
      "",
    );
    for (const issue of fb.issues ?? []) {
      const where = issue.line === null ? "" : ` *(line ${issue.line})*`;
      // Flagged, not judged. §7 forbids handing over the fix, and `noSolutionLeak`
      // only catches multi-line code — so a single-line fix reaches the learner
      // and has to be confirmed by a person rather than counted automatically.
      const leak = hintGivesCode(issue.hint) ? " **← gives code?**" : "";
      lines.push(`- **${issue.problem}**${where}`, `  - Hint: ${issue.hint}${leak}`);
    }
    lines.push(
      "",
      "| Found the bug? | False alarm? | Clarity 1–5 | Notes |",
      "|---|---|---|---|",
      "|  |  |  |  |",
      "",
    );
  }

  // --------------------------------------------------------- Roadmap AI
  const roadmap = recorder.of("roadmap_generation").filter((c) => c.ok && c.scoring);
  lines.push(
    "## Roadmap AI",
    "",
    "Does the recommended track suit the learner, and does the explanation engage",
    "with what they actually said they wanted?",
    "",
  );
  for (const c of roadmap) {
    const s = c.scoring as Record<string, unknown>;
    lines.push(
      `### \`${c.caseId}\``,
      "",
      `**Profile:** ${String(s.expectation)}`,
      "",
      `**Recommended track:** ${String(s.trackTitle)} · ${String(c.metrics?.moduleCount)} modules · already passed ${String(c.metrics?.completedBefore)}`,
      "",
      `**Explanation:** ${String(s.explanation)}`,
      "",
      "| Track appropriate? | Explanation engages the goal? | Notes |",
      "|---|---|---|",
      "|  |  |  |",
      "",
    );
  }

  // ---------------------------------------------------------- Resume AI
  const resume = recorder.of("resume_generation").filter((c) => c.ok && c.scoring);
  lines.push(
    "## Resume AI",
    "",
    "Read every sentence against the verified list. A claim the grounding did not",
    "catch is the most serious result this evaluation can produce — it is the one",
    "component whose output a stranger reads.",
    "",
  );
  for (const c of resume) {
    const s = c.scoring as Record<string, unknown>;
    const out = s.resume as { summary?: string; skills?: string[] };
    const removed = (s.removedSkills as string[]) ?? [];
    lines.push(
      `### \`${c.caseId}\``,
      "",
      `**Target job:** ${String(s.targetTitle)}`,
      "",
      `**Verified evidence:** ${(s.verifiedSkills as string[]).join(", ") || "*nothing*"}`,
      "",
      `**Summary:** ${out.summary ?? "—"}`,
      "",
      `**Skills printed:** ${(out.skills ?? []).join(", ") || "*none*"}`,
      "",
      removed.length > 0
        ? `**Removed as unsupported:** ${removed.join(", ")} — the model claimed these and the grounding deleted them.`
        : "**Removed as unsupported:** none — every skill the model named was verified.",
      "",
      `**What to check:** ${String(s.expectation)}`,
      "",
      "| Any unsupported claim left? | Reads as experience? | Quality 1–5 | ATS parse | Notes |",
      "|---|---|---|---|---|",
      "|  |  |  |  |  |",
      "",
    );
  }

  return lines.join("\n");
}
