import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { modulesApi } from "../../api/modules";
import { roadmapsKey } from "../roadmap/useRoadmap";

export const moduleKey = (id: string) => ["module", id] as const;
export const quizKey = (id: string) => ["quiz", id] as const;

export function useModule(moduleId: string | undefined) {
  return useQuery({
    queryKey: moduleKey(moduleId ?? ""),
    queryFn: ({ signal }) => modulesApi.get(moduleId!, signal),
    enabled: Boolean(moduleId),
  });
}

export function useQuiz(assessmentId: string | undefined) {
  return useQuery({
    queryKey: quizKey(assessmentId ?? ""),
    queryFn: ({ signal }) => modulesApi.quiz(assessmentId!, signal),
    enabled: Boolean(assessmentId),
    // The questions do not change mid-quiz, and refetching would reorder
    // nothing but would discard an in-progress render for no reason.
    staleTime: Infinity,
  });
}

export function useStartModule(moduleId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => modulesApi.start(moduleId),
    onSuccess: () => client.invalidateQueries({ queryKey: moduleKey(moduleId) }),
  });
}

export function useCompleteLesson(moduleId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (lessonId: string) => modulesApi.completeLesson(lessonId),
    onSuccess: () => client.invalidateQueries({ queryKey: moduleKey(moduleId) }),
  });
}

/**
 * Submitting a quiz can change the roadmap — a pass writes a completion, which
 * moves "You are here" and unlocks what comes next. So every roadmap in the
 * cache is stale afterwards, not just this module.
 */
export function useSubmitQuiz(assessmentId: string, moduleId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ answers, testOut }: { answers: Record<string, string>; testOut?: boolean }) =>
      modulesApi.submitQuiz(assessmentId, answers, testOut),
    async onSuccess() {
      await client.invalidateQueries({ queryKey: moduleKey(moduleId) });
      await client.invalidateQueries({ queryKey: roadmapsKey });
      await client.invalidateQueries({ queryKey: ["roadmap"] });
    },
  });
}
