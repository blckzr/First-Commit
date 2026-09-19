import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { SignUp } from "./SignUp";
import { expectNoAxeViolations } from "../../test/axe";

function renderSignUp() {
  return render(
    <MemoryRouter>
      <SignUp />
    </MemoryRouter>,
  );
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

  it("keeps the submit disabled until consent is given", async () => {
    renderSignUp();
    const submit = screen.getByRole("button", { name: "Create account" });
    expect(submit).toBeDisabled();

    await userEvent.click(screen.getByRole("checkbox"));
    expect(submit).toBeEnabled();
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
