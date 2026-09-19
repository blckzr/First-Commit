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

export function RequireAdmin() {
  const { user } = useSession();
  if (user?.role !== "admin") {
    return <Navigate to="/app" replace state={{ notice: "unavailable" }} />;
  }
  return <Outlet />;
}
