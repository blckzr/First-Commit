import type { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { runRoadmapGeneration } from "../roadmap/index.js";
import { ChatJsonError } from "../ollama.js";
import { learners, type LearnerFixture } from "./fixtures/learners.js";
import { rate, ms, type CaseRecord, type Recorder } from "./report.js";

/**
 * Roadmap AI evaluation (`project-proposal.md` §9.1).
 *
 * ### Where the numbers come from
 *
 * §9.1 asks for valid output rate, prerequisite violations, and core coverage.
 * All three are already computed on every run — `validateRoadmapPlan` rejects a
 * plan and `chatJson` retries with the reason — and were then discarded. The
 * harness reads `rejections` and sorts the reasons into §9.1's rows.
 *
 * So these are **attempts** at a violation, not violations that survived: an
 * invalid roadmap is never written. That distinction is the point. A table
 * reporting "prerequisite violations: 0" would be true of any run and would say
 * nothing about the model; "the model put a module before its prerequisite
 * twice in six roadmaps, and both were rejected and regenerated" says what the
 * validator is worth.
 *
 * ### Each learner gets a fresh account
 *
 * `applyRoadmapPlan` writes items and moves `onboarding_step` to done. Sharing
 * one learner would let the first roadmap change the conditions for the next.
 */

const COMPONENT = "roadmap_generation";

export async function evaluateRoadmap(pool: Pool, recorder: Recorder): Promise<void> {
  const path = await pool.query<{ id: string }>(
    `select id from career_paths where slug = 'junior-web-developer'`,
  );
  const careerPathId = path.rows[0]?.id;
  if (!careerPathId) throw new Error("The seeded career path is missing");

  console.log(`\nRoadmap AI — ${learners.length} learner profiles\n`);

  for (const fixture of learners) {
    const record = await evaluateOne(pool, careerPathId, fixture);
    recorder.add(record);

    const mark = record.ok ? "✓" : "✗";
    const note = record.ok
      ? `${String(record.scoring?.trackTitle ?? "?")}, ${String(record.metrics?.moduleCount ?? "?")} modules, ${record.attempts} attempt${record.attempts === 1 ? "" : "s"}, ${((record.durationMs ?? 0) / 1000).toFixed(1)}s`
      : record.error;
    console.log(`  ${mark} ${fixture.id.padEnd(22)} ${note}`);
  }
}

async function evaluateOne(
  pool: Pool,
  careerPathId: string,
  fixture: LearnerFixture,
): Promise<CaseRecord> {
  const base: CaseRecord = { component: COMPONENT, caseId: fixture.id, ok: false };
  const userId = randomUUID();

  await pool.query(
    `insert into users (id, email, full_name, password_hash, role, status, email_verified_at)
     values ($1, $2, $3, 'evaluation-fixture', 'learner', 'active', now())`,
    [userId, `${fixture.id}@evaluation.invalid`, `Evaluation ${fixture.id}`],
  );
  await pool.query(
    `insert into learner_profiles (user_id, experience_level, goal, weekly_hours, onboarding_step)
     values ($1, $2, $3, $4, 'generating')`,
    [userId, fixture.experienceLevel, fixture.goal, fixture.weeklyHours],
  );

  for (const slug of fixture.completedSlugs) {
    const module = await pool.query<{ id: string }>(`select id from modules where slug = $1`, [slug]);
    const moduleId = module.rows[0]?.id;
    // A slug that no longer exists would silently mean "this learner has passed
    // nothing", and the roadmap would be judged against the wrong history.
    if (!moduleId) throw new Error(`Fixture ${fixture.id} names unknown module "${slug}"`);

    const version = await pool.query<{ id: string }>(
      `select id from module_versions where module_id = $1 and status = 'published'`,
      [moduleId],
    );
    await pool.query(
      `insert into module_completions (user_id, module_id, module_version_id, method, score)
       values ($1, $2, $3, 'tested_out', 100)`,
      [userId, moduleId, version.rows[0]?.id ?? null],
    );
  }

  const roadmap = await pool.query<{ id: string }>(
    `insert into roadmaps (user_id, career_path_id, weekly_hours) values ($1, $2, $3) returning id`,
    [userId, careerPathId, fixture.weeklyHours],
  );

  try {
    const response = await runRoadmapGeneration(pool, {
      id: randomUUID(),
      user_id: userId,
      source_id: roadmap.rows[0].id,
      payload: { careerPathId },
    });

    const result = response.result as Record<string, unknown>;
    const output = response.output as Record<string, unknown>;
    const rejections = (result.rejections as string[] | undefined) ?? [];

    return {
      ...base,
      ok: true,
      attempts: Number(result.attempts ?? 0),
      durationMs: Number(result.durationMs ?? 0),
      promptVersion: response.promptVersion,
      rejections,
      metrics: {
        moduleCount: result.moduleCount,
        skipped: result.skipped,
        estimatedWeeks: result.estimatedWeeks,
        completedBefore: fixture.completedSlugs.length,
        ...classify(rejections),
      },
      scoring: {
        expectation: fixture.expectation,
        trackTitle: output.trackTitle,
        explanation: output.explanation,
      },
    };
  } catch (err) {
    /**
     * A case that exhausted its retries still carries three rejection reasons,
     * and they are the ones §9.1 most wants counted. Reading them off the error
     * keeps the hardest failures in the violation totals instead of dropping
     * them for having failed too thoroughly.
     */
    const rejections = err instanceof ChatJsonError ? err.rejections : [];
    return {
      ...base,
      error: (err as Error).message,
      rejections,
      metrics: classify(rejections),
    };
  }
}

/**
 * Sorts rejection reasons into §9.1's rows, matched on `validate.ts`'s own
 * wording. A reason matching nothing lands in `otherRejections` rather than
 * being dropped, so a new validator message shows up as an unexplained count
 * instead of vanishing.
 */
export function classify(rejections: string[]): Record<string, number> {
  const counts = {
    unknownModuleId: 0,
    prerequisiteViolations: 0,
    missingCoreCoverage: 0,
    wrongTrackContent: 0,
    otherRejections: 0,
  };

  for (const reason of rejections) {
    if (/does not exist|is not a module id/.test(reason)) counts.unknownModuleId += 1;
    else if (/which it requires|requires ".*", which/.test(reason)) counts.prerequisiteViolations += 1;
    else if (/Core module .* is missing|required for the certificate/.test(reason))
      counts.missingCoreCoverage += 1;
    else if (/belongs to a different track|belongs to the .* track|is a technology module/.test(reason))
      counts.wrongTrackContent += 1;
    else counts.otherRejections += 1;
  }
  return counts;
}

export function summariseRoadmap(recorder: Recorder): string {
  const all = recorder.of(COMPONENT);
  const ok = all.filter((c) => c.ok);
  const firstTry = ok.filter((c) => c.attempts === 1);
  /**
   * Counted over **every** case, including the ones that never produced a
   * roadmap. A case that failed three times contributed three violations, and
   * leaving it out of the totals would report the worst runs as the cleanest.
   */
  const total = (key: string) =>
    all.reduce((sum, c) => sum + Number(c.metrics?.[key] ?? 0), 0);

  const tracks = new Map<string, number>();
  for (const c of ok) {
    const t = String(c.scoring?.trackTitle ?? "—");
    tracks.set(t, (tracks.get(t) ?? 0) + 1);
  }

  const lines = [
    "## Roadmap AI",
    "",
    `${all.length} learner profiles.`,
    "",
    "| Metric | Result |",
    "|---|---|",
    `| Valid output rate (first attempt) | ${rate(firstTry.length, all.length)} |`,
    `| Roadmaps produced | ${rate(ok.length, all.length)} |`,
    `| Prerequisite violations, rejected and regenerated | ${total("prerequisiteViolations")} |`,
    `| Missing core coverage, rejected and regenerated | ${total("missingCoreCoverage")} |`,
    `| Unknown module ids, rejected and regenerated | ${total("unknownModuleId")} |`,
    `| Wrong-track content, rejected and regenerated | ${total("wrongTrackContent")} |`,
    `| Unclassified rejections | ${total("otherRejections")} |`,
    `| Response time, mean | ${ms(ok.map((c) => c.durationMs ?? 0))} |`,
    "",
    "**Every count above is an attempt the validator caught, not a roadmap a",
    "learner received** — an invalid plan is never written. Zero across the row",
    "means the model needed no correction, not that the checks are absent.",
    "",
    `Track recommendations: ${[...tracks].map(([t, n]) => `${t} ×${n}`).join(", ") || "—"}.`,
    "Whether each one suits its learner is an evaluator judgment (§9.1) and is in",
    "`scoring-sheet.md`.",
  ];

  const broken = all.filter((c) => !c.ok);
  if (broken.length > 0) {
    lines.push("", "### Did not complete", "");
    for (const c of broken) lines.push(`- \`${c.caseId}\` — ${c.error}`);
  }

  return lines.join("\n");
}
