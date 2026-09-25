import { beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { render } from "../../test/render";
import { server } from "../../test/server";
import { expectNoAxeViolations } from "../../test/axe";
import { Roadmaps } from "./Roadmaps";

const BASE = "http://localhost:4000";

const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString();

interface Summary {
  id: string;
  careerPathId: string;
  careerPathTitle: string;
  trackTitle: string | null;
  status: string;
  weeklyHours: number | null;
  passedCount: number;
  totalCount: number;
  sharedCount: number;
  lastStudiedAt: string | null;
}

const web: Summary = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  careerPathId: "path-web",
  careerPathTitle: "Junior Web Developer",
  trackTitle: "Frontend with React",
  status: "active",
  weeklyHours: 6,
  passedCount: 6,
  totalCount: 16,
  sharedCount: 0,
  lastStudiedAt: daysAgo(0),
};

const data: Summary = {
  ...web,
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  careerPathTitle: "Junior Data Analyst",
  trackTitle: null,
  passedCount: 3,
  totalCount: 14,
  sharedCount: 3,
  lastStudiedAt: daysAgo(5),
};

/** What the endpoint received, so archiving can be checked at the wire. */
let sent: { id?: string; body?: unknown } | null = null;

function listing(roadmaps: Summary[]) {
  server.use(http.get(`${BASE}/roadmaps`, () => HttpResponse.json({ roadmaps })));
}

beforeEach(() => {
  sent = null;
  listing([web]);
  server.use(
    http.patch(`${BASE}/roadmaps/:id`, async ({ params, request }) => {
      sent = { id: params.id as string, body: await request.json() };
      return HttpResponse.json({ roadmap: {} });
    }),
  );
});

const open = async () => {
  const view = render(<Roadmaps />);
  await screen.findByRole("heading", { name: "My roadmaps" });
  return view;
};

const card = (name: string) =>
  screen.getByRole("heading", { name }).closest("li") as HTMLElement;

describe("§5.12 — the list", () => {
  it("names each roadmap by its path and track", async () => {
    listing([web, data]);
    await open();

    expect(
      screen.getByRole("heading", { name: "Junior Web Developer, Frontend with React" }),
    ).toBeInTheDocument();
    // No track chosen yet, so the name is the path alone rather than a
    // trailing comma.
    expect(screen.getByRole("heading", { name: "Junior Data Analyst" })).toBeInTheDocument();
  });

  /**
   * §6 rule 7: passing a module once counts everywhere. §5.12 says so in
   * words — "(3 shared)" — so a learner can see the credit carried over
   * rather than wondering why a roadmap they never opened has progress.
   */
  it("reports progress, and says how much of it is shared", async () => {
    listing([web, data]);
    await open();

    expect(within(card("Junior Web Developer, Frontend with React")).getByText(
      "6 of 16 modules passed",
    )).toBeInTheDocument();
    expect(within(card("Junior Data Analyst")).getByText(
      "3 of 14 modules passed (3 shared)",
    )).toBeInTheDocument();
  });

  it("pairs the bar with the same text (§7)", async () => {
    await open();
    expect(
      screen.getByRole("progressbar", { name: "6 of 16 modules passed" }),
    ).toHaveAttribute("aria-valuenow", "38");
  });

  it.each([
    [0, "Last studied today"],
    [1, "Last studied yesterday"],
    [5, "Last studied 5 days ago"],
    [40, "Last studied a month ago"],
  ])("says a roadmap studied %s days ago was %s", async (days, expected) => {
    listing([{ ...web, lastStudiedAt: daysAgo(days) }]);
    await open();
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it("says so when a roadmap has not been opened", async () => {
    listing([{ ...web, lastStudiedAt: null }]);
    await open();
    expect(screen.getByText("Not started yet")).toBeInTheDocument();
  });

  /** §9: an empty state says what to do next, not "Nothing here". */
  it("tells a learner with no roadmaps what to do", async () => {
    listing([]);
    await open();
    expect(screen.getByText("Choose a target job to build your first roadmap.")).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    listing([web, data]);
    const { container } = await open();
    await expectNoAxeViolations(container);
  });
});

describe("§5.12 — archived roadmaps", () => {
  const archived: Summary = { ...data, status: "archived" };

  /** §5.12: "hidden entirely when there are no archived roadmaps". */
  it("shows no archived section when there are none", async () => {
    await open();
    expect(screen.queryByText(/Archived \(/)).not.toBeInTheDocument();
  });

  it("counts them and keeps them behind a disclosure", async () => {
    listing([web, archived]);
    await open();

    expect(screen.getByRole("heading", { name: "Archived (1)" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Junior Data Analyst" })).not.toBeInTheDocument();

    const show = screen.getByRole("button", { name: "Show" });
    expect(show).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(show);

    expect(screen.getByRole("heading", { name: "Junior Data Analyst" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hide" })).toHaveAttribute("aria-expanded", "true");
  });

  it("archives a roadmap", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Archive" }));

    await waitFor(() => expect(sent?.id).toBe(web.id));
    expect(sent?.body).toEqual({ status: "archived" });
  });

  it("restores an archived roadmap", async () => {
    listing([archived]);
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Show" }));
    await userEvent.click(screen.getByRole("button", { name: "Restore roadmap" }));

    await waitFor(() => expect(sent?.body).toEqual({ status: "active" }));
  });

  /** An archived roadmap is put away, not opened — and not deleted (§6 rule 5). */
  it("offers restore rather than open on an archived roadmap", async () => {
    listing([archived]);
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Show" }));

    const row = card("Junior Data Analyst");
    expect(within(row).queryByRole("link", { name: "Open roadmap" })).not.toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
  });

  it("says so when archiving fails, and keeps the roadmap listed", async () => {
    server.use(
      http.patch(`${BASE}/roadmaps/:id`, () =>
        HttpResponse.json({ error: "Not found" }, { status: 404 }),
      ),
    );
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Archive" }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(
      screen.getByRole("heading", { name: "Junior Web Developer, Frontend with React" }),
    ).toBeInTheDocument();
  });
});

describe("§5.12 — opening one", () => {
  it("links to the roadmap chart", async () => {
    await open();
    expect(screen.getByRole("link", { name: "Open roadmap" })).toHaveAttribute(
      "href",
      `/app/roadmap/${web.id}`,
    );
  });
});
