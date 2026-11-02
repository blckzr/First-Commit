import { beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { render } from "../../test/render";
import { server } from "../../test/server";
import { expectNoAxeViolations } from "../../test/axe";
import { Analytics } from "./Analytics";

const BASE = "http://localhost:4000";
const PATH = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const REACT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

/**
 * design.md §6.9 — Analytics.
 *
 * Almost every test here is about a number the screen **refuses** to print,
 * because that is where this screen earns its place:
 *
 * - A rate below the API's threshold is not 0%, it is "too few to say". A page
 *   that printed 0% would send an author to rewrite a module two people have
 *   tried.
 * - "Switches between options" is unanswerable — the schema overwrites the
 *   previous choice — so the screen prints the reason rather than a zero.
 * - A share ruled wrong with nothing yet ruled on is not 0%.
 *
 * The bars are deliberately not tested for width. They are presentational
 * widths beside numbers already in the DOM; the numbers are the assertion.
 */

const funnel = (over: Record<string, unknown> = {}) => ({
  pathId: PATH,
  requiredCoreModules: 13,
  stages: [
    { key: "started", label: "Started a roadmap", learners: 112 },
    { key: "finished_core", label: "Finished the core modules", learners: 47 },
    { key: "chose_technology", label: "Chose a technology", learners: 44 },
    { key: "certificate_completion", label: "Earned the Certificate of Completion", learners: 40 },
    { key: "started_capstone", label: "Started a capstone", learners: 31 },
    { key: "certificate_project", label: "Earned the Project Certificate", learners: 19 },
  ],
  roadmaps: 118,
  ...over,
});

const moduleRow = (over: Record<string, unknown> = {}) => ({
  id: "m1",
  slug: "js-basics",
  title: "JavaScript basics",
  kind: "core",
  technology: null,
  attempted: 40,
  passed: 30,
  passRate: 0.75,
  started: 60,
  completed: 45,
  droppedOff: 15,
  dropOffRate: 0.25,
  ...over,
});

function analytics(over: Record<string, unknown> = {}) {
  const data = {
    paths: { paths: [{ id: PATH, title: "Junior Web Developer", status: "published" }] },
    funnel: funnel(),
    modules: {
      modules: [moduleRow()],
      technologies: [{ id: REACT, name: "React" }],
      enoughLearners: 3,
    },
    milestones: { milestones: [], enoughLearners: 3 },
    technologies: {
      decisions: [],
      switchesRecorded: false,
      switchesReason:
        "A technology choice is stored once per roadmap and decision, so changing it overwrites the previous answer. Nothing records that a switch happened.",
    },
    ai: { sources: [], enoughLearners: 3 },
    certificates: { months: [] },
    ...over,
  };

  server.use(
    http.get(`${BASE}/admin/analytics/paths`, () => HttpResponse.json(data.paths)),
    http.get(`${BASE}/admin/analytics/funnel`, () => HttpResponse.json(data.funnel)),
    http.get(`${BASE}/admin/analytics/modules`, () => HttpResponse.json(data.modules)),
    http.get(`${BASE}/admin/analytics/milestones`, () => HttpResponse.json(data.milestones)),
    http.get(`${BASE}/admin/analytics/technologies`, () => HttpResponse.json(data.technologies)),
    http.get(`${BASE}/admin/analytics/ai`, () => HttpResponse.json(data.ai)),
    http.get(`${BASE}/admin/analytics/certificates`, () => HttpResponse.json(data.certificates)),
  );
}

const at = { route: "/admin/analytics" };

beforeEach(() => analytics());

describe("the journey funnel", () => {
  it("names each stage with the learners who reached it", async () => {
    render(<Analytics />, at);

    expect(await screen.findByText("Started a roadmap")).toBeInTheDocument();
    expect(screen.getByText("112")).toBeInTheDocument();
    expect(screen.getByText("Earned the Project Certificate")).toBeInTheDocument();
    expect(screen.getByText("19")).toBeInTheDocument();
  });

  /**
   * **The drop is a figure, not only a shorter bar.** "65 of 112 stopped here"
   * is what an admin acts on; a bar they have to eyeball is not.
   */
  it("says how many stopped at each stage", async () => {
    render(<Analytics />, at);

    expect(await screen.findByText("65 of 112 stopped here.")).toBeInTheDocument();
  });

  /** So "finished core" is not a number whose definition has to be guessed. */
  it("says what finishing core means", async () => {
    render(<Analytics />, at);

    expect(
      await screen.findByText(/passing all 13 modules this path requires/i),
    ).toBeInTheDocument();
  });

  it("asks for the chosen career path", async () => {
    analytics({
      paths: {
        paths: [
          { id: PATH, title: "Junior Web Developer", status: "published" },
          { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", title: "Data", status: "published" },
        ],
      },
    });
    let asked: string | null = null;
    render(<Analytics />, at);

    const select = await screen.findByLabelText("Career path");
    server.use(
      http.get(`${BASE}/admin/analytics/funnel`, ({ request }) => {
        asked = new URL(request.url).searchParams.get("path");
        return HttpResponse.json(funnel());
      }),
    );
    await userEvent.selectOptions(select, "cccccccc-cccc-4ccc-8ccc-cccccccccccc");

    await waitFor(() => expect(asked).toBe("cccccccc-cccc-4ccc-8ccc-cccccccccccc"));
  });

  it("says there is nothing to measure when no path is published", async () => {
    analytics({ paths: { paths: [] } });
    render(<Analytics />, at);

    expect(await screen.findByText(/no career path is published yet/i)).toBeInTheDocument();
  });
});

describe("modules", () => {
  it("shows pass rate and drop-off as separate figures", async () => {
    render(<Analytics />, at);

    await screen.findByText("JavaScript basics");
    const row = screen.getByRole("row", { name: /javascript basics/i });

    expect(within(row).getByText("75%")).toBeInTheDocument();
    expect(within(row).getByText("30 of 40")).toBeInTheDocument();
    expect(within(row).getByText("25%")).toBeInTheDocument();
  });

  /**
   * **The assertion this screen exists for.** The API returns `null` below its
   * threshold; a screen rendering that as 0% would be worse than one showing
   * nothing, because 0% looks like a measurement.
   */
  it("says too few to say rather than printing a rate", async () => {
    analytics({
      modules: {
        modules: [
          moduleRow({ attempted: 1, passed: 0, passRate: null, dropOffRate: null, started: 1 }),
        ],
        technologies: [],
        enoughLearners: 3,
      },
    });
    render(<Analytics />, at);

    const row = await screen.findByRole("row", { name: /javascript basics/i });

    expect(within(row).getAllByText("too few to say")).toHaveLength(2);
    expect(within(row).queryByText("0%")).not.toBeInTheDocument();
  });

  it("says where the threshold is", async () => {
    render(<Analytics />, at);

    expect(
      await screen.findByText(/a rate is withheld below 3 learners/i),
    ).toBeInTheDocument();
  });

  it("filters by technology", async () => {
    let asked: string | null = null;
    render(<Analytics />, at);

    const select = await screen.findByLabelText("Technology");
    /* The options come from the modules query, so they arrive after the select. */
    await within(select).findByRole("option", { name: "React" });
    server.use(
      http.get(`${BASE}/admin/analytics/modules`, ({ request }) => {
        asked = new URL(request.url).searchParams.get("technology");
        return HttpResponse.json({ modules: [], technologies: [], enoughLearners: 3 });
      }),
    );
    await userEvent.selectOptions(select, REACT);

    await waitFor(() => expect(asked).toBe(REACT));
  });

  /**
   * **A module with no rate sorts last, not first.** It is not 0%, so ranking
   * it as if it were would put the module two people tried above the one
   * fifteen are stuck on — which is the whole purpose of sorting by pass rate.
   */
  it("sorts rows with no rate last when sorting by pass rate", async () => {
    analytics({
      modules: {
        modules: [
          moduleRow({ id: "m1", slug: "untried", title: "Untried", passRate: null }),
          moduleRow({ id: "m2", slug: "hard", title: "Hard module", passRate: 0.2 }),
          moduleRow({ id: "m3", slug: "fine", title: "Fine module", passRate: 0.9 }),
        ],
        technologies: [],
        enoughLearners: 3,
      },
    });
    render(<Analytics />, at);

    await userEvent.selectOptions(await screen.findByLabelText("Sort by"), "passRate");

    const rows = screen.getAllByRole("row").slice(1);
    expect(rows.map((row) => row.textContent?.split("·")[0]?.trim().slice(0, 4))).toEqual([
      "Hard",
      "Fine",
      "Untr",
    ]);
  });
});

describe("technology choices", () => {
  /**
   * §6.9 asks for switches; the schema overwrites the previous choice and
   * records nothing. "0 switches" would read as "nobody switches", which is a
   * claim this platform cannot make.
   */
  it("says switches are not recorded, with the reason", async () => {
    render(<Analytics />, at);

    expect(await screen.findByText(/switches are not recorded/i)).toBeInTheDocument();
    expect(screen.getByText(/overwrites the previous answer/i)).toBeInTheDocument();
    expect(screen.queryByText(/0 switches/i)).not.toBeInTheDocument();
  });

  it("shows the share taking each option", async () => {
    analytics({
      technologies: {
        decisions: [
          {
            id: "d1",
            title: "Choose a framework",
            trackTitle: "Frontend",
            undecided: 2,
            options: [
              { technology: "React", learners: 30, recommendedTo: 28 },
              { technology: "Vue", learners: 8, recommendedTo: 2 },
            ],
          },
        ],
        switchesRecorded: false,
        switchesReason: "Nothing records that a switch happened.",
      },
    });
    render(<Analytics />, at);

    expect(await screen.findByText("React")).toBeInTheDocument();
    expect(screen.getByText("(75%)")).toBeInTheDocument();
    expect(screen.getByText(/28 of these were recommended it/i)).toBeInTheDocument();
  });

  /** Null until chosen — a roadmap that reached the decision and stopped. */
  it("counts learners who reached the decision and did not answer", async () => {
    analytics({
      technologies: {
        decisions: [
          {
            id: "d1",
            title: "Choose a framework",
            trackTitle: "Frontend",
            undecided: 2,
            options: [{ technology: "React", learners: 30, recommendedTo: 28 }],
          },
        ],
        switchesRecorded: false,
        switchesReason: "Nothing records that a switch happened.",
      },
    });
    render(<Analytics />, at);

    expect(
      await screen.findByText(/2 learners have reached this decision and not answered it/i),
    ).toBeInTheDocument();
  });
});

describe("AI quality", () => {
  /**
   * **The share ruled wrong is of the flags an admin has decided.** An open
   * flag is a question nobody has answered; counting it as "not wrong" makes
   * the model look better the further behind an admin falls.
   */
  it("measures the wrong share over ruled flags, and says so", async () => {
    analytics({
      ai: {
        sources: [
          {
            source: "code_feedback",
            outputs: 200,
            flags: 12,
            flagRate: 0.06,
            open: 4,
            confirmedWrong: 2,
            confirmedCorrect: 6,
            wrongShare: 0.25,
          },
        ],
        enoughLearners: 3,
      },
    });
    render(<Analytics />, at);

    const row = await screen.findByRole("row", { name: /code feedback/i });

    expect(within(row).getByText("25% (2 of 8)")).toBeInTheDocument();
    expect(
      screen.getByText(/of the flags an admin has decided, not of all of them/i),
    ).toBeInTheDocument();
  });

  it("says nothing has been ruled on rather than showing a share", async () => {
    analytics({
      ai: {
        sources: [
          {
            source: "code_feedback",
            outputs: 200,
            flags: 3,
            flagRate: 0.015,
            open: 3,
            confirmedWrong: 0,
            confirmedCorrect: 0,
            wrongShare: null,
          },
        ],
        enoughLearners: 3,
      },
    });
    render(<Analytics />, at);

    const row = await screen.findByRole("row", { name: /code feedback/i });

    expect(within(row).getByText("nothing ruled on yet")).toBeInTheDocument();
    expect(within(row).queryByText("0%")).not.toBeInTheDocument();
  });
});

describe("certificates over time", () => {
  it("shows issued and withdrawn by month", async () => {
    analytics({
      certificates: {
        months: [
          { month: "2026-10-01T00:00:00Z", type: "completion", issued: 9, revoked: 2 },
        ],
      },
    });
    render(<Analytics />, at);

    expect(await screen.findByText(/Oct 2026/)).toBeInTheDocument();
    expect(screen.getByText("9")).toBeInTheDocument();
    expect(screen.getByText(/2 of these were later withdrawn/i)).toBeInTheDocument();
  });

  /** So the pair of numbers cannot be misread as "withdrawn this month". */
  it("says which month a withdrawal is counted in", async () => {
    analytics({
      certificates: {
        months: [{ month: "2026-10-01T00:00:00Z", type: "completion", issued: 9, revoked: 2 }],
      },
    });
    render(<Analytics />, at);

    expect(
      await screen.findByText(/counted in the month the certificate was issued/i),
    ).toBeInTheDocument();
  });
});

describe("failures", () => {
  it("shows an error for the section that failed, and keeps the others", async () => {
    server.use(
      http.get(`${BASE}/admin/analytics/ai`, () =>
        HttpResponse.json({ error: "That did not load." }, { status: 500 }),
      ),
    );
    render(<Analytics />, at);

    expect(await screen.findByRole("alert")).toHaveTextContent(/did not load/i);
    /*
     * The funnel is a separate query, so one section failing does not blank the
     * page — awaited rather than read synchronously, because the two queries
     * settle independently and the alert is not a signal that the funnel has.
     */
    expect(await screen.findByText("Started a roadmap")).toBeInTheDocument();
  });
});

describe("accessibility", () => {
  it("has no axe violations", async () => {
    const { container } = render(<Analytics />, at);

    await screen.findByText("JavaScript basics");
    await expectNoAxeViolations(container);
  });

  /**
   * **Nothing here is behind an `aria-hidden` copy.** The bars are widths over
   * numbers that are already in the DOM — the same decision the roadmap chart
   * reached, for the same reason (§12).
   */
  it("makes the wide tables reachable by keyboard", async () => {
    render(<Analytics />, at);

    const modules = await screen.findByRole("region", { name: "Modules" });
    expect(modules).toHaveAttribute("tabindex", "0");
  });
});
