import { beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { render } from "../../test/render";
import { server } from "../../test/server";
import { expectNoAxeViolations } from "../../test/axe";
import { Settings } from "./Settings";

const BASE = "http://localhost:4000";

/**
 * design.md §5.18 — Settings.
 *
 * Five sections, four of them forms. The tests worth reading are the ones about
 * the fifth (which says why it has no controls), the delete dialog's focus
 * behaviour, and the two places where the screen must report what the API told
 * it rather than what it assumed.
 */

const account = (over: Record<string, unknown> = {}) => ({
  fullName: "Jan Kevin Gerona",
  email: "learner@example.com",
  emailVerified: true,
  createdAt: "2026-01-04T00:00:00Z",
  canDelete: true,
  ...over,
});

const connection = (over: Record<string, unknown> = {}) => ({
  connected: true,
  configured: true,
  login: "jangerona",
  connectedAt: "2026-05-01T00:00:00Z",
  reachable: true,
  repositories: [
    { id: 1, fullName: "jangerona/task-tracker", private: false },
    { id: 2, fullName: "jangerona/notes", private: true },
  ],
  ...over,
});

let sent: { path: string; method: string; body: unknown }[] = [];

interface ServeOptions {
  accountBody?: Record<string, unknown>;
  githubBody?: Record<string, unknown>;
  profileStatus?: number;
  profileBody?: Record<string, unknown>;
  passwordStatus?: number;
  deleteStatus?: number;
}

function serve({
  accountBody = account(),
  githubBody = connection(),
  profileStatus = 200,
  profileBody = {
    fullName: "Jan Kevin Gerona",
    email: "learner@example.com",
    emailChanged: false,
    verificationSent: false,
  },
  passwordStatus = 200,
  deleteStatus = 200,
}: ServeOptions = {}) {
  server.use(
    http.get(`${BASE}/account`, () => HttpResponse.json(accountBody)),
    http.get(`${BASE}/github/connection`, () => HttpResponse.json(githubBody)),
    http.put(`${BASE}/account/profile`, async ({ request }) => {
      sent.push({ path: "profile", method: "PUT", body: await request.json() });
      return profileStatus === 200
        ? HttpResponse.json(profileBody)
        : HttpResponse.json(
            { error: "That email is already in use by another account." },
            { status: profileStatus },
          );
    }),
    http.put(`${BASE}/account/password`, async ({ request }) => {
      sent.push({ path: "password", method: "PUT", body: await request.json() });
      return passwordStatus === 200
        ? HttpResponse.json({ changed: true, otherSessionsEnded: true })
        : HttpResponse.json(
            { error: "That current password isn't right." },
            { status: passwordStatus },
          );
    }),
    http.delete(`${BASE}/account`, () => {
      sent.push({ path: "account", method: "DELETE", body: null });
      return deleteStatus === 200
        ? HttpResponse.json({ deleted: true })
        : HttpResponse.json({ error: "That didn't work." }, { status: deleteStatus });
    }),
    http.delete(`${BASE}/github/connection`, () => {
      sent.push({ path: "github", method: "DELETE", body: null });
      return HttpResponse.json({ connected: false, wasConnected: true });
    }),
  );
}

beforeEach(() => {
  sent = [];
});

const heading = (name: RegExp) => screen.findByRole("heading", { name });

describe("the page", () => {
  it("shows every section §5.18 lists", async () => {
    serve();
    render(<Settings />);

    expect(await heading(/^Settings$/)).toBeInTheDocument();
    expect(await heading(/^Profile$/)).toBeInTheDocument();
    expect(await heading(/^Password$/)).toBeInTheDocument();
    expect(await heading(/^GitHub$/)).toBeInTheDocument();
    expect(await heading(/^Notifications$/)).toBeInTheDocument();
    expect(await heading(/^Data and account$/)).toBeInTheDocument();
  });

  it("says so rather than showing empty fields when it cannot load", async () => {
    server.use(
      http.get(`${BASE}/account`, () => HttpResponse.json({ error: "Nope" }, { status: 500 })),
      http.get(`${BASE}/github/connection`, () => HttpResponse.json(connection())),
    );
    render(<Settings />);

    expect(await heading(/aren't available right now/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/full name/i)).not.toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    serve();
    const { container } = render(<Settings />);
    await heading(/^Data and account$/);
    await expectNoAxeViolations(container);
  });
});

describe("profile", () => {
  it("starts from what the API returned", async () => {
    serve();
    render(<Settings />);

    expect(await screen.findByLabelText(/full name/i)).toHaveValue("Jan Kevin Gerona");
    expect(screen.getByLabelText(/^email$/i)).toHaveValue("learner@example.com");
  });

  it("cannot be saved until something changes", async () => {
    serve();
    render(<Settings />);

    const save = await screen.findByRole("button", { name: /save profile/i });
    expect(save).toBeDisabled();

    await userEvent.type(await screen.findByLabelText(/full name/i), "!");
    expect(save).toBeEnabled();
  });

  it("sends the name and the email", async () => {
    serve();
    render(<Settings />);

    const name = await screen.findByLabelText(/full name/i);
    await userEvent.clear(name);
    await userEvent.type(name, "Jan Gerona");
    await userEvent.click(screen.getByRole("button", { name: /save profile/i }));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].body).toEqual({ fullName: "Jan Gerona", email: "learner@example.com" });
  });

  /** §5.18's own promise, said where the learner is editing the field. */
  it("warns that the name only applies to new certificates", async () => {
    serve();
    render(<Settings />);

    expect(
      await screen.findByText(/certificates you already have keep the name/i),
    ).toBeInTheDocument();
  });

  it("shows whether the address is confirmed", async () => {
    serve();
    render(<Settings />);
    expect(await screen.findByText(/^Verified$/)).toBeInTheDocument();
  });

  it("says when it is not", async () => {
    serve({ accountBody: account({ emailVerified: false }) });
    render(<Settings />);
    expect(await screen.findByText(/not confirmed yet/i)).toBeInTheDocument();
  });

  /**
   * The difference between these two is the point: the screen reports what the
   * API said happened, rather than assuming a saved profile means a sent email.
   */
  it("tells the learner to check the new address when the link went out", async () => {
    serve({
      profileBody: {
        fullName: "Jan Kevin Gerona",
        email: "new@example.com",
        emailChanged: true,
        verificationSent: true,
      },
    });
    render(<Settings />);

    const email = await screen.findByLabelText(/^email$/i);
    await userEvent.clear(email);
    await userEvent.type(email, "new@example.com");
    await userEvent.click(screen.getByRole("button", { name: /save profile/i }));

    expect(await screen.findByText(/check your new address/i)).toBeInTheDocument();
  });

  it("admits it when the address changed but the email did not send", async () => {
    serve({
      profileBody: {
        fullName: "Jan Kevin Gerona",
        email: "new@example.com",
        emailChanged: true,
        verificationSent: false,
      },
    });
    render(<Settings />);

    const email = await screen.findByLabelText(/^email$/i);
    await userEvent.clear(email);
    await userEvent.type(email, "new@example.com");
    await userEvent.click(screen.getByRole("button", { name: /save profile/i }));

    expect(await screen.findByText(/couldn't send the confirmation email/i)).toBeInTheDocument();
    expect(screen.queryByText(/check your new address/i)).not.toBeInTheDocument();
  });

  it("shows the API's own message when the address is taken", async () => {
    serve({ profileStatus: 409 });
    render(<Settings />);

    const email = await screen.findByLabelText(/^email$/i);
    await userEvent.clear(email);
    await userEvent.type(email, "taken@example.com");
    await userEvent.click(screen.getByRole("button", { name: /save profile/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/already in use/i);
  });
});

describe("password", () => {
  it("sends both passwords and reports the other sessions ending", async () => {
    serve();
    render(<Settings />);

    await userEvent.type(await screen.findByLabelText(/current password/i), "a-good-password");
    await userEvent.type(screen.getByLabelText(/new password/i), "a-better-password");
    await userEvent.click(screen.getByRole("button", { name: /change password/i }));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].body).toEqual({
      currentPassword: "a-good-password",
      newPassword: "a-better-password",
    });
    expect(await screen.findByText(/has been signed out/i)).toBeInTheDocument();
  });

  /** §6.3's consequence, said before it happens rather than after. */
  it("warns up front that it signs you out everywhere else", async () => {
    serve();
    render(<Settings />);

    expect(await screen.findByText(/signs you out everywhere else/i)).toBeInTheDocument();
  });

  it("stays disabled until both fields are filled", async () => {
    serve();
    render(<Settings />);

    const button = await screen.findByRole("button", { name: /change password/i });
    expect(button).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/current password/i), "a-good-password");
    expect(button).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/new password/i), "a-better-password");
    expect(button).toBeEnabled();
  });

  it("shows the API's message when the current password is wrong", async () => {
    serve({ passwordStatus: 400 });
    render(<Settings />);

    await userEvent.type(await screen.findByLabelText(/current password/i), "wrong");
    await userEvent.type(screen.getByLabelText(/new password/i), "a-better-password");
    await userEvent.click(screen.getByRole("button", { name: /change password/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/current password isn't right/i);
  });

  it("clears the fields once it worked", async () => {
    serve();
    render(<Settings />);

    await userEvent.type(await screen.findByLabelText(/current password/i), "a-good-password");
    await userEvent.type(screen.getByLabelText(/new password/i), "a-better-password");
    await userEvent.click(screen.getByRole("button", { name: /change password/i }));

    await screen.findByText(/has been signed out/i);
    expect(screen.getByLabelText(/current password/i)).toHaveValue("");
    expect(screen.getByLabelText(/new password/i)).toHaveValue("");
  });
});

describe("GitHub", () => {
  it("shows the account and the repositories it can read", async () => {
    serve();
    render(<Settings />);

    expect(await screen.findByText("jangerona")).toBeInTheDocument();
    expect(screen.getByText("jangerona/task-tracker")).toBeInTheDocument();
    expect(screen.getByText("jangerona/notes")).toBeInTheDocument();
    expect(await heading(/repositories this connection can read \(2\)/i)).toBeInTheDocument();
  });

  it("marks a private repository as private", async () => {
    serve();
    render(<Settings />);

    const row = (await screen.findByText("jangerona/notes")).closest("li");
    expect(within(row as HTMLElement).getByText(/private/i)).toBeInTheDocument();
  });

  it("says nothing is connected when nothing is", async () => {
    serve({ githubBody: { connected: false, configured: true, repositories: [] } });
    render(<Settings />);

    expect(await screen.findByText(/no github account is connected/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /disconnect/i })).not.toBeInTheDocument();
  });

  /**
   * "Connected but unreachable" is a third state the API reports deliberately,
   * and the screen must not render it as disconnected — offering to reconnect
   * something that is already fine is the failure this guards.
   */
  it("distinguishes an unreachable connection from a missing one", async () => {
    serve({ githubBody: connection({ reachable: false }) });
    render(<Settings />);

    expect(await screen.findByText(/can't reach github right now/i)).toBeInTheDocument();
    expect(screen.getByText(/your connection is fine/i)).toBeInTheDocument();
    expect(screen.queryByText(/no github account is connected/i)).not.toBeInTheDocument();
  });

  it("asks before disconnecting, and says what is kept", async () => {
    serve();
    render(<Settings />);

    await userEvent.click(await screen.findByRole("button", { name: /disconnect github/i }));

    expect(screen.getByText(/milestones you have already passed stay passed/i)).toBeInTheDocument();
    expect(sent).toHaveLength(0);
  });

  it("does not disconnect when the learner backs out", async () => {
    serve();
    render(<Settings />);

    await userEvent.click(await screen.findByRole("button", { name: /disconnect github/i }));
    await userEvent.click(screen.getByRole("button", { name: /keep it connected/i }));

    expect(sent).toHaveLength(0);
  });

  it("disconnects once confirmed", async () => {
    serve();
    render(<Settings />);

    await userEvent.click(await screen.findByRole("button", { name: /disconnect github/i }));
    const confirm = screen
      .getAllByRole("button", { name: /disconnect github/i })
      .find((button) => button.textContent === "Disconnect GitHub");
    await userEvent.click(confirm as HTMLElement);

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ path: "github", method: "DELETE" });
  });
});

describe("notifications", () => {
  /**
   * The section §5.18 asks for and the platform cannot honour. It must say so:
   * an absence with no explanation reads as unfinished rather than as decided.
   */
  it("explains that nothing is emailed instead of offering a toggle", async () => {
    serve();
    render(<Settings />);

    await heading(/^Notifications$/);
    expect(screen.getByText(/nothing is sent to your email/i)).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });

  it("names the two emails that are still sent", async () => {
    serve();
    render(<Settings />);

    const section = (await heading(/^Notifications$/)).closest("article, div, section");
    expect(within(section as HTMLElement).getByText(/confirming\s+your address/i)).toBeInTheDocument();
  });
});

describe("data and account", () => {
  it("offers the download", async () => {
    serve();
    render(<Settings />);

    expect(await screen.findByRole("button", { name: /download my data/i })).toBeInTheDocument();
    expect(screen.getByText(/it says inside what it leaves out/i)).toBeInTheDocument();
  });

  it("offers the delete when the API says it can succeed", async () => {
    serve();
    render(<Settings />);

    expect(await screen.findByRole("button", { name: /delete my account/i })).toBeInTheDocument();
  });

  /**
   * The screen does not work this out for itself — `canDelete` is a schema fact
   * about the append-only activity log, and a browser guessing it will be wrong
   * the moment the schema moves.
   */
  it("hides the delete and explains when the API says it cannot", async () => {
    serve({ accountBody: account({ canDelete: false }) });
    render(<Settings />);

    expect(await screen.findByText(/cannot be edited or removed/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /delete my account/i })).not.toBeInTheDocument();
  });
});

describe("the delete dialog", () => {
  const open = async () => {
    const button = await screen.findByRole("button", { name: /delete my account/i });
    await userEvent.click(button);
    return button;
  };

  it("uses §5.18's copy word for word", async () => {
    serve();
    render(<Settings />);
    await open();

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: /delete your account\?/i })).toBeInTheDocument();
    expect(dialog).toHaveTextContent(
      /Your roadmaps, progress, resumes, and certificates will be permanently deleted, and your certificate verification links will stop working\. This can't be undone\./,
    );
    expect(within(dialog).getByRole("button", { name: /^cancel$/i })).toBeInTheDocument();
  });

  it("deletes nothing until the dialog is confirmed", async () => {
    serve();
    render(<Settings />);
    await open();

    expect(sent).toHaveLength(0);
  });

  it("deletes on confirm", async () => {
    serve();
    render(<Settings />);
    await open();

    const dialog = screen.getByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: /delete my account/i }));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ path: "account", method: "DELETE" });
  });

  it("closes on Cancel without deleting", async () => {
    serve();
    render(<Settings />);
    await open();

    await userEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: /^cancel$/i }),
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(sent).toHaveLength(0);
  });

  /* ---- §12: focus moves in, Escape closes, focus returns ---- */

  it("takes focus when it opens", async () => {
    serve();
    render(<Settings />);
    await open();

    await waitFor(() => expect(screen.getByRole("dialog")).toHaveFocus());
  });

  it("closes on Escape", async () => {
    serve();
    render(<Settings />);
    await open();

    await userEvent.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(sent).toHaveLength(0);
  });

  it("gives focus back to the button that opened it", async () => {
    serve();
    render(<Settings />);
    const button = await open();

    await userEvent.keyboard("{Escape}");

    await waitFor(() => expect(button).toHaveFocus());
  });

  /** Tab at the last control wraps to the first rather than escaping behind. */
  it("holds Tab inside itself", async () => {
    serve();
    render(<Settings />);
    await open();

    const dialog = screen.getByRole("dialog");
    const cancel = within(dialog).getByRole("button", { name: /^cancel$/i });
    const confirm = within(dialog).getByRole("button", { name: /delete my account/i });

    confirm.focus();
    await userEvent.tab();
    expect(cancel).toHaveFocus();

    await userEvent.tab({ shift: true });
    expect(confirm).toHaveFocus();
  });

  it("shows the API's message if the delete is refused", async () => {
    serve({ deleteStatus: 409 });
    render(<Settings />);
    await open();

    await userEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: /delete my account/i }),
    );

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("has no axe violations while open", async () => {
    serve();
    const { container } = render(<Settings />);
    await open();
    await expectNoAxeViolations(container);
  });
});
