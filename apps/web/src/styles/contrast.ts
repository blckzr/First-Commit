/**
 * WCAG 2.x relative luminance and contrast ratio.
 *
 * Used by the component gallery to show live ratios for the token pairs, so a
 * token change shows its accessibility consequence immediately rather than at
 * review time. design.md §12 sets the targets: 4.5:1 for body text, 3:1 for
 * large text and UI components.
 */

export const AA_TEXT = 4.5;
export const AA_LARGE_TEXT = 3;
export const AA_UI = 3;

/** Accepts `#rgb`, `#rrggbb`, or any `rgb()` / `rgba()` string. */
export function parseColor(input: string): [number, number, number] | null {
  const value = input.trim();

  const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const h = hex[1];
    const full =
      h.length === 3
        ? h.split("").map((c) => c + c).join("")
        : h;
    return [
      parseInt(full.slice(0, 2), 16),
      parseInt(full.slice(2, 4), 16),
      parseInt(full.slice(4, 6), 16),
    ];
  }

  const rgb = value.match(/^rgba?\(([^)]+)\)$/i);
  if (rgb) {
    const parts = rgb[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    if (parts.length >= 3 && parts.slice(0, 3).every((n) => !Number.isNaN(n))) {
      return [parts[0], parts[1], parts[2]];
    }
  }

  return null;
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function luminance(color: string): number | null {
  const rgb = parseColor(color);
  if (!rgb) return null;
  const [r, g, b] = rgb.map(channel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contrast ratio between two colours, 1 to 21. Null if either is unparseable. */
export function contrastRatio(a: string, b: string): number | null {
  const la = luminance(a);
  const lb = luminance(b);
  if (la === null || lb === null) return null;
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/** Read a CSS custom property from :root and resolve it to a colour string. */
export function tokenValue(name: string): string {
  if (typeof window === "undefined") return "";
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}

/**
 * Resolve a token that may itself be `var(--other)`, following the chain.
 * Browsers already resolve these in getComputedStyle for most cases, but a
 * custom property whose value is another `var()` comes back verbatim.
 */
export function resolveToken(name: string, depth = 0): string {
  const value = tokenValue(name);
  const nested = value.match(/^var\((--[a-z0-9-]+)\)$/i);
  if (nested && depth < 10) return resolveToken(nested[1], depth + 1);
  return value;
}
