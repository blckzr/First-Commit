import { beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { screen } from "@testing-library/react";
import { render } from "../../test/render";
import { server } from "../../test/server";
import { expectNoAxeViolations } from "../../test/axe";
import { Overview } from "./Overview";

const BASE = "http://localhost:4000";

/**
 * design.md §6.1 — the admin overview.
 *
 * This was the last screen in the app on hard-coded data, which mattered more
 * here than anywhere else: a page whose entire job is to say what needs doing is
 * worse than blank when its numbers are invented. Most of these tests are about
 * the screen reporting **what the API said** — including zero.
 */

const empty = {
  openAiFlags: 0,
  openProjectFlags: 0,
  draftCount: 0,
  drafts: [],
  missingTemplates: [],
  strugglingModules: [],
  strugglingMilestones: [],
  activeLearners: 0,
  activeWithinDays: 30,
  certificatesThisMonth: 0,
  revokedThisMonth: 0,
};

function overview(over: Record<string, unknown> = {}) {
  server.use(http.get(`${BASE}/admin/overview`, () => HttpResponse.json({ ...empty, ...over })));
}

beforeEach(() => overview());

describe("needs review", () => {
  it("shows the counts the API returned", async () => {
    overview({ openAiFlags: 7, openProjectFlags: 2 });
    render(<Overview />, { route: "/admin" });

    expect(await screen.findByText("7 flagged AI feedback")).toBeInTheDocument();
    expect(screen.getByText("2 flagged projects")).toBeInTheDocument();
  });

  it("says one project in the singular", async () => {
    overview({ openProjectFlags: 1 });
    render(<Overview />, { route: "/admin" });

    expect(await screen.findByText("1 flagged project")).toBeInTheDocument();
  });

  /**
   * **Zero is an answer, not an empty slot.** "Nothing needs attention" is what
   * an admin most wants to be able to trust, so it is stated rather than left
   * to be inferred from a blank panel.
   */
  it("says so when nothing is waiting", async () => {
    render(<Overview />, { route: "/admin" });

    expect(await screen.findByText(/nothing is waiting for a decision/i)).toBeInTheDocument();
  });
});

describe("content", () => {
  it("lists drafts with when they were edited", async () => {
    overview({
      draftCount: 1,
      drafts: [
        { title: "Components in Vue", moduleSlug: "vue-components", updatedAt: "2026-10-28T10:00:00Z" },
      ],
    });
    render(<Overview />, { route: "/admin" });

    expect(await screen.findByText("Components in Vue")).toBeInTheDocument();
    expect(screen.getByText(/draft · edited/i)).toBeInTheDocument();
  });

  /** The API returns at most five; the count is the real total. */
  it("says how many more drafts there are than it lists", async () => {
    overview({
      draftCount: 8,
      drafts: [{ title: "One", moduleSlug: "a", updatedAt: "2026-10-28T10:00:00Z" }],
    });
    render(<Overview />, { route: "/admin" });

    expect(await screen.findByText(/and 7 more drafts/i)).toBeInTheDocument();
  });

  /**
   * **A missing template is a blocked learner, not untidiness**, and naming the
   * technology is what makes it actionable.
   */
  it("names the brief and the technology that has no template", async () => {
    overview({ missingTemplates: [{ briefTitle: "Task tracker", technology: "Vue" }] });
    render(<Overview />, { route: "/admin" });

    expect(await screen.findByText("Task tracker")).toBeInTheDocument();
    expect(screen.getByText(/no vue starter template/i)).toBeInTheDocument();
    expect(screen.getByText(/learners cannot start it/i)).toBeInTheDocument();
  });

  it("says so when everything is published", async () => {
    render(<Overview />, { route: "/admin" });

    expect(await screen.findByText(/everything is published/i)).toBeInTheDocument();
  });
});

describe("learners struggling", () => {
  /**
   * An admin reading "41%" has to know 41% of what. The API counts per learner,
   * so the caption says learners.
   */
  it("says what the pass rate is a rate of", async () => {
    overview({
      strugglingModules: [
        { slug: "arrays", title: "Arrays and objects", learners: 18, passRate: 0.41 },
      ],
    });
    render(<Overview />, { route: "/admin" });

    expect(await screen.findByText("Arrays and objects")).toBeInTheDocument();
    expect(screen.getByText("41% of 18 learners passed")).toBeInTheDocument();
  });

  it("shows a milestone learners are stuck on", async () => {
    overview({
      strugglingMilestones: [
        { title: "Save tasks", briefTitle: "Task tracker", attempted: 13, stuckRate: 0.38 },
      ],
    });
    render(<Overview />, { route: "/admin" });

    expect(await screen.findByText("Save tasks")).toBeInTheDocument();
    expect(screen.getByText(/38% of 13 still stuck/i)).toBeInTheDocument();
  });

  it("says so when nothing is below the threshold", async () => {
    render(<Overview />, { route: "/admin" });

    expect(await screen.findByText(/no module or milestone is below/i)).toBeInTheDocument();
  });
});

describe("the footer line", () => {
  /**
   * The window comes from the API, so the caption cannot drift from what was
   * actually counted — "active" meaning 30 days here and 7 there would be
   * invisible.
   */
  it("takes the active window from the API rather than hard-coding it", async () => {
    overview({ activeLearners: 214, activeWithinDays: 14, certificatesThisMonth: 18 });
    render(<Overview />, { route: "/admin" });

    expect(await screen.findByText(/in the last 14 days/i)).toBeInTheDocument();
    // 18 appears twice on purpose: the Certificates panel's count and the
    // footer line's total. Asserted on the sentence, not on the digits.
    expect(screen.getByText(/certificates this month/i)).toBeInTheDocument();
  });

  it("reports a revoked certificate rather than claiming all are valid", async () => {
    overview({ certificatesThisMonth: 5, revokedThisMonth: 2 });
    render(<Overview />, { route: "/admin" });

    // Twice on purpose: the caption and the badge beside it (§8 — a status is
    // text as well as colour, so the badge repeats the words).
    expect(await screen.findAllByText(/2 revoked/i)).toHaveLength(2);
    expect(screen.queryByText(/all valid/i)).not.toBeInTheDocument();
  });

  it("says all valid when none were revoked", async () => {
    overview({ certificatesThisMonth: 5 });
    render(<Overview />, { route: "/admin" });

    expect(await screen.findByText(/all valid/i)).toBeInTheDocument();
  });
});

describe("when it cannot load", () => {
  /** Better blank than invented: no panel should show a number it did not get. */
  it("says so instead of showing zeros", async () => {
    server.use(
      http.get(`${BASE}/admin/overview`, () =>
        HttpResponse.json({ error: "Not right now." }, { status: 500 }),
      ),
    );
    render(<Overview />, { route: "/admin" });

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText(/nothing is waiting/i)).not.toBeInTheDocument();
  });
});

describe("accessibility", () => {
  it("has no axe violations", async () => {
    overview({
      openAiFlags: 7,
      draftCount: 1,
      drafts: [{ title: "A draft", moduleSlug: "a", updatedAt: "2026-10-28T10:00:00Z" }],
      strugglingModules: [{ slug: "arrays", title: "Arrays", learners: 18, passRate: 0.41 }],
    });
    const { container } = render(<Overview />, { route: "/admin" });

    await screen.findByText("7 flagged AI feedback");
    await expectNoAxeViolations(container);
  });
});
