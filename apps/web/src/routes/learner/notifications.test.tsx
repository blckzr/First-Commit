import { beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { render } from "../../test/render";
import { server } from "../../test/server";
import { expectNoAxeViolations } from "../../test/axe";
import { Notifications } from "./Notifications";

const BASE = "http://localhost:4000";
const ID = "ffffffff-ffff-4fff-8fff-ffffffffffff";

/**
 * design.md §5.17 — Notifications.
 *
 * The grouping is the part worth testing carefully, because it depends on the
 * reader's clock rather than on anything the API said: the fixtures below are
 * built relative to "now" for that reason, not hard-coded dates, which would
 * drift into "Earlier" and quietly stop testing the boundary.
 */

const at = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/**
 * **"Today" has to mean now, not an hour ago.**
 *
 * An earlier version of these fixtures used `at(HOUR)` for the Today group. It
 * passed for a week and then failed, because `group()` compares against local
 * midnight — so an hour ago is *yesterday* for any run between 00:00 and 01:00,
 * and the Today heading never rendered. The code was right and the fixture was
 * wrong: a test that depends on the hour it runs at is not testing the boundary,
 * it is sampling it.
 */
const JUST_NOW = () => at(0);

const item = (over: Record<string, unknown> = {}) => ({
  id: ID,
  type: "certificate_earned",
  title: "You earned your Certificate of Completion for Junior Web Developer",
  body: "",
  link: "/app/certificates",
  data: {},
  readAt: null,
  createdAt: JUST_NOW(),
  ...over,
});

function listing(notifications: Record<string, unknown>[], unreadCount?: number) {
  server.use(
    http.get(`${BASE}/notifications`, () =>
      HttpResponse.json({
        notifications,
        unreadCount:
          unreadCount ?? notifications.filter((n) => n.readAt === null).length,
      }),
    ),
  );
}

beforeEach(() => {
  listing([item()]);
});

describe("the list", () => {
  it("shows a notification's title, time and link", async () => {
    render(<Notifications />, { route: "/app/notifications" });

    expect(await screen.findByText(/you earned your certificate of completion/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open/i })).toHaveAttribute(
      "href",
      "/app/certificates",
    );
  });

  it("shows the body when there is one", async () => {
    listing([
      item({
        type: "project_rejected",
        title: "Your capstone project was not accepted",
        body: "The repository was copied.",
      }),
    ]);
    render(<Notifications />, { route: "/app/notifications" });

    expect(await screen.findByText(/the repository was copied/i)).toBeInTheDocument();
  });

  /**
   * §5.17's copy, verbatim — with a typographic apostrophe, which is why this
   * matches `’` rather than an ASCII quote.
   */
  it("says you are all caught up when there are none", async () => {
    listing([]);
    render(<Notifications />, { route: "/app/notifications" });

    expect(await screen.findByText("You’re all caught up.")).toBeInTheDocument();
  });

  it("reports the unread count", async () => {
    listing([item(), item({ id: "b", readAt: at(HOUR) })]);
    render(<Notifications />, { route: "/app/notifications" });

    expect(await screen.findByText(/1 unread notification\./i)).toBeInTheDocument();
  });

  /** §8: read and unread are distinguished by a word, not only a background. */
  it("labels a read notification as read", async () => {
    listing([item({ readAt: at(HOUR) })]);
    render(<Notifications />, { route: "/app/notifications" });

    expect(await screen.findByText("Read")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /mark as read/i })).not.toBeInTheDocument();
  });

  it("falls back to a neutral icon for a kind it does not know", async () => {
    // The API may ship a notification type before this screen knows it.
    listing([item({ type: "something_new_entirely" })]);
    render(<Notifications />, { route: "/app/notifications" });

    expect(await screen.findByText(/you earned your/i)).toBeInTheDocument();
  });
});

describe("the three groups", () => {
  it("groups by Today, This week and Earlier", async () => {
    listing([
      item({ id: "a", title: "From today", createdAt: JUST_NOW() }),
      item({ id: "b", title: "From this week", createdAt: at(3 * DAY) }),
      item({ id: "c", title: "From ages ago", createdAt: at(30 * DAY) }),
    ]);
    render(<Notifications />, { route: "/app/notifications" });

    expect(await screen.findByRole("heading", { name: "Today" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "This week" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Earlier" })).toBeInTheDocument();
  });

  /** An empty group is not rendered — §5.17 shows three headings, not three empties. */
  it("omits a group with nothing in it", async () => {
    listing([item({ createdAt: JUST_NOW() })]);
    render(<Notifications />, { route: "/app/notifications" });

    expect(await screen.findByRole("heading", { name: "Today" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Earlier" })).not.toBeInTheDocument();
  });

  /**
   * "This week" is the last seven days, not the calendar week. On a Monday
   * morning a calendar week would show an empty "This week" and bury Sunday's
   * notification under "Earlier".
   */
  it("counts six days ago as this week", async () => {
    listing([item({ createdAt: at(6 * DAY) })]);
    render(<Notifications />, { route: "/app/notifications" });

    expect(await screen.findByRole("heading", { name: "This week" })).toBeInTheDocument();
  });
});

describe("marking read", () => {
  it("marks one read", async () => {
    let asked = false;
    server.use(
      http.patch(`${BASE}/notifications/${ID}/read`, () => {
        asked = true;
        return HttpResponse.json({ readAt: new Date().toISOString() });
      }),
    );
    render(<Notifications />, { route: "/app/notifications" });

    await userEvent.click(await screen.findByRole("button", { name: /mark as read/i }));

    await waitFor(() => expect(asked).toBe(true));
  });

  it("marks all read", async () => {
    let asked = false;
    server.use(
      http.post(`${BASE}/notifications/read-all`, () => {
        asked = true;
        return HttpResponse.json({ marked: 1 });
      }),
    );
    render(<Notifications />, { route: "/app/notifications" });

    await userEvent.click(await screen.findByRole("button", { name: /mark all as read/i }));

    await waitFor(() => expect(asked).toBe(true));
  });

  /** Nothing to mark, so no button offering to. */
  it("offers no mark all when nothing is unread", async () => {
    listing([item({ readAt: at(HOUR) })]);
    render(<Notifications />, { route: "/app/notifications" });

    await screen.findByText("Read");
    expect(screen.queryByRole("button", { name: /mark all as read/i })).not.toBeInTheDocument();
  });

  it("surfaces a failure to load", async () => {
    server.use(
      http.get(`${BASE}/notifications`, () =>
        HttpResponse.json({ error: "Not right now." }, { status: 500 }),
      ),
    );
    render(<Notifications />, { route: "/app/notifications" });

    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});

describe("accessibility", () => {
  it("has no axe violations", async () => {
    listing([
      item({ id: "a", createdAt: JUST_NOW() }),
      item({ id: "b", createdAt: at(30 * DAY), readAt: at(HOUR) }),
    ]);
    const { container } = render(<Notifications />, { route: "/app/notifications" });

    await screen.findByRole("heading", { name: "Today" });
    await expectNoAxeViolations(container);
  });
});
