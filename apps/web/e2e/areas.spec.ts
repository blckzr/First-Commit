import { expect, test } from "@playwright/test";

/**
 * Area separation and route guards, from design.md §4.3 and §13.6.
 *
 * These exercise the dev session override (`?as=`) in features/auth/useSession.
 * **None of this is a security test** — the guards decide what renders, and the
 * Express API decides what data comes back (docs/database-schema.md §6). When
 * the API exists, the real versions of these live in its endpoint tests.
 */

test.describe("learner area", () => {
  test("renders the learner shell and no admin navigation", async ({ page }) => {
    await page.goto("/app?as=learner");
    await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Admin" })).toHaveCount(0);
  });

  test("contains no links into /admin", async ({ page }) => {
    await page.goto("/app?as=learner");
    const adminLinks = page.locator('a[href^="/admin"]');
    await expect(adminLinks).toHaveCount(0);
  });

  test("a learner opening an admin page is sent back to /app", async ({ page }) => {
    await page.goto("/admin?as=learner");
    await expect(page).toHaveURL(/\/app$/);
  });
});

test.describe("admin area", () => {
  test("renders the admin shell with its persistent indicator", async ({ page }) => {
    await page.goto("/admin?as=admin");
    await expect(page.getByRole("navigation", { name: "Admin" })).toBeVisible();
    await expect(page.getByText("Admin", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Overview", level: 1 })).toBeVisible();
  });

  test("groups the sidebar by purpose", async ({ page }) => {
    await page.goto("/admin?as=admin");
    const nav = page.getByRole("navigation", { name: "Admin" });
    for (const group of ["Content", "Quality", "Platform"]) {
      await expect(nav.getByText(group, { exact: true })).toBeVisible();
    }
  });

  test("contains no links into /app", async ({ page }) => {
    await page.goto("/admin?as=admin");
    await expect(page.locator('a[href^="/app"]')).toHaveCount(0);
  });

  test("every sidebar item resolves to a screen", async ({ page }) => {
    await page.goto("/admin?as=admin");
    const links = page.getByRole("navigation", { name: "Admin" }).getByRole("link");
    // The admin area is a lazy chunk, and evaluateAll does not auto-wait —
    // assert the count first so Playwright retries until the chunk has loaded.
    await expect(links).toHaveCount(11);

    const hrefs = await links.evaluateAll((els) =>
      els.map((e) => (e as HTMLAnchorElement).getAttribute("href")!),
    );
    for (const href of hrefs) {
      await page.goto(`${href}?as=admin`);
      await expect(
        page.getByRole("heading", { level: 1 }),
        `${href} should render a heading`,
      ).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Admin" })).toBeVisible();
    }
  });

  test("renders no learner navigation", async ({ page }) => {
    await page.goto("/admin?as=admin");
    await expect(page.getByRole("navigation", { name: "Main" })).toHaveCount(0);
  });
});

test.describe("onboarding guard", () => {
  test("an unfinished learner is sent to their current step", async ({ page }) => {
    await page.goto("/app?as=onboarding");
    await expect(page).toHaveURL(/\/onboarding\/placement$/);
  });
});

test.describe("signed out", () => {
  test("a protected page redirects to /login", async ({ page }) => {
    await page.goto("/app?as=signedout");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("public pages stay reachable", async ({ page }) => {
    await page.goto("/?as=signedout");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
});
