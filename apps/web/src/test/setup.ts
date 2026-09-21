import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll } from "vitest";
import { server } from "./server";
import { installMatchMedia, installResizeObserver, resetViewport } from "./viewport";

/**
 * `onUnhandledRequest: "error"` on purpose: a component reaching an endpoint
 * nobody stubbed is a bug worth failing on, not something to silently let
 * through to the network.
 */
beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" });
  // jsdom has no matchMedia, and useBreakpoint needs one (design.md §13.5).
  installMatchMedia();
  installResizeObserver();
});

afterEach(() => {
  cleanup();
  server.resetHandlers();
  resetViewport();
});

afterAll(() => server.close());
