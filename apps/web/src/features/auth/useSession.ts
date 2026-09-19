/**
 * Session stub.
 *
 * The real implementation reads the session from the Express API
 * (`GET /auth/me`), which resolves the session cookie server-side. The role
 * comes from the `users` table and never from anything the browser can set
 * (design.md §13.6).
 *
 * Until `apps/api` exists this returns a fixed user so the shells, the guards,
 * and the screens can be built and reviewed. **Nothing here is a security
 * boundary** — the API is (docs/database-schema.md §6). When this is replaced,
 * the dev override below goes with it.
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

const LEARNER: SessionUser = {
  id: "stub-learner",
  fullName: "Jan Kevin",
  role: "learner",
};

const ADMIN: SessionUser = {
  id: "stub-admin",
  fullName: "Jan Kevin",
  role: "admin",
};

/**
 * Development-only override, so all four areas and every redirect in §4.3 can
 * be exercised without editing this file:
 *
 *   ?as=admin      an admin session
 *   ?as=learner    a learner session (the default)
 *   ?as=onboarding a learner part-way through onboarding
 *   ?as=signedout  no session
 *
 * The choice sticks in sessionStorage so it survives navigation within a tab.
 * `import.meta.env.DEV` is replaced at build time, so none of this reaches a
 * production bundle.
 */
type DevAs = "learner" | "admin" | "onboarding" | "signedout";

function devOverride(): DevAs {
  if (!import.meta.env.DEV || typeof window === "undefined") return "learner";

  const KEY = "fc:dev:as";
  const valid: DevAs[] = ["learner", "admin", "onboarding", "signedout"];

  try {
    const fromUrl = new URLSearchParams(window.location.search).get("as");
    if (fromUrl && (valid as string[]).includes(fromUrl)) {
      window.sessionStorage.setItem(KEY, fromUrl);
      return fromUrl as DevAs;
    }
    const stored = window.sessionStorage.getItem(KEY);
    if (stored && (valid as string[]).includes(stored)) return stored as DevAs;
  } catch {
    // Private mode or blocked storage — fall through to the default.
  }

  return "learner";
}

export function useSession(): Session {
  const as = devOverride();

  switch (as) {
    case "admin":
      return { status: "ready", user: ADMIN, onboardingStep: null };
    case "onboarding":
      return { status: "ready", user: LEARNER, onboardingStep: "placement" };
    case "signedout":
      return { status: "ready", user: null, onboardingStep: null };
    default:
      return { status: "ready", user: LEARNER, onboardingStep: null };
  }
}
