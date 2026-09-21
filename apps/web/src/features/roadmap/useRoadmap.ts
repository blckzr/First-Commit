import { useQuery } from "@tanstack/react-query";
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
