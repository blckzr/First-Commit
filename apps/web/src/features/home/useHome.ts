import { useQuery } from "@tanstack/react-query";
import { homeApi } from "../../api/home";

export const homeKey = ["home"] as const;

/**
 * Home reflects progress that changes as the learner works, so it is refetched
 * rather than served from a long cache — passing a quiz elsewhere in the app
 * should be visible the next time they land here.
 */
export function useHome() {
  return useQuery({ queryKey: homeKey, queryFn: ({ signal }) => homeApi.get(signal), staleTime: 0 });
}
