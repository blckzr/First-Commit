import { useQuery } from "@tanstack/react-query";
import { onboardingApi } from "../../api/onboarding";

export const onboardingKey = ["onboarding"] as const;

/**
 * The learner's onboarding state.
 *
 * design.md §5.4: "Answers are saved when the learner continues, so closing the
 * browser and returning later resumes at the same step." That resume depends on
 * this, so it is fetched fresh rather than served from a long cache.
 *
 * `pollMs` is for the generating step only, where the browser is waiting on
 * work the worker does. Every other step reads it once.
 */
export function useOnboarding({ pollMs }: { pollMs?: number } = {}) {
  return useQuery({
    queryKey: onboardingKey,
    queryFn: ({ signal }) => onboardingApi.state(signal),
    staleTime: 0,
    refetchInterval: pollMs,
  });
}
