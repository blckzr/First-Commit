import { expect, test } from "@playwright/test";
import { ADMIN, LEARNER as LEARNER_ONBOARDING_USER, signedIn, signedOut } from "./session";

/**
 * Area separation and route guards, from design.md §4.3 and §13.6.
 *
 * The API is stubbed at the network boundary (see ./session), so the app runs
 * its real session query and the guards react to a real response.
 * **None of this is a security test** — the guards decide what renders, and the
 * Express API decides what data comes back (docs/database-schema.md §6). When
 * the API exists, the real versions of these live in its endpoint tests.
 */

test.describe("learner area", () => {
  test("renders the learner shell and no admin navigation", async ({ page }) => {
    await signedIn(page);
    await page.goto("/app");
    await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Admin" })).toHaveCount(0);
  });

  test("contains no links into /admin", async ({ page }) => {
    await signedIn(page);
    await page.goto("/app");
    const adminLinks = page.locator('a[href^="/admin"]');
    await expect(adminLinks).toHaveCount(0);
  });

  test("every navigation item resolves to a screen", async ({ page }) => {
    await signedIn(page);
    await page.goto("/app");
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav.getByRole("link").first()).toBeVisible();

    // Below 640px the bar carries four links plus a "More" disclosure holding
    // the rest (design.md §4.2). Open it so its links are counted too.
    const more = nav.locator("details");
    if (await more.count()) {
      await more.locator("summary").click();
      await expect(more).toHaveAttribute("open", "");
    }

    const links = nav.getByRole("link");
    const hrefs = await links.evaluateAll((els) =>
      els.map((e) => (e as HTMLAnchorElement).getAttribute("href")!),
    );
    // Six destinations either way: six in the sidebar, or four plus three in
    // More (Home appears once).
    expect(new Set(hrefs).size).toBeGreaterThanOrEqual(6);

    for (const href of new Set(hrefs)) {
      await page.goto(href);
      // A dead link falls through to the catch-all, so assert we did NOT land there.
      await expect(
        page.getByRole("heading", { name: /couldn't find that page/i }),
        `${href} fell through to the not-found page`,
      ).toHaveCount(0);
      await expect(
        page.getByRole("heading", { level: 1 }),
        `${href} should render a heading`,
      ).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
    }
  });

  test("a learner opening an admin page is sent back to /app", async ({ page }) => {
    await signedIn(page);
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/app$/);
  });
});

test.describe("admin area", () => {
  test("renders the admin shell with its persistent indicator", async ({ page }) => {
    await signedIn(page, ADMIN);
    await page.goto("/admin");
    await expect(page.getByRole("navigation", { name: "Admin" })).toBeVisible();
    await expect(page.getByText("Admin", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Overview", level: 1 })).toBeVisible();
  });

  test("groups the sidebar by purpose", async ({ page }) => {
    await signedIn(page, ADMIN);
    await page.goto("/admin");
    const nav = page.getByRole("navigation", { name: "Admin" });
    for (const group of ["Content", "Quality", "Platform"]) {
      await expect(nav.getByText(group, { exact: true })).toBeVisible();
    }
  });

  test("contains no links into /app", async ({ page }) => {
    await signedIn(page, ADMIN);
    await page.goto("/admin");
    await expect(page.locator('a[href^="/app"]')).toHaveCount(0);
  });

  test("every sidebar item resolves to a screen", async ({ page }) => {
    await signedIn(page, ADMIN);
    await page.goto("/admin");
    const links = page.getByRole("navigation", { name: "Admin" }).getByRole("link");
    // The admin area is a lazy chunk, and evaluateAll does not auto-wait —
    // assert the count first so Playwright retries until the chunk has loaded.
    await expect(links).toHaveCount(11);

    const hrefs = await links.evaluateAll((els) =>
      els.map((e) => (e as HTMLAnchorElement).getAttribute("href")!),
    );
    for (const href of hrefs) {
      await page.goto(href);
      await expect(
        page.getByRole("heading", { level: 1 }),
        `${href} should render a heading`,
      ).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Admin" })).toBeVisible();
    }
  });

  test("renders no learner navigation", async ({ page }) => {
    await signedIn(page, ADMIN);
    await page.goto("/admin");
    await expect(page.getByRole("navigation", { name: "Main" })).toHaveCount(0);
  });
});

test.describe("onboarding guard", () => {
  test("an unfinished learner is sent to their current step, and it renders", async ({ page }) => {
    await signedIn(page, LEARNER_ONBOARDING_USER, "placement");
    await page.goto("/app");
    await expect(page).toHaveURL(/\/onboarding\/placement$/);
    await expect(page.getByRole("heading", { name: "Placement", level: 1 })).toBeVisible();
  });
});

test.describe("signed out", () => {
  test("a protected page redirects to /login, and it renders", async ({ page }) => {
    await signedOut(page);
    await page.goto("/app");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { name: "Log in", level: 1 })).toBeVisible();
  });

  test("public pages stay reachable", async ({ page }) => {
    await signedOut(page);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
});
