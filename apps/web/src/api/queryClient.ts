import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "./client.js";

/**
 * design.md §13.1 — TanStack Query for server state.
 *
 * A 401 is not a failure worth retrying: it means there is no session, and the
 * guards will redirect. Retrying it would delay that redirect and hammer the
 * API while the learner waits.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: (failureCount, error) => {
          if (error instanceof ApiError && (error.isUnauthorized || error.status === 404)) {
            return false;
          }
          return failureCount < 2;
        },
        staleTime: 30_000,
        refetchOnWindowFocus: false,
      },
      mutations: { retry: false },
    },
  });
}
