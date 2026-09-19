/**
 * TypeScript mirror of tokens.css (design.md §13.4).
 *
 * Only for values JavaScript genuinely needs — the roadmap chart's node
 * colours, breakpoint queries for useBreakpoint, and motion durations read by
 * animation code. Everything a stylesheet can reach belongs in tokens.css and
 * should be used through `var(--token)`, not from here.
 *
 * Change both files together.
 */

export const color = {
  lime400: "#CDE84B",
  lime500: "#C8E441",
  violet100: "#EDE5FB",
  violet300: "#C8B6E5",
  violet600: "#6F4FD1",
  violet700: "#553AA6",
  ink900: "#14161D",
  ink700: "#22242D",
  gray0: "#FFFFFF",
  gray100: "#F4F2F9",
  gray200: "#EEEAF8",
  gray300: "#E3DDEF",
  gray400: "#CFC8DE",
  gray500: "#9A93AB",
  gray600: "#6B6878",
  gray700: "#4A4857",

  /** Status text colours — all pass 4.5:1 on light surfaces. */
  verified: "#237045",
  error: "#C0392B",
  notice: "#8A5A00",
  info: "#2B6394",
  here: "#8A6100",
  ai: "#553AA6",

  /** Status fills and tints — never used as text. */
  verifiedTint: "#E2F1E7",
  errorTint: "#FBE7E4",
  noticeTint: "#FBF0DC",
  hereTint: "#FDF1C7",
  aiTint: "#EDE5FB",
} as const;

export const radius = {
  xs: 6,
  sm: 10,
  md: 14,
  lg: 20,
  xl: 28,
  pill: 999,
  card: 20,
  panel: 28,
  control: 12,
} as const;

export const space = {
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  7: 32,
  8: 40,
  9: 48,
  10: 64,
} as const;

export const duration = {
  fast: 120,
  base: 180,
  slow: 280,
  page: 420,
} as const;

export const easing = {
  out: "cubic-bezier(.22,.7,.25,1)",
  inOut: "cubic-bezier(.45,0,.35,1)",
} as const;

/** design.md §11.2 — sm < 640, md 640–1023, lg >= 1024. */
export const breakpoint = {
  md: "(min-width: 640px)",
  lg: "(min-width: 1024px)",
} as const;

export type Breakpoint = "sm" | "md" | "lg";
