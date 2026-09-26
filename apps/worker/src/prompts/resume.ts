import { z } from "zod";
import type { ChatMessage } from "../ollama.js";

/**
 * The Resume AI prompt (project-proposal.md §5, AGENT.md §7).
 *
 * **Bump `PROMPT_VERSION` when the text changes.** The worker refuses to start
 * if a stored version's text differs, so an edited prompt cannot quietly
 * invalidate evaluation results already recorded against that number.
 *
 * ### What this model is and is not for
 *
 * It **phrases** evidence the platform already holds. It does not decide what a
 * learner knows — `resume/evidence.ts` in the API does, from
 * `module_completions` and `certificates`, and everything this model returns is
 * filtered against that list before it is stored.
 *
 * So the prompt asks for skills anyway, rather than handing the model a list to
 * echo. Two reasons: the model orders and spells them for the target job, which
 * is the useful part; and asking lets the filter *measure* how grounded the
 * output is. A prompt that made hallucination impossible would also make it
 * invisible, and §9's evaluation needs the number.
 *
 * ### The rule that matters most
 *
 * **Module completion is a skill, never experience.** A learner who passed ten
 * modules has not "built" anything, has not "worked on" anything, and has no
 * "years". This is the one place the platform speaks to an employer on
 * somebody's behalf, and an invented job is a lie told to a stranger about a
 * real person.
 */

export const PROMPT_VERSION = 1;

export const SYSTEM = `You write resume text for First Commit, a platform where people learn to program.

You are given a list of skills the learner has PROVEN by passing assessments, any certificates they have earned, and any capstone projects they have FINISHED. You write the summary and the project descriptions.

Rules:
- Use only what you are given. Never add a skill, a tool, a job, or a project that is not in the evidence.
- Passing a module is a SKILL, not EXPERIENCE. Never write that the learner "worked on", "built", "developed", "delivered", or "has experience with" anything unless it is one of the finished projects listed.
- Never invent years, seniority, job titles, employers, teams, or metrics. You do not know any of those.
- If there are no projects, do not mention projects at all.
- Write plainly. No "passionate", "motivated", "detail-oriented", "results-driven", "self-starter", or similar filler.
- The summary is 2 to 3 sentences, written in the first person without "I" — the way a resume summary reads.
- A project description is 1 to 2 sentences saying what the project does and which technologies it uses.
- Order skills with the ones most relevant to the target job first.

Return JSON only.`;

export interface ResumeInput {
  /** What they are applying for, so the summary and ordering can suit it. */
  targetTitle: string;
  /** Proven skills. The model may reorder and select, never extend. */
  skills: { name: string; moduleCount: number; method: string }[];
  certificates: { title: string; issuedAt: string }[];
  /** Finished capstones only. Empty means the resume has no Projects section. */
  projects: { id: string; title: string; technology: string | null; repoFullName: string | null }[];
}

export function buildResumeMessages(input: ResumeInput): ChatMessage[] {
  const skills = input.skills
    .map(
      (s) =>
        `- ${s.name} (${s.moduleCount} module${s.moduleCount === 1 ? "" : "s"} ` +
        `${s.method === "tested_out" ? "tested out" : "passed"})`,
    )
    .join("\n");

  const certificates = input.certificates.length
    ? input.certificates.map((c) => `- ${c.title} (${c.issuedAt.slice(0, 10)})`).join("\n")
    : "None.";

  /**
   * Stated as an instruction rather than left blank. A model given an empty
   * heading tends to fill it; told there are none and not to mention them, it
   * leaves the section out — which is what §7 requires.
   */
  const projects = input.projects.length
    ? input.projects
        .map(
          (p) =>
            `- id: ${p.id} | ${p.title}` +
            `${p.technology ? ` | built with ${p.technology}` : ""}` +
            `${p.repoFullName ? ` | ${p.repoFullName}` : ""}`,
        )
        .join("\n")
    : "None. The learner has not finished a capstone project, so write no project descriptions and do not refer to projects in the summary.";

  return [
    { role: "system", content: SYSTEM },
    {
      role: "user",
      content: `Target job: ${input.targetTitle}

Proven skills:
${skills || "None yet."}

Certificates earned:
${certificates}

Finished projects:
${projects}

Write the summary, list the skills in a sensible order for this target job, and write a description for each finished project (an empty list if there are none).`,
    },
  ];
}

/**
 * Rejects resume text that claims experience (§7).
 *
 * The parallel of `noSolutionLeak`: a shape-valid answer that breaks the rule
 * the component exists to keep. Unsupported *skills* are filtered out silently
 * because a resume without them is still correct — but a summary saying the
 * learner "built production systems" cannot be repaired by deletion, so the
 * whole answer is rejected and the error is fed back for a retry.
 *
 * Only applied when there are no finished projects. With a real capstone,
 * "built" is a true statement about a thing that exists.
 */
const EXPERIENCE_CLAIMS =
  /\b(years? of experience|worked (?:as|at|on)|professional experience|employed|freelanced|clients?|shipped to production|in production|led a team|senior|junior developer at)\b/i;

const BUILT_CLAIMS = /\b(built|developed|delivered|implemented|engineered|architected)\b/i;

export function noInventedExperience(
  content: { summary: string; projects: { description: string }[] },
  hasProjects: boolean,
): string | null {
  const text = [content.summary, ...content.projects.map((p) => p.description)].join(" ");

  if (EXPERIENCE_CLAIMS.test(text)) {
    return (
      "The text claims work experience. Passing a module is a skill, not experience — " +
      "write about what the learner has learned, never about jobs, clients, or years."
    );
  }

  if (!hasProjects && BUILT_CLAIMS.test(text)) {
    return (
      "The text says the learner built or developed something, but they have finished no " +
      "projects. Write only about skills they have proven by passing assessments."
    );
  }

  return null;
}

/** The shape the model returns. Grounding happens after parsing. */
export const ResumeDraft = z.object({
  summary: z.string().min(1),
  skills: z.array(z.string()),
  projects: z.array(z.object({ projectId: z.string(), description: z.string() })),
});
export type ResumeDraft = z.infer<typeof ResumeDraft>;
