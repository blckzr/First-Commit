import { describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { render } from "../../test/render";
import { ADMIN, api, LEARNER } from "../../test/server";
import { SignUp } from "./SignUp";
import { LogIn } from "./LogIn";

const navigate = vi.fn();
vi.mock("react-router", async () => {
  const actual = await vi.importActual<typeof import("react-router")>("react-router");
  return { ...actual, useNavigate: () => navigate };
});

async function fillSignUp() {
  await userEvent.type(screen.getByLabelText("Full name"), LEARNER.fullName);
  await userEvent.type(screen.getByLabelText("Email"), LEARNER.email);
  await userEvent.type(screen.getByLabelText("Password"), "a-good-password");
  await userEvent.click(screen.getByRole("checkbox"));
}

describe("Sign up", () => {
  it("creates the account and follows where the API says to go", async () => {
    api.signUpSucceeds("/onboarding/about");
    render(<SignUp />);

    await fillSignUp();
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/onboarding/about"));
  });

  /**
   * design.md §5.2: "That email is already registered. Log in instead." goes
   * under the email field, where the learner is looking.
   */
  it("puts a taken email under the email field", async () => {
    api.signUpFails(409, "That email is already registered. Log in instead.");
    render(<SignUp />);

    await fillSignUp();
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() =>
      expect(screen.getByLabelText("Email")).toHaveAccessibleDescription(
        "That email is already registered. Log in instead.",
      ),
    );
    expect(screen.getByLabelText("Email")).toHaveAttribute("aria-invalid", "true");
  });

  it("announces any other failure without losing what was typed", async () => {
    api.signUpFails(500, "Something went wrong on our end. Try again in a moment.");
    render(<SignUp />);

    await fillSignUp();
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/something went wrong/i);
    expect(screen.getByLabelText("Full name")).toHaveValue(LEARNER.fullName);
  });

  it("says something useful when the server cannot be reached", async () => {
    api.unreachable("/auth/signup");
    render(<SignUp />);

    await fillSignUp();
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/couldn't reach the server/i);
  });

  it("validates before calling the API at all", async () => {
    // No handler registered: onUnhandledRequest is "error", so a request here
    // would fail the test.
    render(<SignUp />);

    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.type(screen.getByLabelText("Password"), "short");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(screen.getByLabelText("Password")).toHaveAccessibleDescription(/8 characters/i);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("keeps the submit disabled until consent is given", async () => {
    render(<SignUp />);
    const submit = screen.getByRole("button", { name: "Create account" });
    expect(submit).toBeDisabled();

    await userEvent.click(screen.getByRole("checkbox"));
    expect(submit).toBeEnabled();
  });
});

describe("Log in", () => {
  async function fillLogIn() {
    await userEvent.type(screen.getByLabelText("Email"), LEARNER.email);
    await userEvent.type(screen.getByLabelText("Password"), "a-good-password");
  }

  it("follows the destination the API chose", async () => {
    api.logInSucceeds("/app");
    render(<LogIn />);

    await fillLogIn();
    await userEvent.click(screen.getByRole("button", { name: "Log in" }));

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith("/app", { replace: true }),
    );
  });

  it("sends an admin to the admin area, because the API said so", async () => {
    api.logInSucceeds("/admin", ADMIN);
    render(<LogIn />);

    await fillLogIn();
    await userEvent.click(screen.getByRole("button", { name: "Log in" }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/admin", { replace: true }));
  });

  /**
   * §6.3: a failed log in says only "Email or password is incorrect." The
   * message must not land under a field — pointing at one would suggest the
   * other was right, which is exactly what the API refuses to reveal.
   */
  it("shows one message, not a per-field hint", async () => {
    api.logInFails();
    render(<LogIn />);

    await fillLogIn();
    await userEvent.click(screen.getByRole("button", { name: "Log in" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Email or password is incorrect.");

    expect(screen.getByLabelText("Email")).not.toHaveAttribute("aria-invalid");
    expect(screen.getByLabelText("Password")).not.toHaveAttribute("aria-invalid");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("passes the rate-limit message straight through", async () => {
    api.logInFails(429, "Too many attempts. Wait a few minutes and try again.");
    render(<LogIn />);

    await fillLogIn();
    await userEvent.click(screen.getByRole("button", { name: "Log in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/too many attempts/i);
  });

  it("offers a way to the forgot-password page", () => {
    render(<LogIn />);
    expect(screen.getByRole("link", { name: /forgot password/i })).toHaveAttribute(
      "href",
      "/forgot-password",
    );
  });

  it("shows no app navigation", () => {
    render(<LogIn />);
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });
});
