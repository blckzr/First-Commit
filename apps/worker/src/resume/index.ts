import { z } from "zod";
import type { Pool } from "pg";
import { chatJson } from "../ollama.js";
import {
  buildResumeMessages,
  noInventedExperience,
  PROMPT_VERSION,
  ResumeDraft,
} from "../prompts/resume.js";

/**
 * The Resume AI (project-proposal.md §5, design.md §5.16).
 *
 * The third and last of the three components, and the only one whose output a
 * stranger reads. §7's grounding rule is enforced in two different ways here,
 * and the difference matters:
 *
 * - **An unsupported skill is removed.** The resume without it is still correct,
 *   and a learner should not wait on a retry for something the platform can
 *   simply not print.
 * - **A claim of experience is rejected and retried.** "Built production
 *   systems" cannot be repaired by deleting a word; the whole answer is wrong
 *   about what the learner is, so the error goes back to the model.
 *
 * The evidence arrives **in the job payload**, read by the API from
 * `module_completions` and `certificates`. Same shape as `code_feedback`: the
 * model is handed results the platform computed, never asked to work out what
 * happened.
 */

/**
 * What the API queues. A Zod schema rather than a cast — a job payload crosses
 * a process and a database, which makes it a boundary (§8), and casting one
 * cost three silent retries on `code_feedback`.
 */
export const ResumeJobInput = z.object({
  resumeId: z.string(),
  targetTitle: z.string(),
  skills: z.array(
    z.object({ name: z.string(), moduleCount: z.number(), method: z.string() }),
  ),
  certificates: z.array(z.object({ title: z.string(), issuedAt: z.string() })),
  projects: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      technology: z.string().nullable(),
      repoFullName: z.string().nullable(),
    }),
  ),
});
export type ResumeJobInput = z.infer<typeof ResumeJobInput>;

/**
 * Removes any skill the evidence does not support (§7).
 *
 * Case-insensitive and tolerant of trailing punctuation, because "javascript"
 * and "JavaScript." are the same claim. **Not fuzzy beyond that**: "React
 * Native" is not evidence of React, and a near-match that let it through would
 * be the exact failure this exists to prevent. The platform's spelling wins, so
 * a resume says "JavaScript" however the model wrote it.
 */
export function groundSkills(
  claimed: string[],
  verified: { name: string }[],
): { kept: string[]; removed: string[] } {
  const allowed = new Map(verified.map((s) => [normalise(s.name), s.name]));
  const kept: string[] = [];
  const removed: string[] = [];
  const seen = new Set<string>();

  for (const claim of claimed) {
    const key = normalise(claim);
    const real = allowed.get(key);
    if (real === undefined) {
      removed.push(claim);
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(real);
  }
  return { kept, removed };
}

function normalise(value: string): string {
  return value.trim().toLowerCase().replace(/[.,;]+$/, "");
}

/**
 * Only a project the learner finished may be described (§7).
 *
 * The model is given the projects and asked to describe them, so an id it
 * invents is a hallucinated portfolio entry — the most damaging thing any of
 * the three components could produce.
 */
export function groundProjects<T extends { projectId: string }>(
  claimed: T[],
  verified: { id: string }[],
): { kept: T[]; removed: T[] } {
  const allowed = new Set(verified.map((p) => p.id));
  return {
    kept: claimed.filter((c) => allowed.has(c.projectId)),
    removed: claimed.filter((c) => !allowed.has(c.projectId)),
  };
}

export interface ResumeHandlerResult {
  result: Record<string, unknown>;
  output: unknown;
  promptVersion: number;
}

export async function runResumeGeneration(
  pool: Pool,
  job: { id: string; user_id: string | null; payload: unknown },
): Promise<ResumeHandlerResult> {
  const input = ResumeJobInput.parse(job.payload);
  const hasProjects = input.projects.length > 0;

  const response = await chatJson({
    schema: ResumeDraft,
    messages: buildResumeMessages(input),
    /**
     * Rejected and retried, with the reason fed back — the same mechanism
     * `noSolutionLeak` uses, for the same kind of failure: output that parses
     * but breaks the rule the component exists to keep.
     */
    validate: (draft) => noInventedExperience(draft, hasProjects),
  });

  const skills = groundSkills(response.data.skills, input.skills);
  const projects = groundProjects(response.data.projects, input.projects);

  const content = {
    summary: response.data.summary,
    skills: skills.kept,
    projects: projects.kept,
  };

  /**
   * §5.16: "AI-written summary and project descriptions are labeled and
   * editable." `ai_fields` records which fields the model wrote, so the screen
   * can label them — and so a field the learner edits can drop out of the list
   * and stop being labelled as AI. `skills` is not in it: the model only
   * ordered a list the platform supplied.
   */
  const aiFields = ["summary", ...projects.kept.map((p) => `project:${p.projectId}`)];

  await pool.query(
    `update resumes
        set content = $1, ai_fields = $2, generated_at = now(), updated_at = now()
      where id = $3 and user_id = $4`,
    [JSON.stringify(content), aiFields, input.resumeId, job.user_id],
  );

  return {
    result: {
      attempts: response.attempts,
      durationMs: response.durationMs,
      skillsKept: skills.kept.length,
      /**
       * Recorded because §9's evaluation needs the number. A prompt that made
       * hallucination impossible would also make it unmeasurable, so the model
       * is asked for skills and the removals are counted.
       */
      skillsRemoved: skills.removed.length,
      projectsRemoved: projects.removed.length,
    },
    output: content,
    promptVersion: PROMPT_VERSION,
  };
}
