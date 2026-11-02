import { beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { render } from "../../test/render";
import { server } from "../../test/server";
import { expectNoAxeViolations } from "../../test/axe";
import { ActivityLog } from "./ActivityLog";

const BASE = "http://localhost:4000";

/**
 * design.md §6.12 — the activity log.
 *
 * Two things are worth a test here, and neither is "does it render rows".
 *
 * **It is readable.** A row is `module_version.published` against a uuid in the
 * database; what has to appear is "Published a module version" and the version's
 * name. An action or target this screen has not met falls back rather than
 * showing a bare uuid, which is the one thing on the page that means nothing to
 * anybody.
 *
 * **It cannot be changed.** §6.12: "No admin can edit or delete entries,
 * including their own." There is no endpoint and the database refuses; the
 * screen offering no control is the third layer, and asserted as such.
 */

const entry = (over: Record<string, unknown> = {}) => ({
  id: "1",
  action: "module_version.published",
  at: "2026-10-01T09:30:00Z",
  admin: { id: "a1", fullName: "An Admin" },
  target: { type: "module_version", id: "v1", label: "JavaScript basics (version 3)" },
  reason: null,
  details: {},
  ...over,
});

function log(entries: Record<string, unknown>[], nextBefore: string | null = null) {
  server.use(
    http.get(`${BASE}/admin/log`, () => HttpResponse.json({ entries, nextBefore })),
    http.get(`${BASE}/admin/log/filters`, () =>
      HttpResponse.json({
        actions: [
          { action: "module_version.published", count: 4 },
          { action: "certificate.revoked", count: 1 },
        ],
        admins: [{ id: "a1", fullName: "An Admin" }],
      }),
    ),
  );
}

const at = { route: "/admin/log" };

beforeEach(() => log([entry()]));

describe("the record cannot be changed", () => {
  /** §6.12, and the reason there is no endpoint behind it either. */
  it("offers no way to edit or delete an entry", async () => {
    render(<ActivityLog />, at);

    await screen.findByText("Published a module version");

    expect(screen.queryByRole("button", { name: /edit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /remove/i })).not.toBeInTheDocument();
  });

  it("says so, so an admin does not go looking", async () => {
    render(<ActivityLog />, at);

    expect(
      await screen.findByText(/cannot be edited or deleted — including your own/i),
    ).toBeInTheDocument();
  });
});

describe("rows read as sentences", () => {
  /**
   * The point of the screen. `module_version.published` against a uuid is
   * storage; "Published a module version — JavaScript basics (version 3)" is
   * the record (§9).
   */
  it("names the action and the target, not the raw values", async () => {
    render(<ActivityLog />, at);

    expect(await screen.findByText("Published a module version")).toBeInTheDocument();
    expect(screen.getByText("JavaScript basics (version 3)")).toBeInTheDocument();
    expect(screen.queryByText("module_version.published")).not.toBeInTheDocument();
    expect(screen.queryByText("v1")).not.toBeInTheDocument();
  });

  it("shows the reason where the action had one", async () => {
    log([entry({ action: "certificate.revoked", reason: "The repository was copied wholesale." })]);
    render(<ActivityLog />, at);

    expect(await screen.findByText("Withdrew a certificate")).toBeInTheDocument();
    expect(screen.getByText(/copied wholesale/)).toBeInTheDocument();
  });

  /**
   * **A bare uuid never reaches the screen.** The API returns no label for a
   * target type it does not resolve; the screen falls back to what the type is
   * called rather than printing the id.
   */
  it("falls back to the target's type when there is no label", async () => {
    log([
      entry({
        action: "integrity.cleared",
        target: { type: "integrity_flag", id: "f1", label: null },
      }),
    ]);
    render(<ActivityLog />, at);

    expect(await screen.findByText("integrity flag")).toBeInTheDocument();
    expect(screen.queryByText("f1")).not.toBeInTheDocument();
  });

  /** A setting is keyed by text, so its key is in the details, not the target. */
  it("names the setting a change was made to", async () => {
    log([
      entry({
        action: "setting.changed",
        target: { type: "platform_setting", id: null, label: null },
        details: { key: "passing_score_default", from: 70, to: 75 },
      }),
    ]);
    render(<ActivityLog />, at);

    expect(await screen.findByText("Changed a platform setting")).toBeInTheDocument();
    expect(screen.getByText("passing_score_default")).toBeInTheDocument();
  });

  /**
   * **An action this screen has not met is still shown.** A log that quietly
   * omits what it cannot label is not a log — so the raw action appears rather
   * than the row vanishing.
   */
  it("shows an action it has no sentence for rather than hiding the row", async () => {
    log([entry({ action: "something.new" })]);
    render(<ActivityLog />, at);

    expect(await screen.findByText("something.new")).toBeInTheDocument();
  });

  /**
   * `admin_id` is `on delete set null`, so an entry outlives the account that
   * made it — which is what append-only means.
   */
  it("keeps an entry whose admin account is gone", async () => {
    log([entry({ admin: null })]);
    render(<ActivityLog />, at);

    expect(await screen.findByText(/an account since deleted/i)).toBeInTheDocument();
    expect(screen.getByText("Published a module version")).toBeInTheDocument();
  });
});

describe("filters", () => {
  it("offers the actions that are in the log, named", async () => {
    render(<ActivityLog />, at);

    const select = await screen.findByLabelText("Action");
    /*
     * The filter list is its own query, so it arrives after the select does.
     * Awaiting the option rather than the select is the difference between
     * testing the screen and testing a race.
     */
    expect(
      await within(select).findByRole("option", { name: "Published a module version (4)" }),
    ).toBeInTheDocument();
    expect(
      within(select).getByRole("option", { name: "Withdrew a certificate (1)" }),
    ).toBeInTheDocument();
  });

  it("asks the API for the chosen action", async () => {
    let asked: string | null = null;
    server.use(
      http.get(`${BASE}/admin/log`, ({ request }) => {
        asked = new URL(request.url).searchParams.get("action");
        return HttpResponse.json({ entries: [], nextBefore: null });
      }),
    );
    render(<ActivityLog />, at);

    const select = await screen.findByLabelText("Action");
    await within(select).findByRole("option", { name: /withdrew a certificate/i });
    await userEvent.selectOptions(select, "certificate.revoked");

    await waitFor(() => expect(asked).toBe("certificate.revoked"));
  });

  it("sends the date range", async () => {
    let from: string | null = null;
    server.use(
      http.get(`${BASE}/admin/log`, ({ request }) => {
        from = new URL(request.url).searchParams.get("from");
        return HttpResponse.json({ entries: [], nextBefore: null });
      }),
    );
    render(<ActivityLog />, at);

    await userEvent.type(await screen.findByLabelText("From"), "2026-06-01");

    await waitFor(() => expect(from).toBe("2026-06-01"));
  });

  it("shows the API's refusal rather than silently empty results", async () => {
    server.use(
      http.get(`${BASE}/admin/log`, () =>
        HttpResponse.json({ error: "The start of the range is after its end." }, { status: 400 }),
      ),
    );
    render(<ActivityLog />, at);

    expect(await screen.findByRole("alert")).toHaveTextContent(/after its end/i);
  });

  it("says nothing matched, rather than looking broken", async () => {
    server.use(
      http.get(`${BASE}/admin/log`, () => HttpResponse.json({ entries: [], nextBefore: null })),
    );
    render(<ActivityLog />, at);

    const select = await screen.findByLabelText("Action");
    await within(select).findByRole("option", { name: /withdrew a certificate/i });
    await userEvent.selectOptions(select, "certificate.revoked");

    expect(await screen.findByText(/nothing matches those filters/i)).toBeInTheDocument();
  });

  it("says the log is empty differently from a filter matching nothing", async () => {
    server.use(
      http.get(`${BASE}/admin/log`, () => HttpResponse.json({ entries: [], nextBefore: null })),
    );
    render(<ActivityLog />, at);

    expect(await screen.findByText(/no admin actions have been recorded yet/i)).toBeInTheDocument();
  });
});

describe("paging", () => {
  it("asks for the next page with the cursor the API gave", async () => {
    log([entry()], "42");
    let before: string | null = null;
    render(<ActivityLog />, at);

    await screen.findByText("Published a module version");

    server.use(
      http.get(`${BASE}/admin/log`, ({ request }) => {
        before = new URL(request.url).searchParams.get("before");
        return HttpResponse.json({ entries: [entry({ id: "2" })], nextBefore: null });
      }),
    );
    await userEvent.click(screen.getByRole("button", { name: /older/i }));

    await waitFor(() => expect(before).toBe("42"));
  });

  it("offers nothing older at the end of the log", async () => {
    render(<ActivityLog />, at);

    expect(await screen.findByRole("button", { name: /older/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /newer/i })).toBeDisabled();
  });

  /** Page three of the old filter is meaningless, so the walk restarts. */
  it("returns to the first page when a filter changes", async () => {
    log([entry()], "42");
    render(<ActivityLog />, at);

    await screen.findByText("Published a module version");
    await userEvent.click(screen.getByRole("button", { name: /older/i }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /newer/i })).toBeEnabled(),
    );

    let before: string | null = "unset";
    server.use(
      http.get(`${BASE}/admin/log`, ({ request }) => {
        before = new URL(request.url).searchParams.get("before");
        return HttpResponse.json({ entries: [entry()], nextBefore: null });
      }),
    );
    const select = screen.getByLabelText("Action");
    await within(select).findByRole("option", { name: /withdrew a certificate/i });
    await userEvent.selectOptions(select, "certificate.revoked");

    await waitFor(() => expect(before).toBeNull());
  });
});

describe("accessibility", () => {
  it("has no axe violations", async () => {
    const { container } = render(<ActivityLog />, at);

    await screen.findByText("Published a module version");
    await expectNoAxeViolations(container);
  });

  /**
   * The table scrolls sideways below `md`, so the region has to be reachable by
   * keyboard — otherwise the columns past the fold need a pointer (§12).
   */
  it("makes the scrolling table reachable by keyboard", async () => {
    render(<ActivityLog />, at);

    const region = await screen.findByRole("region", { name: "Admin actions" });
    expect(region).toHaveAttribute("tabindex", "0");
  });
});
