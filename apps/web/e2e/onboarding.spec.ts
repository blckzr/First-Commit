import { expect, test, type Page, type Route } from "@playwright/test";
import { signedIn } from "./session";

/**
 * Onboarding as a browser actually runs it (design.md §5.4).
 *
 * jsdom already covers what each screen sends and says. What it cannot cover is
 * the flow across four real page addresses, the chrome §5.4 forbids, and
 * whether the pages hold together at the widths §11.4 names.
 */

const PATH = {
  id: "33333333-3333-3333-3333-333333333333",
  slug: "junior-web-developer",
  title: "Junior Web Developer",
  description: "Build websites and web apps for a company or clients.",
};

const STEPS = ["about", "target", "placement", "generating", "done"];

/**
 * The API paths are also page addresses — `/onboarding/about` is both an
 * endpoint and a route the browser navigates to. A glob matches both, so a
 * document request has to fall through or the page would be served JSON.
 */
async function stub(page: Page, path: string, body: (route: Route) => unknown) {
  await page.route(`**${path}`, (route) => {
    if (route.request().isNavigationRequest()) return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body(route)),
    });
  });
}

/**
 * A stateful stand-in for the onboarding endpoints: saving a step advances the
 * state the next page reads, so the flow moves the way it would against the
 * real API rather than replaying one fixed response.
 */
async function onboardingApi(page: Page, start = "about") {
  const state = { step: start, careerPathId: null as string | null };

  await stub(page, "/auth/me", () => ({
    user: {
      id: "11111111-1111-1111-1111-111111111111",
      fullName: "Jan Kevin Gerona",
      email: "learner@example.com",
      role: "learner",
      emailVerified: true,
    },
    onboardingStep: state.step === "done" ? null : state.step,
  }));

  await stub(page, "/career-paths", () => ({ careerPaths: [PATH] }));

  await stub(page, "/onboarding", () => ({
    step: state.step,
    about: null,
    careerPathId: state.careerPathId,
  }));

  for (const [from, to] of [
    ["about", "target"],
    ["target", "placement"],
    ["placement", "generating"],
  ] as const) {
    await stub(page, `/onboarding/${from}`, () => {
      if (STEPS.indexOf(state.step) < STEPS.indexOf(to)) state.step = to;
      if (from === "target") state.careerPathId = PATH.id;
      return { step: state.step, next: `/onboarding/${to}` };
    });
  }

  return state;
}

test.describe("the four steps", () => {
  test("walks from about to generating, one address per step", async ({ page }) => {
    await onboardingApi(page);
    await page.goto("/onboarding/about");

    await page.getByLabel("I've tried a bit — a tutorial or two").click();
    await page.getByLabel("A job at a company").click();
    await page.getByLabel("Hours a week you can study").fill("10");
    await page.getByRole("button", { name: /continue/i }).click();

    await expect(page).toHaveURL(/\/onboarding\/target$/);
    await page.getByRole("button", { name: PATH.title }).click();
    await page.getByRole("button", { name: /continue/i }).click();

    await expect(page).toHaveURL(/\/onboarding\/placement$/);
    await page.getByRole("button", { name: /continue/i }).click();

    await expect(page).toHaveURL(/\/onboarding\/generating$/);
    await expect(page.getByRole("status")).toContainText(/under a minute/i);
  });

  /**
   * §5.4: "Onboarding pages show no app navigation. The only way out is
   * finishing, or the profile menu's Log out." A stray link into /app here
   * would drop a learner into an app they have no roadmap for.
   */
  test("shows no app navigation and no way into /app", async ({ page }) => {
    await onboardingApi(page);

    for (const step of ["about", "target", "placement", "generating"]) {
      await page.goto(`/onboarding/${step}`);
      await expect(page.getByRole("navigation")).toHaveCount(0);
      await expect(page.locator('a[href^="/app"]')).toHaveCount(0);
      await expect(page.locator('a[href^="/admin"]')).toHaveCount(0);
    }
  });

  /** §5.4: jumping ahead lands on the first unfinished step, at every width. */
  test("sends a learner who jumps ahead back to their step", async ({ page }) => {
    await onboardingApi(page, "about");
    await page.goto("/onboarding/placement");
    await expect(page).toHaveURL(/\/onboarding\/about$/);
  });

  /** §12: reflow at 320px with no horizontal page scrolling. */
  test("reflows without sideways scroll", async ({ page }) => {
    await onboardingApi(page, "target");
    await page.goto("/onboarding/target");
    await expect(page.getByRole("button", { name: PATH.title })).toBeVisible();

    const scrolls = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(scrolls, "the onboarding page should not scroll sideways").toBe(false);
  });

  /**
   * §12: "a visible 2px focus outline everywhere". It has to be a real Tab —
   * `:focus-visible` is about how focus arrived, so a programmatic `.focus()`
   * would measure a state a keyboard user never sees.
   */
  test("every control on the step shows a focus ring when tabbed to", async ({ page }) => {
    await onboardingApi(page, "target");
    await page.goto("/onboarding/target");
    await expect(page.getByRole("button", { name: PATH.title })).toBeVisible();

    const seen: string[] = [];
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press("Tab");
      const focused = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        const style = getComputedStyle(el);
        return {
          name: el.textContent?.trim().slice(0, 30) ?? el.tagName,
          visible: el.matches(":focus-visible"),
          outline: parseFloat(style.outlineWidth),
          style: style.outlineStyle,
        };
      });
      if (!focused) break;
      if (seen.includes(focused.name)) break;
      seen.push(focused.name);

      expect(focused.visible, `${focused.name} should be focus-visible`).toBe(true);
      expect(focused.outline, `${focused.name} has no 2px ring`).toBeGreaterThanOrEqual(2);
      expect(focused.style, `${focused.name} has no visible outline`).not.toBe("none");
    }

    // The card and Back and Continue are the three, so anything less means a
    // control dropped out of the tab order.
    expect(seen.length, `tab order reached only ${seen.join(", ")}`).toBeGreaterThanOrEqual(3);
  });
});

test.describe("finishing", () => {
  /**
   * The worker writes the roadmap and clears the step; the browser only reads
   * it. Once it is clear, the guard moves the learner into the app — nothing
   * on this screen decides that.
   */
  test("leaves for the app once the API says onboarding is done", async ({ page }) => {
    await signedIn(page, undefined, null);
    await page.route("**/onboarding", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ step: "done", about: null, careerPathId: null }),
      }),
    );

    await page.goto("/onboarding/generating");
    await expect(page).toHaveURL(/\/app$/);
  });
});
