import { lazy, Suspense } from "react";
import { createBrowserRouter } from "react-router";
import { RequireAdmin, RequireAuth, RequireLearner } from "./guards";
import { LearnerShell } from "./LearnerShell";
import { Landing } from "../routes/public/Landing";
import { SignUp } from "../routes/public/SignUp";
import { LogIn } from "../routes/public/LogIn";
import { NotFound } from "../routes/public/NotFound";
import { Home } from "../routes/learner/Home";
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

/** Public, outside every shell (design.md §5.3). */
const publicRoutes = [
  { path: "/", element: <Landing /> },
  { path: "/signup", element: <SignUp /> },
  { path: "/login", element: <LogIn /> },
  {
    path: "/forgot-password",
    element: (
      <Placeholder
        standalone
        title="Forgot password"
        section="section 5.3"
        purpose="Requests a reset link. The reply never reveals whether an email is registered."
      />
    ),
  },
  {
    path: "/reset-password",
    element: (
      <Placeholder
        standalone
        title="Set a new password"
        section="section 5.3"
        purpose="Opened from a single-use link that expires."
      />
    ),
  },
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
  { path: "about", title: "About you", purpose: "Four to six questions on experience, goals, and weekly hours." },
  { path: "target", title: "Target position", purpose: "The job the learner is working toward." },
  { path: "placement", title: "Placement", purpose: "Finds what the learner already knows, so the roadmap can skip it. No time limit." },
  { path: "generating", title: "Building your roadmap", purpose: "Waits for the Roadmap AI, then moves on by itself." },
].map(({ path, title, purpose }) => ({
  path: `/onboarding/${path}`,
  element: <Placeholder standalone title={title} section="section 5.4" purpose={purpose} />,
}));

/** design.md §5 — the learner app, inside LearnerShell. */
const learnerRoutes = [
  { index: true, element: <Home /> },
  { path: "roadmaps", title: "My roadmaps", section: "section 5.12", purpose: "Switch between roadmaps, or start one for another career." },
  { path: "roadmap/:id", title: "Roadmap", section: "section 5.7", purpose: "The roadmap chart: progress, what is next, and what unlocks each module." },
  { path: "modules", title: "Explore modules", section: "section 5.13", purpose: "Search and take any published module, inside a roadmap or not." },
  { path: "module/:id", title: "Module", section: "section 5.9", purpose: "Lessons in order, with the quiz and exercise at the end." },
  { path: "exercise/:id", title: "Coding exercise", section: "section 5.11", purpose: "Write code, run tests, and read the feedback grounded in those results." },
  { path: "capstone", title: "Capstone project", section: "section 5.14", purpose: "Choose a brief, connect a repository, and track milestones." },
  { path: "certificates", title: "Certificates", section: "section 5.15", purpose: "View, download, and share what has been earned." },
  { path: "resume", title: "Resume", section: "section 5.16", purpose: "Built only from verified skills, certificates, and completed projects." },
  { path: "notifications", title: "Notifications", section: "section 5.17", purpose: "Module updates, roadmap changes, milestones, and certificates." },
  { path: "settings", title: "Settings", section: "section 5.18", purpose: "Profile, password, GitHub connection, and deleting your data." },
].map((route) =>
  "index" in route
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
        children: onboardingRoutes,
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
