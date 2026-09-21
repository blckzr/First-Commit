import type { Page } from "@playwright/test";

/**
 * Puts the API in a known state for a browser test.
 *
 * This replaced a `?as=` query override that used to live in `useSession`.
 * Stubbing at the network boundary is better: the app runs its real session
 * code — the query, the cookie-backed request, the guards reacting to what
 * comes back — instead of a branch that only exists in development.
 *
 * `**` on the front so it matches whatever `VITE_API_URL` points at.
 */

const API = "**/auth/me";

export const LEARNER = {
  id: "11111111-1111-1111-1111-111111111111",
  fullName: "Jan Kevin Gerona",
  email: "learner@example.com",
  role: "learner",
  emailVerified: true,
};

export const ADMIN = {
  ...LEARNER,
  id: "22222222-2222-2222-2222-222222222222",
  role: "admin",
};

export async function signedIn(
  page: Page,
  user: typeof LEARNER = LEARNER,
  onboardingStep: string | null = null,
): Promise<void> {
  await page.route(API, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ user, onboardingStep }),
    }),
  );
  await stubHome(page);
}

/**
 * Serves the fixture roadmap for any id.
 *
 * It is the same object the component tests use — one fixture, so a change to
 * the `Roadmap` type breaks both at once rather than leaving the slower suite
 * quietly testing an older shape.
 */
export async function stubRoadmap(page: Page): Promise<void> {
  const { mockRoadmap } = await import("../src/test/roadmap.js");
  await page.route("**/roadmaps/*", (route) => {
    if (route.request().isNavigationRequest()) return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ roadmap: mockRoadmap }),
    });
  });
}

/**
 * Serves Home's summary.
 *
 * Folded into `signedIn` because every `/app` page renders the learner shell
 * and many specs land on Home on the way somewhere else — an unstubbed request
 * there would fail the navigation for reasons unrelated to what is under test.
 */
async function stubHome(page: Page): Promise<void> {
  const { mockHome } = await import("../src/test/home.js");
  await page.route("**/home", (route) => {
    if (route.request().isNavigationRequest()) return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ home: mockHome }),
    });
  });
}

export async function signedOut(page: Page): Promise<void> {
  await page.route(API, (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ error: "You need to be signed in to do that." }),
    }),
  );
}
