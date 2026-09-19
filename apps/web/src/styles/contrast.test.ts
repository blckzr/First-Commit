import { existsSync, readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { describe, expect, it } from "vitest";
import { AA_TEXT, AA_UI, contrastRatio, luminance, parseColor } from "./contrast";

/**
 * The contrast gate.
 *
 * design.md §12 commits to WCAG 2.2 AA, and §3.1's whole lime rule exists
 * because the design system's accent fails as text. That commitment needs to be
 * enforced by something that runs, not by a check somebody did once.
 *
 * This reads tokens.css straight from disk and resolves the `var()` chains
 * itself. It deliberately does not go through the browser: axe cannot measure
 * contrast under jsdom (no layout), and jsdom does not resolve custom
 * properties from a stylesheet — which is also why the gallery's live table
 * shows "—" in tests.
 */

// Vitest runs with cwd at the workspace root, and import.meta.url is not a
// file: URL under its transform, so resolve from cwd.
const cssPath = resolvePath(process.cwd(), "src/styles/tokens.css");
if (!existsSync(cssPath)) {
  throw new Error(`tokens.css not found at ${cssPath} — check the test's cwd assumption`);
}
const css = readFileSync(cssPath, "utf8");

function buildTokenMap(): Map<string, string> {
  const map = new Map<string, string>();
  for (const [, name, value] of css.matchAll(
    /(--[a-z0-9-]+)\s*:\s*([^;]+);/gi,
  )) {
    map.set(name, value.trim());
  }
  return map;
}

const tokens = buildTokenMap();

function resolve(name: string, depth = 0): string {
  const value = tokens.get(name);
  if (value === undefined) throw new Error(`token not defined: ${name}`);
  const nested = value.match(/^var\((--[a-z0-9-]+)\)$/i);
  if (nested && depth < 10) return resolve(nested[1], depth + 1);
  return value;
}

/** Every pair the components actually put together, with its required ratio. */
const PAIRS: [fg: string, bg: string, label: string, need: number][] = [
  ["--text-strong", "--surface-page", "headings on the page", AA_TEXT],
  ["--text-body", "--surface-page", "body on the page", AA_TEXT],
  ["--text-muted", "--surface-page", "muted on the page", AA_TEXT],
  ["--text-strong", "--surface-card", "headings on a card", AA_TEXT],
  ["--text-body", "--surface-card", "body on a card", AA_TEXT],
  ["--text-muted", "--surface-card", "muted on a card", AA_TEXT],
  ["--text-accent", "--surface-card", "accent phrase on a card", AA_TEXT],
  ["--text-accent", "--surface-page", "accent phrase on the page", AA_TEXT],
  ["--text-accent-on-dark", "--ink-900", "accent phrase on ink", AA_TEXT],
  ["--text-on-dark", "--ink-900", "text on ink", AA_TEXT],
  ["--text-on-dark-muted", "--ink-900", "muted text on ink", AA_TEXT],
  ["--text-on-lime", "--accent", "button label on lime", AA_TEXT],
  ["--verified", "--verified-tint", "verified badge", AA_TEXT],
  ["--error", "--error-tint", "error badge", AA_TEXT],
  ["--notice", "--notice-tint", "notice badge", AA_TEXT],
  ["--here", "--here-tint", "current badge", AA_TEXT],
  ["--ai", "--ai-tint", "AI badge", AA_TEXT],
  ["--verified", "--surface-card", "verified text on a card", AA_TEXT],
  ["--error", "--surface-card", "error text on a card", AA_TEXT],
  ["--violet-700", "--violet-200", "violet badge", AA_TEXT],
  ["--gray-500", "--ink-900", "code comments on ink", AA_TEXT],
  ["--code-plain", "--ink-900", "code text on ink", AA_TEXT],
  ["--focus-ring", "--surface-page", "focus ring on the page", AA_UI],
  ["--focus-ring", "--surface-card", "focus ring on a card", AA_UI],
  ["--border-control", "--surface-card", "control edge on a card", AA_UI],
  ["--border-control", "--surface-page", "control edge on the page", AA_UI],
  ["--border-accent", "--surface-card", "lime button edge on a card", AA_UI],
  ["--border-accent", "--surface-page", "lime button edge on the page", AA_UI],
  ["--border-accent", "--progress-track", "progress fill edge on its track", AA_UI],
];

describe("contrast utilities", () => {
  it("parses hex, short hex, and rgb", () => {
    expect(parseColor("#FFFFFF")).toEqual([255, 255, 255]);
    expect(parseColor("#fff")).toEqual([255, 255, 255]);
    expect(parseColor("rgb(20, 22, 29)")).toEqual([20, 22, 29]);
    expect(parseColor("rgba(20, 22, 29, .5)")).toEqual([20, 22, 29]);
    expect(parseColor("not a colour")).toBeNull();
  });

  it("computes known luminances", () => {
    expect(luminance("#FFFFFF")).toBeCloseTo(1, 5);
    expect(luminance("#000000")).toBeCloseTo(0, 5);
  });

  it("computes known ratios", () => {
    // The two anchors of the scale.
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 2);
    expect(contrastRatio("#FFFFFF", "#FFFFFF")).toBeCloseTo(1, 5);
    // Order does not matter.
    expect(contrastRatio("#553AA6", "#FFFFFF")).toBeCloseTo(
      contrastRatio("#FFFFFF", "#553AA6")!,
      10,
    );
  });

  it("returns null when a colour cannot be parsed", () => {
    expect(contrastRatio("nope", "#FFFFFF")).toBeNull();
  });
});

describe("token contrast (design.md §12)", () => {
  it.each(PAIRS)("%s on %s — %s meets %f:1", (fg, bg, _label, need) => {
    const ratio = contrastRatio(resolve(fg), resolve(bg));
    expect(ratio).not.toBeNull();
    expect(ratio!).toBeGreaterThanOrEqual(need);
  });

  /**
   * These are the reason §3.1's rules exist. If one of them starts passing,
   * a token moved and the rule text should be revisited.
   */
  it.each([
    ["--lime-600", "--gray-0", "lime as text on white"],
    ["--lime-700", "--gray-0", "the darkest lime as text on white"],
  ])("%s on %s fails as text — %s", (fg, bg) => {
    expect(contrastRatio(resolve(fg), resolve(bg))!).toBeLessThan(AA_TEXT);
  });
});
