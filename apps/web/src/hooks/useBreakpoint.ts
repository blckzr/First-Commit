import { useSyncExternalStore } from "react";
import { breakpoint } from "../styles/tokens";
import type { Breakpoint } from "../styles/tokens";

/**
 * design.md §13.5: layout changes use CSS first. This hook exists only where
 * the *structure* differs, never for styling, and is never tied to a user
 * toggle, stored preference, or user-agent sniffing.
 *
 * Nothing uses it today: the roadmap chart and its single column became one
 * list and a container query. It stays for the next structural case.
 */
function getBreakpoint(): Breakpoint {
  if (window.matchMedia(breakpoint.lg).matches) return "lg";
  if (window.matchMedia(breakpoint.md).matches) return "md";
  return "sm";
}

function subscribe(callback: () => void) {
  const lists = Object.values(breakpoint).map((q) => window.matchMedia(q));
  lists.forEach((l) => l.addEventListener("change", callback));
  return () => lists.forEach((l) => l.removeEventListener("change", callback));
}

export function useBreakpoint(): Breakpoint {
  return useSyncExternalStore(subscribe, getBreakpoint, () => "lg");
}
