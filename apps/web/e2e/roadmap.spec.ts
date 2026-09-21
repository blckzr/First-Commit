import { expect, test } from "@playwright/test";
import { signedIn } from "./session";

/**
 * The roadmap where jsdom cannot go: real layout, a real canvas, and a real
 * resize between breakpoints.
 *
 * design.md §11.3 — chart on `md`/`lg`, a single stacked column on `sm`;
 * §12 — the canvas pans inside its own region and the page never scrolls
 * sideways; §13.5 — state survives a breakpoint change.
 */

const ROADMAP = "/app/roadmap/10000000-0000-0000-0000-000000000001";

test.beforeEach(async ({ page }) => {
  await signedIn(page);
});

test("shows the roadmap once, whatever the width", async ({ page }) => {
  await page.goto(ROADMAP);

  // One accessible roadmap. On md and lg the canvas is aria-hidden, so the
  // chart must not add a second copy to the accessibility tree.
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

/** §12: "the roadmap canvas pans within its own region on md and lg". */
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
   * and returns on close. On `md` and `lg` the list is clipped, so this also
   * proves a keyboard user can drive a chart they cannot see the DOM of.
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

  /**
   * The chart's own nodes must stay out of the tab order: they have no
   * accessible name and sit inside an aria-hidden canvas, so a tab stop there
   * would be a control a screen reader cannot announce.
   */
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
    // Opened with the keyboard, because that works at every width: on md and lg
    // the list is clipped and a mouse user clicks the chart node instead.
    await page.getByRole("button", { name: /^Git basics/ }).focus();
    await page.keyboard.press("Enter");
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

/** §11.3: on sm the chart becomes one column; on md and lg it is the canvas. */
test("uses the stacked column on sm and the canvas above it", async ({ page }, testInfo) => {
  await page.goto(ROADMAP);
  await expect(page.getByRole("list", { name: /roadmap/i })).toBeAttached();

  const canvas = page.locator(".react-flow");
  if (testInfo.project.name.startsWith("360")) {
    await expect(canvas).toHaveCount(0);
    // The list itself is what the learner reads.
    await expect(page.getByRole("button", { name: /^HTML basics/ })).toBeVisible();
  } else {
    await expect(canvas).toHaveCount(1);
    // Clipped, not hidden: a hidden element cannot be focused (§12).
    await expect(page.getByRole("button", { name: /^HTML basics/ })).toBeAttached();
  }
});
