import { z } from "zod";
import { apiRequest } from "./client.js";

/**
 * Flagging AI output as wrong (AGENT.md §7: all AI output "is flaggable by
 * learners"). One endpoint serves every AI panel — §5.5's roadmap
 * explanation, §5.8's technology recommendation, §5.11's code feedback —
 * because a flag points at the output row, not at the screen that showed it.
 */

const FlagResponse = z.object({
  flag: z.object({
    id: z.string(),
    /** `open` until an admin rules on it. The learner is told nothing more. */
    status: z.string(),
    createdAt: z.string(),
  }),
});

export const flagsApi = {
  create: (aiOutputId: string, reason: string) =>
    apiRequest(`/ai-outputs/${aiOutputId}/flags`, {
      method: "POST",
      body: { reason },
      schema: FlagResponse,
    }).then((r) => r.flag),
};
