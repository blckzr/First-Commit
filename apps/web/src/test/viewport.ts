import type { Breakpoint } from "../styles/tokens";

/**
 * A `matchMedia` for jsdom, which has none.
 *
 * `useBreakpoint` is the one place design.md §13.5 allows JavaScript to decide
 * layout, so it has to work in tests rather than throw. This answers the two
 * queries `tokens.ts` defines from a width the test sets, and notifies
 * listeners when that width changes — which is what makes "state survives a
 * breakpoint change" testable without a browser.
 *
 * Widths are the four §11.4 names.
 */
const WIDTHS: Record<Breakpoint, number> = { sm: 360, md: 768, lg: 1280 };

type Listener = () => void;
const listeners = new Set<Listener>();
let width = WIDTHS.sm;

function matches(query: string): boolean {
  const min = /\(min-width:\s*(\d+)px\)/.exec(query);
  return min ? width >= Number(min[1]) : false;
}

export function installMatchMedia(): void {
  window.matchMedia = (query: string) =>
    ({
      media: query,
      get matches() {
        return matches(query);
      },
      onchange: null,
      addEventListener: (_: string, fn: Listener) => listeners.add(fn),
      removeEventListener: (_: string, fn: Listener) => listeners.delete(fn),
      addListener: (fn: Listener) => listeners.add(fn),
      removeListener: (fn: Listener) => listeners.delete(fn),
      dispatchEvent: () => true,
    }) as unknown as MediaQueryList;
}

/**
 * jsdom has no ResizeObserver either, and React Flow measures its container
 * with one. A no-op is enough: jsdom reports every box as 0x0 anyway, so the
 * chart is checked for real in Playwright, not here.
 */
export function installResizeObserver(): void {
  if ("ResizeObserver" in globalThis) return;
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

/** Puts the test at a breakpoint. Call before rendering, or to resize live. */
export function setBreakpoint(name: Breakpoint): void {
  width = WIDTHS[name];
  for (const fn of [...listeners]) fn();
}

/** Back to the default between tests, so one test cannot leak into the next. */
export function resetViewport(): void {
  width = WIDTHS.sm;
  listeners.clear();
}
