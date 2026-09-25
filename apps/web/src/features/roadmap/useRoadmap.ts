import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { roadmapsApi } from "../../api/roadmaps";
import type { Roadmap } from "./types";

export const roadmapKey = (id: string) => ["roadmap", id] as const;
export const roadmapsKey = ["roadmaps"] as const;

/**
 * One roadmap, from the API.
 *
 * The response is Zod-validated at the boundary in `api/roadmaps.ts`, so what
 * comes out of here really is a `Roadmap` — the cast is safe because the parse
 * already happened, not because we hope the shapes match.
 */
export function useRoadmap(id: string | undefined) {
  return useQuery({
    queryKey: roadmapKey(id ?? ""),
    queryFn: ({ signal }) => roadmapsApi.get(id!, signal) as Promise<Roadmap>,
    enabled: Boolean(id),
  });
}

/** The learner's roadmaps, for switching between them and for finding the first one. */
export function useRoadmaps() {
  return useQuery({
    queryKey: roadmapsKey,
    queryFn: ({ signal }) => roadmapsApi.list(signal),
  });
}

/**
 * §5.12: archive a roadmap, or restore one.
 *
 * Invalidates both the list and that roadmap's own entry — the archived
 * roadmap's chart is still reachable by address, and it should not go on
 * claiming to be active.
 */
export function useSetRoadmapStatus() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: "active" | "archived" }) =>
      roadmapsApi.setStatus(id, status),
    onSuccess: (_result, { id }) => {
      void client.invalidateQueries({ queryKey: roadmapsKey });
      void client.invalidateQueries({ queryKey: roadmapKey(id) });
    },
  });
}
