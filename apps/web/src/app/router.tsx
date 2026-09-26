import { lazy, Suspense } from "react";
import { createBrowserRouter } from "react-router";
import {
  RedirectIfSignedIn,
  RequireAdmin,
  RequireAuth,
  RequireLearner,
  RequireOnboardingStep,
} from "./guards";
import { LearnerShell } from "./LearnerShell";
import { Landing } from "../routes/public/Landing";
import { SignUp } from "../routes/public/SignUp";
import { LogIn } from "../routes/public/LogIn";
import { ForgotPassword } from "../routes/public/ForgotPassword";
import { ResetPassword } from "../routes/public/ResetPassword";
import { NotFound } from "../routes/public/NotFound";
import { Home } from "../routes/learner/Home";
import { Roadmap } from "../routes/learner/Roadmap";
import { Roadmaps } from "../routes/learner/Roadmaps";
import { Certificates } from "../routes/learner/Certificates";
import { Resume } from "../routes/learner/Resume";
import { Verify } from "../routes/public/Verify";
import { RoadmapReview } from "../routes/learner/RoadmapReview";
import { Module } from "../routes/learner/Module";
import { Quiz } from "../routes/learner/Quiz";
import { TechnologyChoice } from "../routes/learner/TechnologyChoice";
import { About } from "../routes/onboarding/About";
import { Target } from "../routes/onboarding/Target";
import { Placement } from "../routes/onboarding/Placement";
import { Generating } from "../routes/onboarding/Generating";
import { Placeholder } from "../routes/Placeholder";
import { Gallery } from "../routes/dev/Gallery";

/**
 * design.md §4.3 / §13.6 — four areas, separate layouts, separate code.
 * The admin area is lazily loaded so a learner's browser never downloads
 * admin screens.
 *
 * Screens that are specified but not built render a named `Placeholder`, so
 * every route the navigation offers resolves to something. What is built and
 * what is a placeholder is tracked in docs/task-tracker.md.
 */
const AdminArea = lazy(() => import("../routes/admin/AdminArea"));

/**
 * §5.11's screen, lazy for the same reason the admin area is: it carries
 * CodeMirror, which is most of a megabyte, and a learner reading a lesson
 * should not download an editor they are not using. Measured at 1.19MB in the
 * main chunk before this split.
 */
const Exercise = lazy(() =>
  import("../routes/learner/Exercise").then((m) => ({ default: m.Exercise })),
);

/**
 * The component gallery is mounted only in development. `import.meta.env.DEV`
 * is statically replaced at build time, so the route and the module behind it
 * are dropped from a production bundle.
 */
const devRoutes = import.meta.env.DEV
  ? [{ path: "/dev/components", element: <Gallery /> }]
  : [];

/**
 * §4.3: "Anyone signed in | `/login` or `/signup` | Sent to their own area."
 *
 * Only these two. Password reset stays reachable while signed in — §5.3's reset
 * clears every session, so someone using it has a reason to, and bouncing them
 * away from it would be the wrong moment to be clever.
 */
const signedOutOnlyRoutes = [
  { path: "/signup", element: <SignUp /> },
  { path: "/login", element: <LogIn /> },
];

/** Public, outside every shell (design.md §5.3). */
const publicRoutes = [
  { path: "/", element: <Landing /> },
  { element: <RedirectIfSignedIn />, children: signedOutOnlyRoutes },
  { path: "/forgot-password", element: <ForgotPassword /> },
  { path: "/reset-password", element: <ResetPassword /> },
  /**
   * §5.15's verification page. Public on purpose — it is opened by a stranger
   * from a link or a QR code, so it sits outside every shell and offers nothing
   * to sign into.
   */
  { path: "/verify/:code", element: <Verify /> },
  /** A bare `/verify` answers the same way an unknown code does. */
  { path: "/verify", element: <Verify /> },
];

/** design.md §5.4 — one page per step, each with its own address. */
const onboardingRoutes = [
  { path: "/onboarding/about", element: <About /> },
  { path: "/onboarding/target", element: <Target /> },
  { path: "/onboarding/placement", element: <Placement /> },
  { path: "/onboarding/generating", element: <Generating /> },
];

/** design.md §5 — the learner app, inside LearnerShell. */
const learnerRoutes = [
  { index: true, element: <Home /> },
  { path: "roadmaps", element: <Roadmaps /> },
  { path: "roadmap/:id", element: <Roadmap /> },
  // §5.5, and §5.4's flow: onboarding ends here rather than at Home. It stays
  // reachable afterwards — adjusting weekly hours is not a one-time act.
  { path: "roadmap/:id/review", element: <RoadmapReview /> },
  // §5.8 specifies this screen; §4.3 gives it no address. Nested under the
  // roadmap because the answer belongs to a roadmap, not to the track — the
  // same decision on two roadmaps is two separate choices.
  { path: "roadmap/:id/technology/:decisionId", element: <TechnologyChoice /> },
  { path: "explore", title: "Explore modules", section: "section 5.13", purpose: "Search and take any published module, inside a roadmap or not." },
  { path: "module/:id", element: <Module /> },
  // §4.3 has no address for the quiz; §5.10 specifies the screen. Recorded in
  // docs/task-tracker.md alongside the technology choice, which has the same gap.
  { path: "quiz/:id", element: <Quiz /> },
  {
    path: "exercise/:id",
    element: (
      <Suspense fallback={<div role="status">Loading the exercise…</div>}>
        <Exercise />
      </Suspense>
    ),
  },
  { path: "capstone", title: "Capstone project", section: "section 5.14", purpose: "Choose a brief, connect a repository, and track milestones." },
  { path: "certificates", element: <Certificates /> },
  { path: "resume", element: <Resume /> },
  { path: "notifications", title: "Notifications", section: "section 5.17", purpose: "Module updates, roadmap changes, milestones, and certificates." },
  { path: "settings", title: "Settings", section: "section 5.18", purpose: "Profile, password, GitHub connection, and deleting your data." },
].map((route) =>
  "element" in route
    ? route
    : {
        path: route.path,
        element: (
          <Placeholder title={route.title} section={route.section} purpose={route.purpose} />
        ),
      },
);

export const router = createBrowserRouter([
  ...publicRoutes,
  ...devRoutes,
  {
    element: <RequireAuth />,
    children: [
      {
        element: <RequireLearner needsOnboarding />,
        children: [{ element: <RequireOnboardingStep />, children: onboardingRoutes }],
      },
      {
        element: <RequireLearner />,
        children: [
          { path: "/app", element: <LearnerShell />, children: learnerRoutes },
        ],
      },
      {
        element: <RequireAdmin />,
        children: [
          {
            // AdminArea owns its own nested routes, so the whole admin tree
            // lives in the lazy chunk rather than only its entry point.
            path: "/admin/*",
            element: (
              <Suspense fallback={<div role="status">Loading…</div>}>
                <AdminArea />
              </Suspense>
            ),
          },
        ],
      },
    ],
  },
  { path: "*", element: <NotFound /> },
]);
