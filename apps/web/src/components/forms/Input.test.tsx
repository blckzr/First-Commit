import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Input } from "./Input";

describe("Input", () => {
  // design.md §12: visible labels, and errors linked to their field.
  it("associates its visible label with the control", () => {
    render(<Input label="Full name" name="fullName" />);
    expect(screen.getByLabelText("Full name")).toBeInTheDocument();
  });

  it("links an error to the field and marks it invalid", () => {
    render(
      <Input
        label="Weekly hours"
        name="hours"
        error="Enter weekly hours as a number between 1 and 40."
      />,
    );
    const field = screen.getByLabelText("Weekly hours");
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field).toHaveAccessibleDescription(
      "Enter weekly hours as a number between 1 and 40.",
    );
  });

  it("links a hint the same way when there is no error", () => {
    render(<Input label="Password" name="password" hint="At least 8 characters." />);
    expect(screen.getByLabelText("Password")).toHaveAccessibleDescription(
      "At least 8 characters.",
    );
    expect(screen.getByLabelText("Password")).not.toHaveAttribute("aria-invalid");
  });

  it("prefers the error over the hint when both are given", () => {
    render(
      <Input label="Email" name="email" hint="We'll never share it." error="That email is already registered." />,
    );
    expect(screen.getByLabelText("Email")).toHaveAccessibleDescription(
      "That email is already registered.",
    );
  });
});
