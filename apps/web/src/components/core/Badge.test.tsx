import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Badge } from "./Badge";

describe("Badge", () => {
  /**
   * design.md §8: every status is icon AND text AND colour. A status badge
   * that carried colour alone would be unreadable to anyone who cannot
   * distinguish it — this asserts the text is always present.
   */
  it("states the status in text, not only in colour", () => {
    render(<Badge tone="verified" icon="check">Passed, 88%</Badge>);
    expect(screen.getByText("Passed, 88%")).toBeInTheDocument();
  });

  it("renders the status icon as decoration beside that text", () => {
    const { container } = render(
      <Badge tone="here" icon="circle-dot">You are here</Badge>,
    );
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("You are here")).toBeInTheDocument();
  });
});
