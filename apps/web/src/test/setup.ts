import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll } from "vitest";
import { server } from "./server";

/**
 * `onUnhandledRequest: "error"` on purpose: a component reaching an endpoint
 * nobody stubbed is a bug worth failing on, not something to silently let
 * through to the network.
 */
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));

afterEach(() => {
  cleanup();
  server.resetHandlers();
});

afterAll(() => server.close());
