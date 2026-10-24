import { z } from "zod";
import { apiRequest } from "./client.js";

/**
 * The capstone (design.md §5.14).
 *
 * **`start` sends a brief id and nothing else.** The technology comes from the
 * roadmap the learner already chose it on, decided by the API — a framework in
 * this payload would be a framework on a Project Certificate that nobody
 * studied. There is no field for one here because the endpoint rejects it.
 */

const CapstoneBrief = z.object({
  id: z.string(),
  versionId: z.string(),
  slug: z.string(),
  title: z.string(),
  description: z.string(),
  goals: z.string(),
  estimatedWeeks: z.number(),
  milestoneCount: z.number(),
  /** The skills it draws on, for §5.14's "Uses:" line. */
  uses: z.array(z.string()),
  starterRepo: z.string(),
});
export type CapstoneBrief = z.infer<typeof CapstoneBrief>;

export const CapstoneState = z.object({
  /**
   * §5.14's three stages, plus locked. The API decides this — the screen never
   * works it out from the other fields, so the two cannot disagree about
   * whether somebody may begin.
   */
  stage: z.enum(["locked", "choose", "connect", "build"]),
  /** Why it is locked, in the learner's words. Null otherwise. */
  reason: z.string().nullable(),
  technology: z.object({ id: z.string(), name: z.string() }).nullable(),
  briefs: z.array(CapstoneBrief),
  project: z
    .object({
      id: z.string(),
      status: z.string(),
      repoFullName: z.string().nullable(),
      briefTitle: z.string(),
      /** The template to copy. Null if it was withdrawn after the learner started. */
      starterRepo: z.string().nullable(),
      /** §5.14 stage 3's push history, newest first. */
      commits: z.array(
        z.object({
          sha: z.string(),
          message: z.string(),
          authorLogin: z.string().nullable(),
          pushedAt: z.string(),
        }),
      ),
      /**
       * Whether GitHub answered on this read. False means the history is the
       * last known one — not that there is none.
       */
      githubReachable: z.boolean(),
    })
    .nullable(),
  roadmapId: z.string().nullable(),
});
export type CapstoneState = z.infer<typeof CapstoneState>;

const Started = z.object({ projectId: z.string(), stage: z.string() });

/**
 * One check, as the server decided it.
 *
 * **Three states, not two.** `pending` is not a failure — a learner who pushed
 * ten seconds ago has no workflow run yet, and the screen must not read as
 * though their code is wrong.
 */
const Check = z.object({
  checkId: z.string(),
  name: z.string(),
  state: z.enum(["passed", "failed", "pending"]),
  detail: z.string(),
});
export type Check = z.infer<typeof Check>;

const Milestone = z.object({
  id: z.string(),
  sortOrder: z.number(),
  title: z.string(),
  acceptanceCriteria: z.array(z.string()),
  explanationQuestion: z.string().nullable(),
  modules: z.array(z.object({ id: z.string(), title: z.string(), slug: z.string() })),
  status: z.enum(["complete", "failed", "checking", "not-started"]),
  commitSha: z.string().nullable(),
  checks: z.array(Check),
  explanationAnswer: z.string().nullable(),
  /**
   * The AI review of the latest attempt, once the worker has written one.
   *
   * `outputId` is what the flag control points at — §7 requires every AI output
   * to be labelled, carry a reason, **and** be flaggable, and a panel with no id
   * would be missing the third.
   */
  review: z
    .object({
      outputId: z.string(),
      summary: z.string(),
      checklist: z.array(
        z.object({ criterion: z.string(), met: z.boolean(), note: z.string() }),
      ),
      nextStep: z.string(),
    })
    .nullable(),
});
export type Milestone = z.infer<typeof Milestone>;

const Milestones = z.object({
  milestones: z.array(Milestone),
  latestCommitSha: z.string().nullable(),
});

export const capstoneKey = ["capstone"];
export const milestonesKey = (roadmapId: string) => ["capstone", "milestones", roadmapId];

export const capstoneApi = {
  /** The active roadmap's capstone. Which roadmap that is, is the API's answer. */
  state: (signal?: AbortSignal) => apiRequest("/capstone", { schema: CapstoneState, signal }),

  start: (roadmapId: string, briefId: string) =>
    apiRequest(`/roadmaps/${roadmapId}/capstone`, {
      method: "POST",
      body: { briefId },
      schema: Started,
    }),

  /**
   * By GitHub's numeric id, never by name. A name can be changed or transferred
   * at any moment; the id cannot, and the API checks it against what the
   * learner's installation actually grants before storing anything.
   */
  setRepository: (roadmapId: string, repositoryId: number) =>
    apiRequest(`/roadmaps/${roadmapId}/capstone/repository`, {
      method: "PUT",
      body: { repositoryId },
      schema: z.object({ stage: z.string(), repoFullName: z.string() }),
    }),

  /** Reading this is what runs the checks — see `capstone/milestones.ts`. */
  milestones: (roadmapId: string, signal?: AbortSignal) =>
    apiRequest(`/roadmaps/${roadmapId}/capstone/milestones`, { schema: Milestones, signal }),

  /**
   * Where the deployed app lives. The browser says *where*, never *whether* —
   * the check decides that, and refuses any address that is not public.
   */
  setDemoUrl: (roadmapId: string, demoUrl: string) =>
    apiRequest(`/roadmaps/${roadmapId}/capstone/demo-url`, {
      method: "PUT",
      body: { demoUrl },
      schema: z.object({ demoUrl: z.string() }),
    }),

  /** §5.14's explanation question. Stored for admin review; it grades nothing. */
  answerExplanation: (roadmapId: string, milestoneId: string, answer: string) =>
    apiRequest(`/roadmaps/${roadmapId}/capstone/milestones/${milestoneId}/explanation`, {
      method: "PUT",
      body: { answer },
      schema: z.object({ saved: z.boolean() }),
    }),
};
