import { expect, test } from "@playwright/test";
import { signedIn, stubRoadmap } from "./session";

/**
 * The roadmap where jsdom cannot go: real layout and a real resize between
 * breakpoints.
 *
 * design.md §11.3 — the spine with its branches on `md`/`lg`, a single
 * stacked column on `sm`, both one list laid out by CSS (First Commit
 * v2.dc.html); §12 — the page never scrolls sideways; §13.5 — state survives a
 * breakpoint change.
 */

const ROADMAP = "/app/roadmap/10000000-0000-0000-0000-000000000001";

test.beforeEach(async ({ page }) => {
  await signedIn(page);
  // The screen fetches its roadmap now, so the stub is at the network boundary
  // like every other one — the app runs its real query, parse and render.
  await stubRoadmap(page);
});

test("shows the roadmap once, whatever the width", async ({ page }) => {
  await page.goto(ROADMAP);

  // One accessible roadmap: the chart is the list, so there is no second copy
  // for the accessibility tree to pick up.
  const list = page.getByRole("list", { name: /Junior Web Developer roadmap/i });
  await expect(list).toHaveCount(1);
  await expect(list.getByRole("button", { name: /^Arrays and objects/ })).toHaveCount(1);
});

/** §11.1: one layout, chosen by width. Never a control the learner toggles. */
test("offers no view switcher", async ({ page }) => {
  await page.goto(ROADMAP);
  await expect(
    page.getByRole("button", { name: /desktop view|mobile view|switch view/i }),
  ).toHaveCount(0);
});

/** §12: layouts reflow without horizontal page scrolling. */
test("does not scroll the page sideways", async ({ page }) => {
  await page.goto(ROADMAP);
  await expect(page.getByRole("list", { name: /roadmap/i })).toBeAttached();

  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(overflows, "the roadmap page should not scroll sideways").toBe(false);
});

test.describe("keyboard", () => {
  /**
   * §12: arrow keys move between nodes, Enter opens the panel, focus moves in
   * and returns on close.
   */
  test("walks the roadmap and opens a node with the keyboard", async ({ page }) => {
    await page.goto(ROADMAP);

    const first = page.getByRole("button", { name: /^HTML, skill/ });
    await first.focus();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("button", { name: /^HTML basics/ })).toBeFocused();

    await page.keyboard.press("Enter");
    const panel = page.getByRole("complementary", { name: "Node details" });
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("heading", { name: "HTML basics" })).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect(page.getByRole("button", { name: /^HTML basics/ })).toBeFocused();
  });

  /** Roving tabindex: Tab leaves the roadmap instead of walking every node. */
  test("puts one tab stop on the roadmap, not one per node", async ({ page }) => {
    await page.goto(ROADMAP);
    await expect(page.getByRole("list", { name: /roadmap/i })).toBeAttached();

    const tabbable = await page
      .locator('[aria-label*="roadmap" i] button[tabindex="0"]')
      .count();
    expect(tabbable).toBe(1);
  });
});

/** §13.5: "selected node … live in shared state or the URL". */
test.describe("state across a resize", () => {
  test("keeps the open node when the layout changes", async ({ page }) => {
    await page.goto(ROADMAP);
    await page.getByRole("button", { name: /^Git basics/ }).click();
    await expect(page.getByRole("heading", { name: "Git basics" })).toBeVisible();

    await page.setViewportSize({ width: 360, height: 780 });
    await expect(page.getByRole("heading", { name: "Git basics" })).toBeVisible();

    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(page.getByRole("heading", { name: "Git basics" })).toBeVisible();

    expect(new URL(page.url()).searchParams.get("node")).toBe("m-git-basics");
  });

  test("opens straight to a node from a link", async ({ page }) => {
    await page.goto(`${ROADMAP}?node=m-arrays`);
    await expect(
      page.getByRole("complementary", { name: "Node details" }).getByRole("heading"),
    ).toHaveText("Arrays and objects");
  });
});

/**
 * §11.3: in a narrow chart the modules stack beneath their skill; once the
 * chart itself is 600px wide they branch left and right of it, as v2 draws it.
 * It is the chart's width that decides (a container query), so that is what
 * this measures, not the project's viewport.
 */
test("branches modules either side of the spine when there is room, and stacks them when not", async ({
  page,
}) => {
  await page.goto(ROADMAP);

  const box = async (name: RegExp) => {
    const b = await page.getByRole("button", { name }).boundingBox();
    if (!b) throw new Error(`no box for ${name}`);
    return b;
  };
  const skill = await box(/^HTML, skill/);
  const first = await box(/^HTML basics/);
  const second = await box(/^Forms and semantics/);

  const chart = await page.getByRole("list", { name: /Junior Web Developer roadmap/i }).boundingBox();
  if (!chart) throw new Error("no chart");

  if (chart.width < 600) {
    expect(first.y, "a module sits below its skill").toBeGreaterThan(skill.y + skill.height - 1);
    expect(second.y).toBeGreaterThan(first.y);
  } else {
    expect(first.x + first.width, "the first module is left of the spine").toBeLessThanOrEqual(skill.x);
    expect(second.x, "the second module is right of the spine").toBeGreaterThanOrEqual(
      skill.x + skill.width,
    );
  }
});
