import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../../api/client";
import { authApi, type SessionUser } from "../../api/auth";

/**
 * The signed-in user, from the API.
 *
 * design.md §13.6: the role comes from the server and never from anything the
 * browser can set. This asks `GET /auth/me`, which resolves the `httpOnly`
 * session cookie — there is nothing here a page can influence.
 *
 * **The guards read this, but the guards are not the protection.** The API
 * refuses data the session is not entitled to regardless of what renders
 * (AGENT.md §6).
 */

export type AppRole = SessionUser["role"];

export interface Session {
  status: "loading" | "ready";
  user: SessionUser | null;
  /** The onboarding page to resume at, or null when onboarding is finished. */
  onboardingStep: string | null;
  /** Where the server says this person belongs right now. */
  next: string | null;
}

export const sessionKey = ["session"] as const;

export function useSession(): Session {
  const query = useQuery({
    queryKey: sessionKey,
    queryFn: ({ signal }) => authApi.me(signal),
    // A signed-out visitor is a normal state, not an error to retry.
    retry: (count, error) =>
      error instanceof ApiError && error.isUnauthorized ? false : count < 2,
  });

  if (query.isPending) return { status: "loading", user: null, onboardingStep: null, next: null };

  // 401 means signed out. Any other failure also renders as signed out rather
  // than as a broken page — the guards then send them to /login, which is the
  // honest thing to show when we cannot confirm who they are.
  if (query.isError || !query.data) {
    return { status: "ready", user: null, onboardingStep: null, next: null };
  }

  return {
    status: "ready",
    user: query.data.user,
    onboardingStep: query.data.onboardingStep,
    next: query.data.next,
  };
}

/**
 * Replaces the cached session after signing in or out.
 *
 * design.md §13.6: on log out the query cache is cleared, so the next person at
 * the same computer sees nothing of the last one.
 */
export function useSessionActions() {
  const client = useQueryClient();

  return {
    setSession(user: SessionUser, onboardingStep: string | null = null) {
      client.setQueryData(sessionKey, { user, onboardingStep });
    },
    async clearSession() {
      client.setQueryData(sessionKey, null);
      await client.cancelQueries();
      client.clear();
    },
  };
}
