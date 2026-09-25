import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { exercisesApi, type ExerciseFile } from "../../api/exercises";

export const exerciseKey = (id: string) => ["exercise", id] as const;
export const submissionKey = (id: string) => ["submission", id] as const;

export function useExercise(id: string | undefined) {
  return useQuery({
    queryKey: exerciseKey(id ?? ""),
    queryFn: ({ signal }) => exercisesApi.get(id!, signal),
    enabled: Boolean(id),
  });
}

/**
 * One submission, polled while the worker has it.
 *
 * The worker posts to `/internal/events` and the API pushes over SSE, so this
 * is the backstop rather than the mechanism — but it is the honest one to
 * build first: a learner staring at a spinner because a notice went missing is
 * a failure this project has already had once, on the generating screen.
 *
 * Polling stops as soon as the run is finished **and** the feedback has either
 * arrived or was never coming.
 */
export function useSubmission(id: string | undefined) {
  return useQuery({
    queryKey: submissionKey(id ?? ""),
    queryFn: ({ signal }) => exercisesApi.submission(id!, signal),
    enabled: Boolean(id),
    refetchInterval: (query) => {
      const s = query.state.data;
      if (!s) return 2000;
      const running = s.status === "queued" || s.status === "running";
      const waitingOnFeedback =
        s.feedback === null &&
        (s.feedbackStatus === "queued" || s.feedbackStatus === "running");
      return running || waitingOnFeedback ? 2000 : false;
    },
  });
}

export function useSubmitExercise(exerciseId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (files: ExerciseFile[]) => exercisesApi.submit(exerciseId!, files),
    onSuccess: () => {
      // The exercise carries `lastSubmission`, which this just replaced.
      void client.invalidateQueries({ queryKey: exerciseKey(exerciseId ?? "") });
    },
  });
}
