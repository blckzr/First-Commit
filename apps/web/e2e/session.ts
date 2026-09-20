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
