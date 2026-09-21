import { Navigate, Outlet, useLocation } from "react-router";
import { useSession } from "../features/auth/useSession";

/**
 * design.md §13.6 — and the rule that matters most: **guards are for the
 * experience, not for security.** They decide what renders. The Express API
 * decides what data comes back (docs/database-schema.md §6).
 */

function FullPageSpinner() {
  return <div role="status" aria-live="polite">Loading…</div>;
}

export function RequireAuth() {
  const { status, user } = useSession();
  const location = useLocation();
  // Render nothing while loading, so protected content never flashes.
  if (status === "loading") return <FullPageSpinner />;
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  return <Outlet />;
}

export function RequireLearner({ needsOnboarding = false }: { needsOnboarding?: boolean }) {
  const { user, onboardingStep } = useSession();
  if (user?.role === "admin") return <Navigate to="/admin" replace />;
  if (!needsOnboarding && onboardingStep) {
    return <Navigate to={`/onboarding/${onboardingStep}`} replace />;
  }
  if (needsOnboarding && !onboardingStep) return <Navigate to="/app" replace />;
  return <Outlet />;
}

/** The onboarding steps in order. Mirrors the API's own list. */
const ONBOARDING_STEPS = ["about", "target", "placement", "generating"];

/**
 * design.md §5.4: "a learner cannot open /onboarding/placement before finishing
 * the earlier steps and is sent back to the first unfinished step."
 *
 * Going *back* to a finished step is allowed — that is how Back works. Only
 * jumping ahead is redirected. The API refuses the same jump with a 409; this
 * only saves the learner from a page they cannot use.
 */
export function RequireOnboardingStep() {
  const { onboardingStep } = useSession();
  const { pathname } = useLocation();

  const asked = ONBOARDING_STEPS.indexOf(pathname.replace("/onboarding/", ""));
  const reached = ONBOARDING_STEPS.indexOf(onboardingStep ?? "");

  if (asked > -1 && reached > -1 && asked > reached) {
    return <Navigate to={`/onboarding/${ONBOARDING_STEPS[reached]}`} replace />;
  }
  return <Outlet />;
}

export function RequireAdmin() {
  const { user } = useSession();
  if (user?.role !== "admin") {
    return <Navigate to="/app" replace state={{ notice: "unavailable" }} />;
  }
  return <Outlet />;
}
