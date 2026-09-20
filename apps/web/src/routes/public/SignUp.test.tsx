import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { render } from "../../test/render";
import { SignUp } from "./SignUp";
import { expectNoAxeViolations } from "../../test/axe";

/**
 * Accessibility and structure. The submit-and-navigate behaviour lives in
 * auth-flow.test.tsx, which stubs the API.
 */
function renderSignUp() {
  return render(<SignUp />);
}

describe("SignUp", () => {
  // design.md §5.2: the page creates an account and does nothing else — no
  // sidebar, no bottom navigation, no links into the app.
  it("shows no app navigation", () => {
    renderSignUp();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });

  it("labels every field", () => {
    renderSignUp();
    expect(screen.getByLabelText("Full name")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
  });

  it("guides the learner on the name field rather than just labelling it", () => {
    renderSignUp();
    expect(screen.getByLabelText("Full name")).toHaveAccessibleDescription(
      "Use the name you want on your certificates.",
    );
  });

  it("has no axe violations", async () => {
    const { container } = renderSignUp();
    await expectNoAxeViolations(container);
  });
});
