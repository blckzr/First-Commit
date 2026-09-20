import type { ReactElement } from "react";
import { render as rtlRender } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { Providers } from "../app/providers";

/**
 * Renders inside the same providers the app uses, with a query client built
 * fresh for each test.
 *
 * Retries are off here: a test asserting an error state should see it on the
 * first attempt rather than waiting out the app's retry policy.
 */
export function render(ui: ReactElement, { route = "/" }: { route?: string } = {}) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });

  return {
    client,
    ...rtlRender(
      <Providers client={client}>
        <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
      </Providers>,
    ),
  };
}
