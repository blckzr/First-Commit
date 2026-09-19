import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProgressBar } from "./ProgressBar";

describe("ProgressBar", () => {
  // design.md §7: a progress bar is always paired with text.
  it("reports its value through the progressbar role", () => {
    render(<ProgressBar value={37.5} label="6 of 16 modules passed" />);
    const bar = screen.getByRole("progressbar", { name: "6 of 16 modules passed" });
    expect(bar).toHaveAttribute("aria-valuenow", "38");
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "100");
  });

  it("shows the same information as text", () => {
    render(<ProgressBar value={37.5} label="6 of 16 modules passed" showValue />);
    expect(screen.getByText("6 of 16 modules passed")).toBeInTheDocument();
    expect(screen.getByText("38%")).toBeInTheDocument();
  });

  it.each([
    [-20, "0"],
    [150, "100"],
  ])("clamps %s to %s", (value, expected) => {
    render(<ProgressBar value={value} label="Progress" />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", expected);
  });
});
