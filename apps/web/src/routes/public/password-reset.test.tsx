import { describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { render } from "../../test/render";
import { api } from "../../test/server";
import { ForgotPassword } from "./ForgotPassword";
import { ResetPassword } from "./ResetPassword";
import { expectNoAxeViolations } from "../../test/axe";

const navigate = vi.fn();
vi.mock("react-router", async () => {
  const actual = await vi.importActual<typeof import("react-router")>("react-router");
  return { ...actual, useNavigate: () => navigate };
});

const ALWAYS = "If that email has an account, a reset link is on its way.";

describe("Forgot password", () => {
  /**
   * design.md §5.3: the page "never reveals which emails are registered". The
   * screen cannot know which case it is in, so there must be no second,
   * cheerier state for when mail was actually sent.
   */
  it("shows the same confirmation whatever the address", async () => {
    api.forgotSucceeds(ALWAYS);
    render(<ForgotPassword />, { route: "/forgot-password" });

    await userEvent.type(screen.getByLabelText("Email"), "nobody@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Send reset link" }));

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent(ALWAYS);
    // Nothing that would read as "we found your account".
    expect(status).not.toHaveTextContent(/sent to you|we've emailed you|account found/i);
  });

  it("mentions the spam folder, since a domainless sender often lands there", async () => {
    api.forgotSucceeds(ALWAYS);
    render(<ForgotPassword />, { route: "/forgot-password" });

    await userEvent.type(screen.getByLabelText("Email"), "learner@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Send reset link" }));

    expect(await screen.findByRole("status")).toHaveTextContent(/spam/i);
  });

  it("validates before calling the API", async () => {
    // No handler registered; onUnhandledRequest is "error".
    render(<ForgotPassword />, { route: "/forgot-password" });
    await userEvent.click(screen.getByRole("button", { name: "Send reset link" }));
    expect(screen.getByLabelText("Email")).toHaveAccessibleDescription(/enter your email/i);
  });

  it("passes a rate-limit message through", async () => {
    api.forgotFails(429, "Too many attempts. Wait a few minutes and try again.");
    render(<ForgotPassword />, { route: "/forgot-password" });

    await userEvent.type(screen.getByLabelText("Email"), "learner@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Send reset link" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/too many attempts/i);
  });

  it("has no axe violations", async () => {
    const { container } = render(<ForgotPassword />, { route: "/forgot-password" });
    await expectNoAxeViolations(container);
  });
});

describe("Reset password", () => {
  const withToken = { route: "/reset-password?token=a-token" };

  it("sets the password and sends the learner to log in", async () => {
    api.resetSucceeds("/login");
    render(<ResetPassword />, withToken);

    await userEvent.type(screen.getByLabelText("New password"), "a-brand-new-password");
    await userEvent.type(screen.getByLabelText("Confirm new password"), "a-brand-new-password");
    await userEvent.click(screen.getByRole("button", { name: "Set new password" }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/login", { replace: true }));
  });

  it("says that every other session is signed out", () => {
    render(<ResetPassword />, withToken);
    expect(screen.getByText(/signs you out everywhere else/i)).toBeInTheDocument();
  });

  /** A typo here becomes a password nobody knows, so it is worth catching. */
  it("catches a mismatched confirmation without calling the API", async () => {
    render(<ResetPassword />, withToken);

    await userEvent.type(screen.getByLabelText("New password"), "a-brand-new-password");
    await userEvent.type(screen.getByLabelText("Confirm new password"), "a-brand-new-passwrod");
    await userEvent.click(screen.getByRole("button", { name: "Set new password" }));

    expect(screen.getByLabelText("Confirm new password")).toHaveAccessibleDescription(
      /doesn't match/i,
    );
    expect(navigate).not.toHaveBeenCalled();
  });

  it("enforces the minimum length before calling the API", async () => {
    render(<ResetPassword />, withToken);

    await userEvent.type(screen.getByLabelText("New password"), "short");
    await userEvent.type(screen.getByLabelText("Confirm new password"), "short");
    await userEvent.click(screen.getByRole("button", { name: "Set new password" }));

    expect(screen.getByLabelText("New password")).toHaveAccessibleDescription(/8 characters/i);
  });

  it("offers a new link when the token is spent", async () => {
    api.resetFails();
    render(<ResetPassword />, withToken);

    await userEvent.type(screen.getByLabelText("New password"), "a-brand-new-password");
    await userEvent.type(screen.getByLabelText("Confirm new password"), "a-brand-new-password");
    await userEvent.click(screen.getByRole("button", { name: "Set new password" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/expired or has already been used/i);
    expect(screen.getByRole("link", { name: /send a new link/i })).toBeInTheDocument();
  });

  /**
   * Mail clients truncate long URLs. Saying so beats a round trip that comes
   * back "invalid token" and leaves the learner guessing.
   */
  it("explains a link with no token at all, without calling the API", () => {
    render(<ResetPassword />, { route: "/reset-password" });

    expect(screen.getByRole("heading", { name: /incomplete/i })).toBeInTheDocument();
    expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /send a new link/i })).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = render(<ResetPassword />, withToken);
    await expectNoAxeViolations(container);
  });
});
