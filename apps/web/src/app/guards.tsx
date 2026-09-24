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
  const { status, user, onboardingStep, next } = useSession();
  /**
   * §13.6: guards render nothing while the session loads. Without this, an
   * unloaded session looks like "no unfinished onboarding" and this redirects
   * to `/app` before it knows anything. It is safe in the router because
   * `RequireAuth` waits above it — but a guard that is only correct because of
   * where it happens to sit is one move away from being wrong.
   */
  if (status === "loading") return <FullPageSpinner />;
  if (user?.role === "admin") return <Navigate to="/admin" replace />;
  if (!needsOnboarding && onboardingStep) {
    return <Navigate to={`/onboarding/${onboardingStep}`} replace />;
  }
  /**
   * §5.4: onboarding ends at the roadmap review (§5.5), not at Home. Which one
   * is the server's call — `GET /auth/me` returns it — so that the screen and
   * the guard cannot disagree about where a finished learner goes.
   */
  if (needsOnboarding && !onboardingStep) return <Navigate to={next ?? "/app"} replace />;
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
  const { status, onboardingStep } = useSession();
  const { pathname } = useLocation();

  if (status === "loading") return <FullPageSpinner />;

  const asked = ONBOARDING_STEPS.indexOf(pathname.replace("/onboarding/", ""));
  const reached = ONBOARDING_STEPS.indexOf(onboardingStep ?? "");

  if (asked > -1 && reached > -1 && asked > reached) {
    return <Navigate to={`/onboarding/${ONBOARDING_STEPS[reached]}`} replace />;
  }
  return <Outlet />;
}

/**
 * design.md §4.3: "Anyone signed in | `/login` or `/signup` | Sent to their own
 * area."
 *
 * Without this, a signed-in learner opening the site is shown a log-in page as
 * though they were a stranger — and can sign in as somebody else without ever
 * signing out. The session was being held all along; nothing on the public
 * pages was looking at it.
 *
 * "Their own area" is the same answer `POST /auth/login` gives in its `next`,
 * so arriving at `/login` while signed in lands exactly where logging in would
 * have.
 */
export function RedirectIfSignedIn() {
  const { status, user, onboardingStep, next } = useSession();

  if (status === "loading") return <FullPageSpinner />;
  if (!user) return <Outlet />;
  if (next) return <Navigate to={next} replace />;
  // Without a `next` — an older API, or a response that did not carry one —
  // work it out the same way the server would.
  if (user.role === "admin") return <Navigate to="/admin" replace />;
  if (onboardingStep) return <Navigate to={`/onboarding/${onboardingStep}`} replace />;
  return <Navigate to="/app" replace />;
}

export function RequireAdmin() {
  const { status, user } = useSession();
  // Same reason as above: an unloaded session is not an unauthorised one.
  if (status === "loading") return <FullPageSpinner />;
  if (user?.role !== "admin") {
    return <Navigate to="/app" replace state={{ notice: "unavailable" }} />;
  }
  return <Outlet />;
}
