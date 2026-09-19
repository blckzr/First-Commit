/**
 * Session stub.
 *
 * The real implementation reads the session from the Express API
 * (`GET /auth/me`), which resolves the session cookie server-side. The role
 * comes from the `users` table and never from anything the browser can set
 * (design.md §13.6).
 *
 * Until `apps/api` exists, this returns a fixed learner so the shell and the
 * guards can be built and reviewed. Nothing here is a security boundary — the
 * API is (docs/database-schema.md §6).
 */

export type AppRole = "learner" | "admin";

export interface SessionUser {
  id: string;
  fullName: string;
  role: AppRole;
}

export interface Session {
  status: "loading" | "ready";
  user: SessionUser | null;
  /** The onboarding page to resume at, or null when onboarding is finished. */
  onboardingStep: string | null;
}

export function useSession(): Session {
  return {
    status: "ready",
    user: { id: "stub-learner", fullName: "Jan Kevin", role: "learner" },
    onboardingStep: null,
  };
}
