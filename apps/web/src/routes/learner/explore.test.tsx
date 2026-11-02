import { beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { render } from "../../test/render";
import { server } from "../../test/server";
import { expectNoAxeViolations } from "../../test/axe";
import { Explore } from "./Explore";

const BASE = "http://localhost:4000";

/**
 * design.md §5.13 — Explore modules.
 *
 * Three things carry this file: the row shows everything §5.13 lists, a locked
 * module is **offered rather than hidden**, and "add to roadmap" asks which
 * roadmap when there is more than one instead of guessing.
 */

const module = (over: Record<string, unknown> = {}) => ({
  id: "m1",
  title: "JavaScript basics",
  description: "Variables and loops",
  kind: "core",
  estimatedHours: 3,
  skill: { id: "s1", name: "JavaScript" },
  technology: null,
  paths: ["Junior Web Developer"],
  progress: "not_started",
  method: null,
  score: null,
  locked: [],
  onRoadmap: false,
  ...over,
});

const filterOptions = {
  skills: [
    { id: "s1", name: "JavaScript" },
    { id: "s2", name: "CSS" },
  ],
  technologies: [{ id: "t1", name: "React" }],
  careerPaths: [{ id: "p1", name: "Junior Web Developer" }],
};

const roadmap = (over: Record<string, unknown> = {}) => ({
  id: "r1",
  careerPathId: "p1",
  careerPathTitle: "Junior Web Developer",
  trackTitle: "Frontend",
  status: "active",
  weeklyHours: 10,
  passedCount: 0,
  totalCount: 16,
  sharedCount: 0,
  lastStudiedAt: null,
  ...over,
});

let asked: { url: string }[] = [];
let added: { roadmapId: string; body: unknown }[] = [];

interface ServeOptions {
  modules?: Record<string, unknown>[];
  total?: number;
  pageSize?: number;
  page?: number;
  roadmaps?: Record<string, unknown>[];
  addStatus?: number;
  addBody?: Record<string, unknown>;
}

function serve({
  modules = [module()],
  total = 1,
  pageSize = 20,
  page = 1,
  roadmaps = [roadmap()],
  addStatus = 200,
  addBody = { added: true, title: "JavaScript basics" },
}: ServeOptions = {}) {
  server.use(
    http.get(`${BASE}/explore`, ({ request }) => {
      asked.push({ url: request.url });
      return HttpResponse.json({ modules, total, page, pageSize });
    }),
    http.get(`${BASE}/explore/filters`, () => HttpResponse.json(filterOptions)),
    http.get(`${BASE}/roadmaps`, () => HttpResponse.json({ roadmaps })),
    http.post(`${BASE}/roadmaps/:id/items`, async ({ params, request }) => {
      added.push({ roadmapId: String(params.id), body: await request.json() });
      return addStatus === 200
        ? HttpResponse.json(addBody)
        : HttpResponse.json(
            { error: "That roadmap is archived. Restore it from My roadmaps first." },
            { status: addStatus },
          );
    }),
  );
}

beforeEach(() => {
  asked = [];
  added = [];
});

const lastQuery = () => new URL(asked[asked.length - 1].url).searchParams;

describe("the list", () => {
  it("shows everything §5.13 puts on a row", async () => {
    serve({
      modules: [
        module({
          technology: { id: "t1", name: "React" },
          paths: ["Junior Web Developer", "Data"],
        }),
      ],
    });
    render(<Explore />);

    // Scoped to the row: "JavaScript" and "React" are also options in the
    // filters above, so an unscoped query would pass on the wrong element.
    const row = (await screen.findByRole("heading", { name: "JavaScript basics" })).closest("li");
    const inRow = within(row as HTMLElement);

    expect(inRow.getByText("Variables and loops")).toBeInTheDocument();
    expect(inRow.getByText("JavaScript")).toBeInTheDocument();
    expect(inRow.getByText("React")).toBeInTheDocument();
    expect(inRow.getByText("3 hours")).toBeInTheDocument();
    // §2.1's "Also in: Data".
    expect(inRow.getByText(/Also in: Junior Web Developer, Data/)).toBeInTheDocument();
    expect(inRow.getByText("Not started")).toBeInTheDocument();
  });

  it("links the title to the module page", async () => {
    serve();
    render(<Explore />);

    const link = await screen.findByRole("link", { name: "JavaScript basics" });
    expect(link).toHaveAttribute("href", "/app/module/m1");
  });

  it("says one hour in the singular", async () => {
    serve({ modules: [module({ estimatedHours: 1 })] });
    render(<Explore />);
    expect(await screen.findByText("1 hour")).toBeInTheDocument();
  });

  it("announces how many matched", async () => {
    serve({ modules: [module(), module({ id: "m2", title: "The box model" })], total: 2 });
    render(<Explore />);
    expect(await screen.findByText("2 modules")).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    serve({ modules: [module({ technology: { id: "t1", name: "React" } })] });
    const { container } = render(<Explore />);
    await screen.findByRole("heading", { name: "JavaScript basics" });
    await expectNoAxeViolations(container);
  });
});

describe("status on a row", () => {
  it("reports a pass with its score", async () => {
    serve({ modules: [module({ progress: "passed", method: "passed", score: 88 })] });
    render(<Explore />);
    expect(await screen.findByText("Passed, 88%")).toBeInTheDocument();
  });

  /** §9: "Tested out", not "assessment bypass". */
  it("names testing out as testing out", async () => {
    serve({ modules: [module({ progress: "passed", method: "tested_out", score: 95 })] });
    render(<Explore />);
    expect(await screen.findByText("Tested out, 95%")).toBeInTheDocument();
  });

  it("reports a pass with no score without a stray percent sign", async () => {
    serve({ modules: [module({ progress: "passed", method: "override", score: null })] });
    render(<Explore />);

    expect(await screen.findByText("Passed")).toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  it("reports a started module as in progress", async () => {
    serve({ modules: [module({ progress: "in_progress" })] });
    render(<Explore />);
    expect(await screen.findByText("In progress")).toBeInTheDocument();
  });

  /**
   * §9's own example of how to say this: name the module, not "Locked".
   */
  it("names the prerequisite rather than saying locked", async () => {
    serve({ modules: [module({ locked: ["JavaScript basics"] })] });
    render(<Explore />);

    expect(await screen.findByText("Needs JavaScript basics")).toBeInTheDocument();
    expect(screen.queryByText(/^Locked$/)).not.toBeInTheDocument();
  });

  it("lists every prerequisite when there is more than one", async () => {
    serve({ modules: [module({ locked: ["HTML basics", "JavaScript basics"] })] });
    render(<Explore />);

    expect(
      await screen.findByText("Pass HTML basics and JavaScript basics to unlock this module."),
    ).toBeInTheDocument();
  });

  /** §5.13 offers *any* published module; §5.9 is where the lock bites. */
  it("still offers to add a locked module", async () => {
    serve({ modules: [module({ locked: ["JavaScript basics"] })] });
    render(<Explore />);

    expect(await screen.findByRole("button", { name: /add to roadmap/i })).toBeEnabled();
  });
});

describe("search and filters", () => {
  it("sends the search to the API", async () => {
    serve();
    render(<Explore />);
    await screen.findByRole("heading", { name: "JavaScript basics" });

    await userEvent.type(screen.getByRole("searchbox", { name: /search modules/i }), "box");

    await waitFor(() => expect(lastQuery().get("q")).toBe("box"));
  });

  it("offers only the filter values the API reported", async () => {
    serve();
    render(<Explore />);

    const skill = await screen.findByLabelText(/skill area/i);
    // The options come from `/explore/filters`, a second request — waiting for
    // one of them is what makes this deterministic.
    expect(await within(skill).findByRole("option", { name: "JavaScript" })).toBeInTheDocument();
    expect(within(skill).getByRole("option", { name: "CSS" })).toBeInTheDocument();
    expect(within(skill).getByRole("option", { name: "All skills" })).toBeInTheDocument();
  });

  it("sends a chosen skill", async () => {
    serve();
    render(<Explore />);

    const skill = await screen.findByLabelText(/skill area/i);
    await userEvent.selectOptions(skill, await within(skill).findByRole("option", { name: "CSS" }));

    await waitFor(() => expect(lastQuery().get("skillId")).toBe("s2"));
  });

  it("sends a chosen status", async () => {
    serve();
    render(<Explore />);

    const status = await screen.findByLabelText(/^status$/i);
    await userEvent.selectOptions(status, "passed");

    await waitFor(() => expect(lastQuery().get("status")).toBe("passed"));
  });

  it("sends a chosen career path", async () => {
    serve();
    render(<Explore />);

    const path = await screen.findByLabelText(/career path/i);
    await within(path).findByRole("option", { name: "Junior Web Developer" });
    await userEvent.selectOptions(path, "p1");

    await waitFor(() => expect(lastQuery().get("careerPathId")).toBe("p1"));
  });

  /**
   * §8 requires state to survive a breakpoint change, and the URL is the
   * simplest place that is true of — it also makes a filtered catalogue
   * something a learner can come back to.
   */
  it("reads its filters from the URL", async () => {
    serve();
    render(<Explore />, { route: "/app/explore?skillId=s2&status=passed" });

    await screen.findByRole("heading", { name: "JavaScript basics" });
    expect(await screen.findByLabelText(/skill area/i)).toHaveValue("s2");
    expect(screen.getByLabelText(/^status$/i)).toHaveValue("passed");
    expect(lastQuery().get("skillId")).toBe("s2");
  });

  it("clears every filter at once", async () => {
    serve();
    render(<Explore />, { route: "/app/explore?skillId=s2&status=passed" });

    await userEvent.click(await screen.findByRole("button", { name: /clear filters/i }));

    await waitFor(() => expect(lastQuery().get("skillId")).toBeNull());
    expect(lastQuery().get("status")).toBeNull();
  });

  it("offers nothing to clear when nothing is filtered", async () => {
    serve();
    render(<Explore />);

    await screen.findByRole("heading", { name: "JavaScript basics" });
    expect(screen.queryByRole("button", { name: /clear filters/i })).not.toBeInTheDocument();
  });

  /** Page 4 of a new filter is nothing, so changing one goes back to the start. */
  it("drops the page when a filter changes", async () => {
    serve();
    render(<Explore />, { route: "/app/explore?page=3" });

    const skill = await screen.findByLabelText(/skill area/i);
    await within(skill).findByRole("option", { name: "CSS" });
    await userEvent.selectOptions(skill, "s2");

    await waitFor(() => expect(lastQuery().get("page")).toBeNull());
  });
});

describe("empty states", () => {
  /** §9: an empty state says what to do, not that there is nothing. */
  it("tells the learner the filters are what emptied the list", async () => {
    serve({ modules: [], total: 0 });
    render(<Explore />, { route: "/app/explore?q=kubernetes" });

    const empty = await screen.findByText(/no modules match those filters/i);
    // Two of these exist on purpose — one in the filter bar, one here, where
    // the learner is actually looking.
    const panel = empty.closest("article, div");
    expect(
      within(panel as HTMLElement).getByRole("button", { name: /clear filters/i }),
    ).toBeInTheDocument();
  });

  it("says something different when the catalogue itself is empty", async () => {
    serve({ modules: [], total: 0 });
    render(<Explore />);

    expect(await screen.findByText(/no published modules yet/i)).toBeInTheDocument();
  });

  it("says so rather than showing an empty list when the load fails", async () => {
    server.use(
      http.get(`${BASE}/explore`, () => HttpResponse.json({ error: "Nope" }, { status: 500 })),
      http.get(`${BASE}/explore/filters`, () => HttpResponse.json(filterOptions)),
      http.get(`${BASE}/roadmaps`, () => HttpResponse.json({ roadmaps: [] })),
    );
    render(<Explore />);

    expect(await screen.findByText(/catalogue isn't available right now/i)).toBeInTheDocument();
  });
});

describe("paging", () => {
  it("is absent when everything fits on one page", async () => {
    serve({ total: 1 });
    render(<Explore />);

    await screen.findByRole("heading", { name: "JavaScript basics" });
    expect(screen.queryByRole("navigation", { name: /pages of modules/i })).not.toBeInTheDocument();
  });

  it("shows which page of how many", async () => {
    serve({ total: 45, pageSize: 20 });
    render(<Explore />);

    expect(await screen.findByText("Page 1 of 3")).toBeInTheDocument();
  });

  it("cannot go back from the first page", async () => {
    serve({ total: 45 });
    render(<Explore />);

    expect(await screen.findByRole("button", { name: /previous/i })).toBeDisabled();
  });

  it("asks the API for the next page", async () => {
    serve({ total: 45 });
    render(<Explore />);

    await userEvent.click(await screen.findByRole("button", { name: /next/i }));

    await waitFor(() => expect(lastQuery().get("page")).toBe("2"));
  });

  it("cannot go past the last page", async () => {
    serve({ total: 45, page: 3 });
    render(<Explore />, { route: "/app/explore?page=3" });

    expect(await screen.findByRole("button", { name: /next/i })).toBeDisabled();
  });
});

describe("adding to a roadmap", () => {
  it("adds straight away when there is one active roadmap", async () => {
    serve();
    render(<Explore />);

    await userEvent.click(await screen.findByRole("button", { name: /add to roadmap/i }));

    await waitFor(() => expect(added).toHaveLength(1));
    expect(added[0]).toEqual({ roadmapId: "r1", body: { moduleId: "m1" } });
    expect(await screen.findByText(/added javascript basics to your roadmap/i)).toBeInTheDocument();
  });

  /**
   * §5.12 draws two active roadmaps, so "your roadmap" is not always one
   * thing. Open question 16 is about Home and Capstone quietly picking the
   * newest; this screen asks instead.
   */
  it("asks which roadmap when there is more than one", async () => {
    serve({
      roadmaps: [
        roadmap(),
        roadmap({ id: "r2", careerPathTitle: "Data", trackTitle: null }),
      ],
    });
    render(<Explore />);

    expect(screen.queryByRole("button", { name: /add to roadmap/i })).not.toBeInTheDocument();
    const pick = await screen.findByLabelText(/add javascript basics to/i);
    expect(within(pick).getByRole("option", { name: "Junior Web Developer · Frontend" })).toBeInTheDocument();
    expect(within(pick).getByRole("option", { name: "Data" })).toBeInTheDocument();

    await userEvent.selectOptions(pick, "r2");

    await waitFor(() => expect(added).toHaveLength(1));
    expect(added[0].roadmapId).toBe("r2");
  });

  /** Only active roadmaps can take a module, so an archived one is not offered. */
  it("ignores an archived roadmap", async () => {
    serve({ roadmaps: [roadmap(), roadmap({ id: "r2", status: "archived" })] });
    render(<Explore />);

    // One active roadmap left, so it is the direct button rather than a picker.
    expect(await screen.findByRole("button", { name: /add to roadmap/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/add javascript basics to/i)).not.toBeInTheDocument();
  });

  it("offers nothing to add to when there is no active roadmap", async () => {
    serve({ roadmaps: [] });
    render(<Explore />);

    await screen.findByRole("heading", { name: "JavaScript basics" });
    expect(screen.queryByRole("button", { name: /add to roadmap/i })).not.toBeInTheDocument();
  });

  /**
   * Scoped to the row deliberately. An unscoped `/on your roadmap/i` also
   * matches this page's own lede — "modules that are **not on your roadmap**" —
   * so the assertion passed with the badge removed entirely. Mutation testing
   * is what surfaced it; the lesson is the recurring one, that asserting an
   * outcome which failure also produces proves nothing.
   */
  it("says it is already there instead of offering to add it", async () => {
    serve({ modules: [module({ onRoadmap: true })] });
    render(<Explore />);

    const row = (await screen.findByRole("heading", { name: "JavaScript basics" })).closest("li");
    expect(within(row as HTMLElement).getByText(/on your roadmap/i)).toBeInTheDocument();
    expect(
      within(row as HTMLElement).queryByRole("button", { name: /add to roadmap/i }),
    ).not.toBeInTheDocument();
  });

  /** `added: false` is a success — the learner wanted it there, and it is. */
  it("reports an already-added module as information, not an error", async () => {
    serve({ addBody: { added: false, reason: "already-on-roadmap", title: "JavaScript basics" } });
    render(<Explore />);

    await userEvent.click(await screen.findByRole("button", { name: /add to roadmap/i }));

    expect(
      await screen.findByText(/javascript basics is already on that roadmap/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the API's own message when the add is refused", async () => {
    serve({ addStatus: 409 });
    render(<Explore />);

    await userEvent.click(await screen.findByRole("button", { name: /add to roadmap/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/restore it from my roadmaps/i);
  });
});
