import { beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { render } from "../../test/render";
import { server } from "../../test/server";
import { expectNoAxeViolations } from "../../test/axe";
import { Reviews } from "./Reviews";

const BASE = "http://localhost:4000";
const FLAG_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff";

/**
 * design.md §6.6 — Project reviews.
 *
 * **A flag is a question, not a verdict**, and most of what is asserted here is
 * that the screen reads that way: the evidence sits beside the learner's name,
 * nothing can be decided without a reason, and the one outcome that takes
 * something away from somebody says so on the button rather than in a changelog.
 */

const flag = (over: Record<string, unknown> = {}) => ({
  id: FLAG_ID,
  type: "single_commit",
  status: "open",
  details: { commits: 1, milestones: 5 },
  createdAt: "2026-10-20T10:00:00Z",
  decidedAt: null,
  decisionReason: null,
  project: {
    id: "p1",
    briefTitle: "Task tracker",
    repoFullName: "learner/task-tracker",
    demoUrl: null,
  },
  learner: { id: "u1", name: "Jan Kevin Gerona" },
  ...over,
});

function listing(flags: Record<string, unknown>[]) {
  server.use(http.get(`${BASE}/admin/integrity`, () => HttpResponse.json({ flags })));
}

function detail(over: Record<string, unknown> = {}) {
  server.use(
    http.get(`${BASE}/admin/integrity/${FLAG_ID}`, () =>
      HttpResponse.json({
        flag: { id: FLAG_ID, type: "single_commit", status: "open", details: {} },
        project: {
          briefTitle: "Task tracker",
          repoFullName: "learner/task-tracker",
          learnerName: "Jan Kevin Gerona",
        },
        commits: [
          {
            sha: "a1b2c3d4e5",
            message: "Everything",
            authorLogin: "learner",
            pushedAt: "2026-10-20T09:00:00Z",
          },
        ],
        explanations: [
          {
            title: "Add and edit tasks",
            question: "How does your form stop an empty task?",
            answer: "idk",
          },
        ],
        ...over,
      }),
    ),
  );
}

function rulingSucceeds(seen?: (body: unknown) => void) {
  server.use(
    http.patch(`${BASE}/admin/integrity/${FLAG_ID}`, async ({ request }) => {
      seen?.(await request.json());
      return HttpResponse.json({ status: "cleared" });
    }),
  );
}

beforeEach(() => {
  listing([flag()]);
  detail();
});

describe("the flag list", () => {
  it("shows the learner, the project and what was noticed", async () => {
    render(<Reviews />, { route: "/admin/reviews" });

    expect(await screen.findByText("Jan Kevin Gerona")).toBeInTheDocument();
    expect(screen.getAllByText("Task tracker").length).toBeGreaterThan(0);
    // Twice on purpose: once in the list row, once in the open panel's summary.
    expect(screen.getAllByText(/most work in one commit/i)).toHaveLength(2);
  });

  it("counts what is waiting", async () => {
    render(<Reviews />, { route: "/admin/reviews" });

    expect(await screen.findByRole("button", { name: /flagged \(1\)/i })).toBeInTheDocument();
  });

  it("says so when nothing is waiting", async () => {
    listing([]);
    render(<Reviews />, { route: "/admin/reviews" });

    expect(await screen.findByText(/nothing is waiting for review/i)).toBeInTheDocument();
  });

  /** The numbers behind a flag, as a sentence rather than raw JSON. */
  it("explains the signal in words", async () => {
    render(<Reviews />, { route: "/admin/reviews" });

    expect(await screen.findByText(/1 commit across 5 milestones/i)).toBeInTheDocument();
  });
});

describe("the evidence", () => {
  it("shows the commit history and the explanation answers", async () => {
    render(<Reviews />, { route: "/admin/reviews" });

    expect(await screen.findByText("a1b2c3d")).toBeInTheDocument();
    expect(screen.getByText(/how does your form stop/i)).toBeInTheDocument();
    expect(screen.getByText(/“idk”/)).toBeInTheDocument();
  });

  /** Not answered is not a weak answer — nothing required one. */
  it("distinguishes an unanswered question from a weak answer", async () => {
    detail({
      explanations: [{ title: "Add and edit tasks", question: "How?", answer: null }],
    });
    render(<Reviews />, { route: "/admin/reviews" });

    expect(await screen.findByText(/not answered/i)).toBeInTheDocument();
  });

  it("links the repository on GitHub", async () => {
    render(<Reviews />, { route: "/admin/reviews" });

    const link = await screen.findByRole("link", { name: /learner\/task-tracker/i });
    expect(link).toHaveAttribute("href", "https://github.com/learner/task-tracker");
  });
});

describe("deciding", () => {
  /**
   * §6 rule 10: an admin's correction is a logged override **with a required
   * reason**. The screen enforces it before the endpoint has to.
   */
  it("will not let anything be decided without a reason", async () => {
    render(<Reviews />, { route: "/admin/reviews" });

    for (const name of [/clear flag/i, /request explanation/i, /request milestone redo/i, /reject project/i]) {
      expect(await screen.findByRole("button", { name })).toBeDisabled();
    }
  });

  it("sends the ruling and the reason", async () => {
    let sent: unknown;
    rulingSucceeds((body) => (sent = body));
    render(<Reviews />, { route: "/admin/reviews" });

    await userEvent.type(
      await screen.findByLabelText(/reason/i),
      "Built offline; the history is consistent.",
    );
    await userEvent.click(screen.getByRole("button", { name: /clear flag/i }));

    await waitFor(() =>
      expect(sent).toEqual({
        status: "cleared",
        reason: "Built offline; the history is consistent.",
      }),
    );
  });

  /**
   * §6.6: "Rejecting a project revokes its Project Certificate." An admin
   * should not have to learn that from the changelog — the screen says it
   * beside the button that does it.
   */
  it("warns that rejecting revokes the certificate", async () => {
    render(<Reviews />, { route: "/admin/reviews" });

    expect(await screen.findByText(/revokes the project certificate/i)).toBeInTheDocument();
  });

  it("shows a ruling that has already been made", async () => {
    listing([
      flag({ status: "cleared", decisionReason: "Checked the history by hand." }),
    ]);
    render(<Reviews />, { route: "/admin/reviews" });

    expect(await screen.findByText(/already decided/i)).toBeInTheDocument();
    expect(screen.getByText(/checked the history by hand/i)).toBeInTheDocument();
  });

  it("surfaces a refusal from the API", async () => {
    server.use(
      http.patch(`${BASE}/admin/integrity/${FLAG_ID}`, () =>
        HttpResponse.json({ error: "Say why this is being withdrawn." }, { status: 400 }),
      ),
    );
    render(<Reviews />, { route: "/admin/reviews" });

    await userEvent.type(await screen.findByLabelText(/reason/i), "x");
    await userEvent.click(screen.getByRole("button", { name: /clear flag/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/say why/i);
  });
});

describe("accessibility", () => {
  it("has no axe violations", async () => {
    const { container } = render(<Reviews />, { route: "/admin/reviews" });

    // Wait for the detail panel, so the pass covers the form controls too —
    // the list alone would miss the textarea and the four ruling buttons.
    await screen.findByLabelText(/reason/i);
    await expectNoAxeViolations(container);
  });
});
