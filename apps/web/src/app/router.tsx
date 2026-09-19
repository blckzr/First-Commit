import { lazy, Suspense } from "react";
import { createBrowserRouter } from "react-router";
import { RequireAdmin, RequireAuth, RequireLearner } from "./guards";
import { LearnerShell } from "./LearnerShell";
import { Landing } from "../routes/public/Landing";
import { SignUp } from "../routes/public/SignUp";
import { Home } from "../routes/learner/Home";
import { NotFound } from "../routes/public/NotFound";
import { Gallery } from "../routes/dev/Gallery";

/**
 * design.md §4.3 / §13.6 — four areas, separate layouts, separate code.
 * The admin area is lazily loaded so a learner's browser never downloads
 * admin screens.
 *
 * Only the three reference screens are wired so far; the rest of the route
 * tree is tracked in docs/task-tracker.md.
 */
const AdminArea = lazy(() => import("../routes/admin/AdminArea"));

/**
 * The component gallery is mounted only in development. `import.meta.env.DEV`
 * is statically replaced at build time, so the route and the module behind it
 * are dropped from a production bundle entirely.
 */
const devRoutes = import.meta.env.DEV
  ? [{ path: "/dev/components", element: <Gallery /> }]
  : [];

export const router = createBrowserRouter([
  { path: "/", element: <Landing /> },
  { path: "/signup", element: <SignUp /> },
  ...devRoutes,
  {
    element: <RequireAuth />,
    children: [
      {
        element: <RequireLearner />,
        children: [
          {
            path: "/app",
            element: <LearnerShell />,
            children: [{ index: true, element: <Home /> }],
          },
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
