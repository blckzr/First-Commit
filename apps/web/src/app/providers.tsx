import { QueryClientProvider } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { createQueryClient } from "../api/queryClient";

/**
 * design.md §13.2 lists `app/providers.tsx`. Everything the tree needs to be
 * wrapped in goes here, so tests can build the same tree with their own client.
 */
export function Providers({
  children,
  client,
}: {
  children: ReactNode;
  client?: QueryClient;
}) {
  return (
    <QueryClientProvider client={client ?? createQueryClient()}>{children}</QueryClientProvider>
  );
}
