import { expect, test } from "@playwright/test";

/**
 * The responsive contract from design.md §11.
 *
 * These are the checks that cannot be made in jsdom: they need real layout, a
 * real viewport, and a real resize. §11.4 names the four widths; §11.1 forbids
 * a view switcher; §13.5 says state survives a breakpoint change; §12 requires
 * reflow at 320px without horizontal page scrolling.
 */

const SM = { width: 360, height: 780 };
const MD = { width: 768, height: 900 };
const LG = { width: 1280, height: 900 };

test.describe("learner shell navigation", () => {
  test("shows exactly one main navigation, matching the width", async ({ page }, testInfo) => {
    await page.goto("/app");

    const width = page.viewportSize()!.width;
    const navs = page.getByRole("navigation", { name: "Main" });

    // Only one is in the accessibility tree at a time: the other is display:none,
    // which removes it. If both were ever visible, this fails.
    await expect(navs).toHaveCount(1);

    const nav = navs.first();
    await expect(nav).toBeVisible();

    const box = (await nav.boundingBox())!;
    const isBottomNav = box.y > page.viewportSize()!.height / 2;

    if (width < 640) {
      expect(isBottomNav, `at ${testInfo.project.name} the nav should sit at the bottom`).toBe(true);
    } else {
      expect(isBottomNav, `at ${testInfo.project.name} the nav should be a sidebar`).toBe(false);
    }
  });

  test("hides nav labels visually on the icon rail but keeps them for screen readers", async ({ page }) => {
    await page.goto("/app");
    const width = page.viewportSize()!.width;

    const nav = page.getByRole("navigation", { name: "Main" });

    // The accessible name must survive at EVERY width. Losing it on the rail
    // would leave a screen reader user with unlabelled links (design.md §12).
    const home = nav.getByRole("link", { name: "Home", exact: true });
    await expect(home).toHaveCount(1);

    const labelWidth = await home.locator("span").first().evaluate(
      (el) => el.getBoundingClientRect().width,
    );

    if (width >= 640 && width < 1024) {
      // Visually hidden: clipped to a pixel, not removed from the tree.
      expect(labelWidth, "the md rail should not show label text").toBeLessThanOrEqual(1);
    } else {
      expect(labelWidth, "sm and lg should render the label").toBeGreaterThan(10);
    }
  });

  test("capstone stays locked until the roadmap is finished", async ({ page }) => {
    await page.goto("/app");
    const capstone = page
      .getByRole("navigation", { name: "Main" })
      .getByRole("link", { name: "Capstone" });
    await expect(capstone).toHaveAttribute("title", "Finish your roadmap to unlock");
  });
});

test.describe("no horizontal scrolling", () => {
  for (const path of ["/", "/signup", "/app"]) {
    test(`${path} reflows without a horizontal scrollbar`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState("networkidle");

      const overflow = await page.evaluate(() => {
        const el = document.documentElement;
        return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
      });

      // A couple of pixels of slack for sub-pixel rounding.
      expect(
        overflow.scrollWidth,
        `${path} overflows by ${overflow.scrollWidth - overflow.clientWidth}px`,
      ).toBeLessThanOrEqual(overflow.clientWidth + 2);
    });
  }
});

test.describe("one layout, no view switcher (§11.1)", () => {
  test("offers no desktop/mobile toggle anywhere", async ({ page }) => {
    for (const path of ["/", "/signup", "/app"]) {
      await page.goto(path);
      const text = (await page.locator("body").innerText()).toLowerCase();
      for (const banned of ["desktop view", "mobile view", "switch to desktop", "switch to mobile"]) {
        expect(text, `${path} must not offer "${banned}"`).not.toContain(banned);
      }
    }
  });
});

/**
 * §13.5: "State survives breakpoint changes — selected node, editor content,
 * and active tab live in shared state or the URL, so resizing does not reset
 * them." This is the live-resize case §11.4 asks for.
 */
test.describe("state survives a live resize", () => {
  test.use({ viewport: LG });

  test("keeps typed input across sm, md, and lg", async ({ page }) => {
    await page.goto("/signup");

    const name = page.getByLabel("Full name");
    await name.fill("Jan Kevin Gerona");
    await page.getByRole("checkbox").check();

    for (const size of [SM, MD, LG, SM]) {
      await page.setViewportSize(size);
      await expect(name, `input lost its value at ${size.width}px`).toHaveValue(
        "Jan Kevin Gerona",
      );
      await expect(
        page.getByRole("checkbox"),
        `checkbox lost its state at ${size.width}px`,
      ).toBeChecked();
    }
  });

  test("navigation swaps between sidebar and bottom bar on resize", async ({ page }) => {
    await page.goto("/app");
    const navs = page.getByRole("navigation", { name: "Main" });

    await page.setViewportSize(LG);
    await expect(navs).toHaveCount(1);
    let box = (await navs.first().boundingBox())!;
    expect(box.y, "sidebar should start near the top at lg").toBeLessThan(LG.height / 2);

    await page.setViewportSize(SM);
    await expect(navs).toHaveCount(1);
    box = (await navs.first().boundingBox())!;
    expect(box.y, "nav should move to the bottom at sm").toBeGreaterThan(SM.height / 2);
  });
});

/** §12: layouts reflow at 320px without horizontal page scrolling. */
test.describe("320px reflow", () => {
  test.use({ viewport: { width: 320, height: 720 } });

  for (const path of ["/", "/signup", "/app"]) {
    test(`${path} reflows at 320px`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 2);
    });
  }
});
