import { z } from "zod";
import { apiRequest } from "./client.js";

/** The technology decision (design.md §5.8), validated at the boundary. */
const DecisionOption = z.object({
  technologyId: z.string(),
  name: z.string(),
  description: z.string(),
  comparison: z.record(z.string(), z.string()),
  moduleCount: z.number(),
  passedCount: z.number(),
});
export type DecisionOption = z.infer<typeof DecisionOption>;

export const DecisionPage = z.object({
  id: z.string(),
  roadmapId: z.string(),
  title: z.string(),
  trackTitle: z.string(),
  careerPathTitle: z.string(),
  chosenTechnologyId: z.string().nullable(),
  recommendation: z.object({ technologyId: z.string(), reason: z.string() }).nullable(),
  options: z.array(DecisionOption),
});
export type DecisionPage = z.infer<typeof DecisionPage>;

const DecisionResponse = z.object({ decision: DecisionPage });

export const ChoiceResult = z.object({
  technologyId: z.string(),
  added: z.number(),
  removed: z.number(),
  switched: z.boolean(),
});
export type ChoiceResult = z.infer<typeof ChoiceResult>;

const ChoiceResponse = z.object({ result: ChoiceResult });

export const decisionsApi = {
  get: (roadmapId: string, decisionId: string, signal?: AbortSignal) =>
    apiRequest(`/roadmaps/${roadmapId}/decisions/${decisionId}`, {
      schema: DecisionResponse,
      signal,
    }).then((r) => r.decision),

  /**
   * Sends which option was picked, and nothing else. What that does to the
   * roadmap is the server's decision (AGENT.md §6 rule 1) — the browser does
   * not send a module list.
   */
  choose: (roadmapId: string, decisionId: string, technologyId: string) =>
    apiRequest(`/roadmaps/${roadmapId}/decisions/${decisionId}`, {
      method: "POST",
      body: { technologyId },
      schema: ChoiceResponse,
    }).then((r) => r.result),
};
