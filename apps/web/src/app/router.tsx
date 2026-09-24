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
  {
    path: "/verify/:code",
    element: (
      <Placeholder
        standalone
        title="Verify a certificate"
        section="section 5.15"
        purpose="Public and mobile-first, since it is usually opened by scanning a QR code."
      />
    ),
  },
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
  { path: "roadmaps", title: "My roadmaps", section: "section 5.12", purpose: "Switch between roadmaps, or start one for another career." },
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
  { path: "exercise/:id", title: "Coding exercise", section: "section 5.11", purpose: "Write code, run tests, and read the feedback grounded in those results." },
  { path: "capstone", title: "Capstone project", section: "section 5.14", purpose: "Choose a brief, connect a repository, and track milestones." },
  { path: "certificates", title: "Certificates", section: "section 5.15", purpose: "View, download, and share what has been earned." },
  { path: "resume", title: "Resume", section: "section 5.16", purpose: "Built only from verified skills, certificates, and completed projects." },
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
