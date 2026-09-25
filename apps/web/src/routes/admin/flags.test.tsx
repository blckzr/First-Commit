import { beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { render } from "../../test/render";
import { server } from "../../test/server";
import { expectNoAxeViolations } from "../../test/axe";
import { Flags } from "./Flags";

const BASE = "http://localhost:4000";
const FLAG_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff";

interface Flag {
  id: string;
  reason: string;
  status: "open" | "confirmed_wrong" | "confirmed_correct";
  createdAt: string;
  adminNotes: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  source: string;
  sourceId: string;
  output: unknown;
  learner: { id: string; fullName: string };
}

const open: Flag = {
  id: FLAG_ID,
  reason: "It told me to start at index 1, which is what I already had.",
  status: "open",
  createdAt: "2026-09-20T10:00:00Z",
  adminNotes: null,
  reviewedAt: null,
  reviewedBy: null,
  source: "code_feedback",
  sourceId: "55555555-5555-4555-8555-555555555555",
  output: { summary: "Start at index 0.", rubric: "RUBRIC-NOTE" },
  learner: { id: "11111111-1111-1111-1111-111111111111", fullName: "Jan Kevin Gerona" },
};

const ruled: Flag = {
  ...open,
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  reason: "The roadmap put me on Vue when I said React.",
  status: "confirmed_wrong",
  reviewedAt: "2026-09-21T09:00:00Z",
  reviewedBy: "The Admin",
  adminNotes: "The hint pointed at the wrong line.",
  learner: { id: "22222222-2222-2222-2222-222222222222", fullName: "Someone Else" },
};

/** The request the screen made, so the ruling can be checked at the wire. */
let sent: { id?: string; body?: unknown } | null = null;
let lastQuery: string | null = null;

function serve(flags: Flag[], counts: Record<string, number> = { open: 1 }) {
  server.use(
    http.get(`${BASE}/admin/flags`, ({ request }) => {
      lastQuery = new URL(request.url).search;
      return HttpResponse.json({ flags, counts });
    }),
    http.patch(`${BASE}/admin/flags/:id`, async ({ params, request }) => {
      sent = { id: params.id as string, body: await request.json() };
      return HttpResponse.json({ flag: { ...open, status: "confirmed_wrong" } });
    }),
  );
}

beforeEach(() => {
  sent = null;
  lastQuery = null;
  serve([open]);
});

const openScreen = async () => {
  const view = render(<Flags />);
  await screen.findByRole("heading", { name: "Flagged AI feedback" });
  return view;
};

describe("§6.8 — the list", () => {
  it("shows the learner's reason beside what the model wrote", async () => {
    await openScreen();

    expect(await screen.findByText(/It told me to start at index 1/)).toBeInTheDocument();
    expect(screen.getByText(/Start at index 0/)).toBeInTheDocument();
    expect(screen.getByText(/Jan Kevin Gerona/)).toBeInTheDocument();
  });

  /**
   * §6 rule 2 keeps a rubric from *learners*. Judging the model means reading
   * all of its output, which is the reason this screen is admin-only.
   */
  it("shows the parts a learner never receives", async () => {
    await openScreen();
    expect(await screen.findByText(/RUBRIC-NOTE/)).toBeInTheDocument();
  });

  it("names the source in words rather than the enum", async () => {
    await openScreen();
    expect(await screen.findByRole("heading", { name: "Code feedback" })).toBeInTheDocument();
    expect(screen.queryByText("code_feedback")).not.toBeInTheDocument();
  });

  /**
   * §6.9's "share of flags confirmed as wrong". The denominator is ruled-on
   * flags, so a growing queue cannot make the model look better.
   */
  it("reports the share that were the model's fault", async () => {
    serve([open], { open: 4, confirmed_wrong: 3, confirmed_correct: 1 });
    await openScreen();

    expect(await screen.findByText("4 waiting")).toBeInTheDocument();
    expect(screen.getByText(/3 of 4 ruled flags were the model's fault \(75%\)/)).toBeInTheDocument();
  });

  it("says so before anything has been ruled on", async () => {
    serve([open], { open: 2 });
    await openScreen();
    expect(await screen.findByText(/Nothing ruled on yet/)).toBeInTheDocument();
  });

  it("filters by source", async () => {
    await openScreen();
    await userEvent.click(screen.getByRole("button", { name: "Roadmap explanation" }));

    await waitFor(() => expect(lastQuery).toBe("?source=roadmap_generation"));
  });

  it("filters by status, and clears the filter on a second click", async () => {
    await openScreen();
    const chip = screen.getByRole("button", { name: "Open" });

    await userEvent.click(chip);
    await waitFor(() => expect(lastQuery).toBe("?status=open"));

    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    await waitFor(() => expect(lastQuery).toBe(""));
  });

  it("says nothing matches rather than looking broken", async () => {
    serve([], { open: 0 });
    await openScreen();
    expect(await screen.findByText("No learner has flagged AI output yet.")).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    serve([open, ruled], { open: 1, confirmed_wrong: 1 });
    const { container } = await openScreen();
    await screen.findByText(/It told me to start at index 1/);
    await expectNoAxeViolations(container);
  });
});

describe("§6.8 — ruling on a flag", () => {
  it("sends the ruling and the notes", async () => {
    await openScreen();
    await screen.findByText(/It told me to start at index 1/);

    await userEvent.type(
      screen.getByLabelText(/Notes/),
      "The hint pointed at the wrong line.",
    );
    await userEvent.click(screen.getByRole("button", { name: "Feedback was wrong" }));

    await waitFor(() => expect(sent?.id).toBe(FLAG_ID));
    expect(sent?.body).toEqual({
      status: "confirmed_wrong",
      notes: "The hint pointed at the wrong line.",
    });
  });

  it("sends a ruling with no notes as just the status", async () => {
    await openScreen();
    await screen.findByText(/It told me to start at index 1/);

    await userEvent.click(screen.getByRole("button", { name: "Feedback was correct" }));

    await waitFor(() => expect(sent?.body).toEqual({ status: "confirmed_correct" }));
  });

  /**
   * A ruling lives in `admin_activity_log`, which is append-only (§6 rule 9).
   * Offering "reopen" would promise something the log cannot support.
   */
  it("offers no way to reopen a ruling", async () => {
    serve([ruled], { confirmed_wrong: 1 });
    await openScreen();
    await screen.findByText(/put me on Vue/);

    expect(screen.queryByRole("button", { name: /Feedback was/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /reopen/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Notes/)).not.toBeInTheDocument();
  });

  it("shows who ruled and what they wrote", async () => {
    serve([ruled], { confirmed_wrong: 1 });
    await openScreen();

    expect(await screen.findByText(/The Admin/)).toBeInTheDocument();
    expect(screen.getByText("The hint pointed at the wrong line.")).toBeInTheDocument();
  });

  /** §8: status is icon + text + colour, never colour alone. */
  it.each([
    ["confirmed_wrong" as const, "Was wrong"],
    ["confirmed_correct" as const, "Was correct"],
  ])("states a %s ruling in words", async (status, label) => {
    serve([{ ...ruled, status }], { [status]: 1 });
    await openScreen();
    expect(await screen.findByText(label)).toBeInTheDocument();
  });

  it("says so when the ruling does not save", async () => {
    server.use(
      http.patch(`${BASE}/admin/flags/:id`, () =>
        HttpResponse.json({ error: "Not found" }, { status: 404 }),
      ),
    );
    await openScreen();
    await screen.findByText(/It told me to start at index 1/);

    await userEvent.click(screen.getByRole("button", { name: "Feedback was wrong" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Not found"));
  });

  /**
   * §6 rule 10. The screen must not suggest a ruling fixes the learner's
   * record, because it does not — their score and progress stand.
   */
  it("says plainly that a ruling changes no scores", async () => {
    await openScreen();
    expect(
      screen.getByText(/does not change anyone's score or progress/),
    ).toBeInTheDocument();
  });

  /** Each card rules on its own flag, not on whichever the screen loaded first. */
  it("rules on the right flag when several are listed", async () => {
    serve([{ ...open, id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }, open], { open: 2 });
    await openScreen();
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: "Feedback was wrong" })).toHaveLength(2),
    );

    await userEvent.click(screen.getAllByRole("button", { name: "Feedback was wrong" })[1]);

    await waitFor(() => expect(sent?.id).toBe(FLAG_ID));
  });
});

describe("§6.8 — when it cannot load", () => {
  it("explains rather than showing an empty list", async () => {
    server.use(
      http.get(`${BASE}/admin/flags`, () =>
        HttpResponse.json({ error: "Not found" }, { status: 404 }),
      ),
    );
    await openScreen();

    expect(await screen.findByText("Not found")).toBeInTheDocument();
  });
});
