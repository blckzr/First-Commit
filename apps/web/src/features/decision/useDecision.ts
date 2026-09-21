import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { decisionsApi } from "../../api/decisions";
import { homeKey } from "../home/useHome";

export const decisionKey = (roadmapId: string, decisionId: string) =>
  ["decision", roadmapId, decisionId] as const;

export function useDecision(roadmapId: string | undefined, decisionId: string | undefined) {
  return useQuery({
    queryKey: decisionKey(roadmapId ?? "", decisionId ?? ""),
    queryFn: ({ signal }) => decisionsApi.get(roadmapId!, decisionId!, signal),
    enabled: Boolean(roadmapId && decisionId),
  });
}

/**
 * Choosing rewrites the technology part of the roadmap, so every view of it is
 * stale afterwards — the chart, the roadmap list, and Home's progress.
 */
export function useChooseTechnology(roadmapId: string, decisionId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (technologyId: string) =>
      decisionsApi.choose(roadmapId, decisionId, technologyId),
    async onSuccess() {
      await client.invalidateQueries({ queryKey: decisionKey(roadmapId, decisionId) });
      await client.invalidateQueries({ queryKey: ["roadmap"] });
      await client.invalidateQueries({ queryKey: ["roadmaps"] });
      await client.invalidateQueries({ queryKey: homeKey });
    },
  });
}
