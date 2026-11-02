import { beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { render } from "../../test/render";
import { api, server, ADMIN } from "../../test/server";
import { expectNoAxeViolations } from "../../test/axe";
import { Users } from "./Users";

const BASE = "http://localhost:4000";
const LEARNER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

/**
 * design.md §6.10 — Users.
 *
 * The assertions that matter are the three things this screen must **not** do,
 * because each of them would be an easy and plausible thing to build:
 *
 * 1. **No invite, and no role control of any kind** — §6 rule 8. §6.10 asked
 *    for an admin invite flow and it was dropped rather than built.
 * 2. **No control over evidence.** §6.10: "No action on this page can mark
 *    modules as passed or change scores." The learner panel reads and offers
 *    nothing.
 * 3. **No status change without a reason**, and no pre-filled one — a default
 *    like "Policy violation" would make the activity log read as though
 *    somebody wrote it.
 */

const account = (over: Record<string, unknown> = {}) => ({
  id: LEARNER_ID,
  email: "learner@example.com",
  fullName: "A Learner",
  role: "learner",
  status: "active",
  emailVerifiedAt: "2026-09-01T00:00:00Z",
  lastLoginAt: "2026-10-28T00:00:00Z",
  createdAt: "2026-09-01T00:00:00Z",
  ...over,
});

const detail = (over: Record<string, unknown> = {}) => ({
  user: account(),
  roadmaps: [
    {
      id: "r1",
      status: "active",
      createdAt: "2026-09-02T00:00:00Z",
      pathTitle: "Junior Web Developer",
      trackTitle: "Frontend",
    },
  ],
  completions: { passed: 4, tested_out: 2 },
  projects: [],
  certificates: [],
  statusHistory: [],
  ...over,
});

function users(list: Record<string, unknown>[], activeAdmins = 2) {
  server.use(
    http.get(`${BASE}/admin/users`, () => HttpResponse.json({ users: list, activeAdmins })),
    http.get(`${BASE}/admin/users/:id`, () => HttpResponse.json(detail())),
  );
}

const at = { route: "/admin/users" };

beforeEach(() => {
  api.signedIn(ADMIN);
  users([account()]);
});

describe("§6 rule 8 — nothing here sets a role", () => {
  it("offers no invite control", async () => {
    render(<Users />, at);

    await screen.findByText("A Learner");

    expect(screen.queryByRole("button", { name: /invite/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/role.*admin/i)).not.toBeInTheDocument();
  });

  /**
   * §6.10 asks for it, so its absence has to be explained — otherwise an admin
   * concludes the page is broken and goes looking for the button.
   */
  it("says how an admin is made instead", async () => {
    render(<Users />, at);

    expect(await screen.findByText(/no endpoint may set an account's role/i)).toBeInTheDocument();
    expect(screen.getByText("npm run db:accounts")).toBeInTheDocument();
  });

  /** The Role control filters the list. It does not change anybody's role. */
  it("uses role only as a filter", async () => {
    let asked: string | null = null;
    server.use(
      http.get(`${BASE}/admin/users`, ({ request }) => {
        asked = new URL(request.url).searchParams.get("role");
        return HttpResponse.json({ users: [], activeAdmins: 2 });
      }),
    );
    render(<Users />, at);

    await userEvent.click(await screen.findByRole("radio", { name: "Admins" }));

    await waitFor(() => expect(asked).toBe("admin"));
  });
});

describe("§6.10 — no control over evidence", () => {
  /**
   * The panel shows what a learner has passed and offers nothing to change it.
   * §6 rule 10 is the principle; this is the screen honouring it.
   */
  it("reads progress without offering to change it", async () => {
    render(<Users />, at);

    await userEvent.click(await screen.findByRole("button", { name: /view record/i }));

    await screen.findByText(/modules passed/i);
    expect(screen.queryByRole("button", { name: /mark.*passed/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /override/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
  });

  /**
   * **An override is shown separately from work the learner did.** One total
   * would let a corrected record read as a clean one.
   */
  it("separates an override from the learner's own work", async () => {
    server.use(
      http.get(`${BASE}/admin/users/:id`, () =>
        HttpResponse.json(detail({ completions: { passed: 3, override: 1 } })),
      ),
    );
    render(<Users />, at);

    await userEvent.click(await screen.findByRole("button", { name: /view record/i }));

    /*
     * Each count sits in its own `<strong>` with the noun beside it as a text
     * node, so no single node holds "1 override" — `getByText` concatenates a
     * node's direct text children only. The matcher reads the whole line, which
     * is also what an admin reads.
     */
    expect(
      await screen.findByText(
        (_, element) =>
          element?.tagName === "P" &&
          element.textContent === "3 modules passed · 0 tested out · 1 override",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/an override is a logged admin correction, not work the learner did/i),
    ).toBeInTheDocument();
  });
});

describe("suspending", () => {
  it("needs a reason before it will send", async () => {
    render(<Users />, at);

    await userEvent.click(await screen.findByRole("button", { name: /suspend account/i }));

    expect(screen.getByRole("button", { name: "Suspend" })).toBeDisabled();
  });

  /** Blank, never pre-filled: the log should carry what the admin actually wrote. */
  it("does not pre-fill the reason", async () => {
    render(<Users />, at);

    await userEvent.click(await screen.findByRole("button", { name: /suspend account/i }));

    expect(screen.getByLabelText(/why is this account being suspended/i)).toHaveValue("");
  });

  it("sends the status and the reason", async () => {
    let sent: { status: string; reason: string } | undefined;
    server.use(
      http.patch(`${BASE}/admin/users/${LEARNER_ID}/status`, async ({ request }) => {
        sent = (await request.json()) as typeof sent;
        return HttpResponse.json({ status: "suspended", changed: true });
      }),
    );
    render(<Users />, at);

    await userEvent.click(await screen.findByRole("button", { name: /suspend account/i }));
    await userEvent.type(
      screen.getByLabelText(/why is this account being suspended/i),
      "Shared answers",
    );
    await userEvent.click(screen.getByRole("button", { name: "Suspend" }));

    await waitFor(() => expect(sent).toEqual({ status: "suspended", reason: "Shared answers" }));
  });

  /** §9: say what happens, before it happens. */
  it("says what suspending does", async () => {
    render(<Users />, at);

    await userEvent.click(await screen.findByRole("button", { name: /suspend account/i }));

    expect(
      screen.getByText(/signed out immediately and cannot sign back in/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/recorded in the activity log/i)).toBeInTheDocument();
  });

  it("offers reactivation for a suspended account, and asks why", async () => {
    users([account({ status: "suspended" })]);
    render(<Users />, at);

    await userEvent.click(await screen.findByRole("button", { name: /reactivate account/i }));

    expect(screen.getByLabelText(/why is this account being reactivated/i)).toBeInTheDocument();
  });

  it("shows the API's refusal", async () => {
    server.use(
      http.patch(`${BASE}/admin/users/${LEARNER_ID}/status`, () =>
        HttpResponse.json({ error: "Say why this account's status is changing." }, { status: 400 }),
      ),
    );
    render(<Users />, at);

    await userEvent.click(await screen.findByRole("button", { name: /suspend account/i }));
    await userEvent.type(screen.getByLabelText(/why is this account/i), "x");
    await userEvent.click(screen.getByRole("button", { name: "Suspend" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/say why/i);
  });
});

describe("your own account", () => {
  /**
   * The refusal is explained **before** it is met. An admin who suspends
   * themselves ends their own session on the next request, and no endpoint can
   * make a new admin — so the screen says so rather than letting the API say it
   * after the fact.
   */
  it("offers no status control on your own account", async () => {
    users([account({ id: ADMIN.id, fullName: "An Admin", role: "admin" })]);
    render(<Users />, at);

    await userEvent.click(await screen.findByRole("radio", { name: "Admins" }));

    expect(
      await screen.findByText(/can't change your own account's status/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /suspend account/i })).not.toBeInTheDocument();
  });

  it("marks which row is you", async () => {
    users([account({ id: ADMIN.id, fullName: "An Admin", role: "admin" })]);
    render(<Users />, at);

    expect(await screen.findByText("(you)")).toBeInTheDocument();
  });

  /** So an admin knows what suspending a colleague would leave behind. */
  it("says how many admins can still get in", async () => {
    users([account({ id: ADMIN.id, role: "admin" })], 1);
    render(<Users />, at);

    await userEvent.click(await screen.findByRole("radio", { name: "Admins" }));

    expect(
      await screen.findByText(/one admin can currently reach the admin area/i),
    ).toBeInTheDocument();
  });
});

describe("the record", () => {
  it("shows roadmaps, projects and certificates", async () => {
    server.use(
      http.get(`${BASE}/admin/users/:id`, () =>
        HttpResponse.json(
          detail({
            projects: [
              {
                id: "p1",
                status: "in_progress",
                repoFullName: "learner/task-tracker",
                briefTitle: "Task tracker",
                startedAt: "2026-10-01T00:00:00Z",
              },
            ],
            certificates: [
              {
                id: "c1",
                publicCode: "FC-7K2M-94QX",
                type: "completion",
                title: "Junior Web Developer",
                status: "valid",
                issuedAt: "2026-10-20T00:00:00Z",
              },
            ],
          }),
        ),
      ),
    );
    render(<Users />, at);

    await userEvent.click(await screen.findByRole("button", { name: /view record/i }));

    expect(await screen.findByText(/junior web developer, frontend track/i)).toBeInTheDocument();
    expect(screen.getByText(/Task tracker/)).toBeInTheDocument();
    expect(screen.getByText("FC-7K2M-94QX")).toBeInTheDocument();
  });

  /**
   * **Why an account was suspended comes out of the append-only log.**
   * `users.status` holds the current state and no reason, so this is the only
   * place the question has an answer.
   */
  it("shows why the account was suspended, and who did it", async () => {
    users([account({ status: "suspended" })]);
    server.use(
      http.get(`${BASE}/admin/users/:id`, () =>
        HttpResponse.json(
          detail({
            user: account({ status: "suspended" }),
            statusHistory: [
              {
                action: "account.suspended",
                reason: "Shared answers",
                at: "2026-10-30T00:00:00Z",
                by: "An Admin",
              },
            ],
          }),
        ),
      ),
    );
    render(<Users />, at);

    await userEvent.click(await screen.findByRole("button", { name: /view record/i }));

    expect(await screen.findByText(/suspended on .* by An Admin — Shared answers/i)).toBeInTheDocument();
  });
});

describe("what it does not do", () => {
  /** No table records a request, so there is nothing to process. */
  it("says data requests are not built, and why", async () => {
    render(<Users />, at);

    expect(
      await screen.findByText(/nothing in the schema records a data download or deletion request/i),
    ).toBeInTheDocument();
  });
});

describe("accessibility", () => {
  it("has no axe violations", async () => {
    const { container } = render(<Users />, at);

    await screen.findByText("A Learner");
    await expectNoAxeViolations(container);
  });

  it("has none with the reason form open", async () => {
    const { container } = render(<Users />, at);

    await userEvent.click(await screen.findByRole("button", { name: /suspend account/i }));

    await expectNoAxeViolations(container);
  });
});
