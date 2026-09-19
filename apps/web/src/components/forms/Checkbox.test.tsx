import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Checkbox } from "./Checkbox";

describe("Checkbox", () => {
  /**
   * The visual box is a styled span driven by CSS sibling selectors, but the
   * native input stays in the DOM — so the space key, labels, and form
   * submission all work without JavaScript.
   */
  it("exposes a real checkbox with its label as the accessible name", () => {
    render(<Checkbox label="I agree to the Privacy Notice" />);
    expect(
      screen.getByRole("checkbox", { name: "I agree to the Privacy Notice" }),
    ).toBeInTheDocument();
  });

  it("toggles with the keyboard", async () => {
    render(<Checkbox label="Remember me" defaultChecked={false} />);
    const box = screen.getByRole("checkbox");
    box.focus();
    await userEvent.keyboard(" ");
    expect(box).toBeChecked();
  });
});
