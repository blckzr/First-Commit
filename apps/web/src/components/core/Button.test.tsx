import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button } from "./Button";

describe("Button", () => {
  it("renders its label as the accessible name", () => {
    render(<Button>Run tests</Button>);
    expect(screen.getByRole("button", { name: "Run tests" })).toBeInTheDocument();
  });

  it("does not fire onClick while disabled", async () => {
    const onClick = vi.fn();
    render(<Button disabled onClick={onClick}>Create account</Button>);
    await userEvent.click(screen.getByRole("button"), { pointerEventsCheck: 0 });
    expect(onClick).not.toHaveBeenCalled();
  });

  // design.md §7.1: the label changes to progress text while an action runs.
  it("swaps to the loading label and marks itself busy", () => {
    render(<Button loading loadingLabel="Running tests…">Run tests</Button>);
    const button = screen.getByRole("button");
    expect(button).toHaveTextContent("Running tests…");
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toBeDisabled();
  });

  // The icon is decorative — the label carries the meaning.
  it("hides its icon from assistive technology", () => {
    const { container } = render(<Button icon="arrow-right">Continue lesson</Button>);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByRole("button")).toHaveAccessibleName("Continue lesson");
  });
});
