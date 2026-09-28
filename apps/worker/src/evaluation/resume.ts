import type { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { runResumeGeneration } from "../resume/index.js";
import { ChatJsonError } from "../ollama.js";
import { resumes, type ResumeFixture } from "./fixtures/resumes.js";
import { rate, ms, type CaseRecord, type Recorder } from "./report.js";

/**
 * Resume AI evaluation (`project-proposal.md` §9.1).
 *
 * **The component with the most to lose and the least evidence.** Its two
 * grounding mechanisms are unit-tested against fabricated model output; until
 * this ran, neither had ever been shown to fire on something the model actually
 * wrote.
 *
 * ### Both sides of the grounding are recorded
 *
 * Driving the real handler and reporting only the stored resume would put
 * fabrication at 0% every time — because the grounding worked — and that number
 * would say nothing. So each case records what the model produced *and* what
 * survived:
 *
 * - **Fabrication rate** counts `removedSkills`: skills the model claimed and
 *   `groundSkills` deleted. Non-zero is the evidence that the filter earns its
 *   place; the resume the learner receives is clean either way.
 * - **Experience misrepresentation** counts `noInventedExperience` rejections.
 *   That rule rejects and retries rather than deleting, because a sentence
 *   claiming a job cannot be repaired by removing a word.
 *
 * The prompt is written to make this measurable on purpose — `prompts/resume.ts`
 * asks the model for skills rather than handing it a list to echo, so that a
 * hallucination is visible instead of impossible.
 */

const COMPONENT = "resume_generation";

export async function evaluateResume(pool: Pool, recorder: Recorder): Promise<void> {
  console.log(`\nResume AI — ${resumes.length} evidence profiles\n`);

  for (const fixture of resumes) {
    const record = await evaluateOne(pool, fixture);
    recorder.add(record);

    const mark = record.ok ? "✓" : "✗";
    const note = record.ok
      ? `${String(record.metrics?.skillsKept ?? "?")} kept, ${String(record.metrics?.skillsRemoved ?? "?")} removed, ${record.attempts} attempt${record.attempts === 1 ? "" : "s"}, ${((record.durationMs ?? 0) / 1000).toFixed(1)}s`
      : record.error;
    console.log(`  ${mark} ${fixture.id.padEnd(20)} ${note}`);
  }
}

async function evaluateOne(pool: Pool, fixture: ResumeFixture): Promise<CaseRecord> {
  const base: CaseRecord = { component: COMPONENT, caseId: fixture.id, ok: false };
  const userId = randomUUID();

  await pool.query(
    `insert into users (id, email, full_name, password_hash, role, status, email_verified_at)
     values ($1, $2, $3, 'evaluation-fixture', 'learner', 'active', now())`,
    [userId, `resume-${fixture.id}@evaluation.invalid`, `Evaluation ${fixture.id}`],
  );
  const resume = await pool.query<{ id: string }>(
    `insert into resumes (user_id) values ($1) returning id`,
    [userId],
  );

  try {
    const response = await runResumeGeneration(pool, {
      id: randomUUID(),
      user_id: userId,
      payload: {
        resumeId: resume.rows[0].id,
        targetTitle: fixture.targetTitle,
        skills: fixture.skills,
        certificates: fixture.certificates,
        // No capstone exists, so every fixture is at a level below §9.1's third.
        projects: [],
      },
    });

    const result = response.result as Record<string, unknown>;
    const rejections = (result.rejections as string[] | undefined) ?? [];
    const removed = (result.removedSkills as string[] | undefined) ?? [];

    return {
      ...base,
      ok: true,
      attempts: Number(result.attempts ?? 0),
      durationMs: Number(result.durationMs ?? 0),
      promptVersion: response.promptVersion,
      rejections,
      metrics: {
        skillsKept: Number(result.skillsKept ?? 0),
        skillsRemoved: Number(result.skillsRemoved ?? 0),
        verifiedAvailable: fixture.skills.length,
        experienceRejections: rejections.length,
      },
      scoring: {
        expectation: fixture.expectation,
        targetTitle: fixture.targetTitle,
        verifiedSkills: fixture.skills.map((s) => s.name),
        removedSkills: removed,
        resume: response.output,
      },
    };
  } catch (err) {
    // Three rejected drafts in a row is itself a result, not a crash: it means
    // the model would not stop claiming experience for this profile — so the
    // reasons are kept and counted rather than collapsing into one message.
    const rejections = err instanceof ChatJsonError ? err.rejections : [];
    return {
      ...base,
      error: (err as Error).message,
      rejections,
      metrics: { experienceRejections: rejections.length },
    };
  }
}

export function summariseResume(recorder: Recorder): string {
  const all = recorder.of(COMPONENT);
  const ok = all.filter((c) => c.ok);
  const firstTry = ok.filter((c) => c.attempts === 1);
  const fabricated = ok.filter((c) => Number(c.metrics?.skillsRemoved ?? 0) > 0);
  const experience = ok.filter((c) => Number(c.metrics?.experienceRejections ?? 0) > 0);
  const removedTotal = ok.reduce((s, c) => s + Number(c.metrics?.skillsRemoved ?? 0), 0);

  const lines = [
    "## Resume AI",
    "",
    `${all.length} evidence profiles. §9.1's third level — a completed capstone project —`,
    "is **not measured**: Phase 4 is not built, so no learner can have one.",
    "",
    "| Metric | Result |",
    "|---|---|",
    `| Valid output rate (first attempt) | ${rate(firstTry.length, all.length)} |`,
    `| Resumes produced | ${rate(ok.length, all.length)} |`,
    `| Fabrication: runs where a skill was claimed without evidence | ${rate(fabricated.length, ok.length)} |`,
    `| Unsupported skills removed, total | ${removedTotal} |`,
    `| Experience misrepresentation: runs rejected and retried | ${rate(experience.length, ok.length)} |`,
    `| Unsupported skill in the printed **skills list** | ${rate(0, ok.length)} — filtered, so 0 by construction |`,
    `| Response time, mean | ${ms(ok.map((c) => c.durationMs ?? 0))} |`,
    "",
    "**The fabrication row measures the model; the row below it measures the",
    "platform.** A fabrication figure of 0% would mean the prompt never tempted the",
    "model into a claim, not that the grounding is unnecessary — and a figure above",
    "0% is the evidence that removing skills is doing real work.",
    "",
    "> **The summary sentence is not filtered.** `groundSkills` cleans the skills",
    "> array; `noInventedExperience` rejects claims of employment and of having built",
    "> something. Neither reads the summary for a claim of *knowledge*, so a resume",
    "> can print no skills and still open with a sentence asserting them. Check the",
    "> summary of every low-evidence profile in the sheet by hand until that gap is",
    "> closed — §9.1 counts it as fabrication even though nothing here does.",
    "",
    "ATS parse check and writing quality are evaluator tasks (§9.1) and are in",
    "`scoring-sheet.md`. The parse check needs the PDF, which `GET /resume.pdf`",
    "renders from this same content.",
  ];

  const broken = all.filter((c) => !c.ok);
  if (broken.length > 0) {
    lines.push(
      "",
      "### Did not complete",
      "",
      "Three rejected drafts in a row means the model would not stop claiming",
      "experience for that profile — a result, not an error.",
      "",
    );
    for (const c of broken) lines.push(`- \`${c.caseId}\` — ${c.error}`);
  }

  return lines.join("\n");
}
