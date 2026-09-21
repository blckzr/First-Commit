import { describe, expect, it } from "vitest";
import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes, useSearchParams } from "react-router";
import { render } from "../../test/render";
import { api } from "../../test/server";
import { mockRoadmap } from "../../test/roadmap";
import { expectNoAxeViolations } from "../../test/axe";
import { setBreakpoint } from "../../test/viewport";
import { Roadmap } from "./Roadmap";

/**
 * jsdom reports no matched media, so `useBreakpoint` resolves to `sm` and these
 * exercise the stacked view. That is the right place for them: the stacked list
 * *is* the nested structure §12 requires, and the chart carries the same
 * component for assistive technology. The canvas itself needs real layout, so
 * it is covered in `e2e/roadmap.spec.ts`.
 */

/** Reports the router's own search params — MemoryRouter never touches window.location. */
function Probe() {
  const [params] = useSearchParams();
  // A span, not an <output>: <output> maps to role="status", which would
  // collide with the screen's own loading region.
  return <span data-testid="node-param">{params.get("node") ?? ""}</span>;
}

/**
 * Mounted on its real path, so `useParams` gives the screen the id it fetches
 * with — the same way the router does it.
 */
function screenAt(route: string) {
  return render(
    <Routes>
      <Route
        path="/app/roadmap/:id"
        element={
          <>
            <Roadmap />
            <Probe />
          </>
        }
      />
    </Routes>,
    { route },
  );
}

/**
 * Renders the screen and waits for the roadmap to arrive. The query is real —
 * the API is stubbed at the network boundary, not the hook — so every test
 * exercises the fetch, the Zod parse, and the render together.
 */
const open = async () => {
  api.roadmap(mockRoadmap);
  const result = screenAt("/app/roadmap/r1");
  await screen.findByRole("list", { name: /roadmap/i });
  return result;
};

/** The roadmap's own node buttons, excluding panel and page controls. */
const nodes = () =>
  within(screen.getByRole("list", { name: /roadmap/i })).getAllByRole("button");

describe("structure", () => {
  /** §12: "an equivalent nested list structure (skills containing modules)". */
  it("is a nested list of skills containing modules", async () => {
    await open();

    const roadmap = screen.getByRole("list", { name: /Junior Web Developer roadmap/i });
    const javascript = within(roadmap).getByRole("list", { name: "Modules in JavaScript" });

    expect(within(javascript).getAllByRole("listitem")).toHaveLength(5);
    expect(
      within(javascript).getByRole("button", { name: /^Arrays and objects/ }),
    ).toBeInTheDocument();
  });

  /** §12 gives the shape: title, position within its skill, then status. */
  it("announces a module with its position and status", async () => {
    await open();
    expect(
      screen.getByRole("button", {
        name: "Arrays and objects, module 3 of 5 in JavaScript, You are here",
      }),
    ).toBeInTheDocument();
  });

  it("announces a skill with its progress", async () => {
    await open();
    expect(
      screen.getByRole("button", { name: "HTML, skill, 2 of 2 modules passed" }),
    ).toBeInTheDocument();
  });

  /** §12: the recommendation is text, not only a visual label. */
  it("announces the decision and that nothing is chosen", async () => {
    await open();
    expect(
      screen.getByRole("button", {
        name: "Choose your framework, decision between React or Vue, not chosen yet",
      }),
    ).toBeInTheDocument();
  });

  /** §8: status is icon + text + colour, so the words must be there. */
  it.each([
    ["HTML basics", /Passed, 92%/],
    ["CSS basics", /Tested out/],
    ["Arrays and objects", /You are here/],
    ["DOM manipulation", /Locked/],
  ])("states %s's status in words", async (title, expected) => {
    await open();
    expect(screen.getByRole("button", { name: new RegExp(`^${title}`) })).toHaveAccessibleName(
      expected,
    );
  });

  /** §6 rule 1 / §5.7: "Learners cannot mark modules as done manually." */
  it("offers nothing that marks a module done", async () => {
    await open();
    const forbidden = /mark (as )?(done|complete|passed)|complete module|i finished/i;
    for (const control of screen.getAllByRole("button")) {
      expect(control).not.toHaveAccessibleName(forbidden);
    }
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  /** Roving tabindex: Tab leaves the roadmap instead of walking 25 nodes. */
  it("has only one node in the tab order", async () => {
    await open();
    const tabbable = nodes().filter((el) => el.getAttribute("tabindex") === "0");
    expect(tabbable).toHaveLength(1);
    expect(nodes().length).toBeGreaterThan(20);
  });
});

describe("keyboard navigation", () => {
  /** §12: "Arrow keys move between nodes; Enter opens the side panel." */
  it("walks the roadmap with the arrow keys", async () => {
    await open();
    const html = screen.getByRole("button", { name: /^HTML, skill/ });
    html.focus();

    await userEvent.keyboard("{ArrowDown}");
    expect(screen.getByRole("button", { name: /^HTML basics/ })).toHaveFocus();

    await userEvent.keyboard("{ArrowDown}");
    expect(screen.getByRole("button", { name: /^Forms and semantics/ })).toHaveFocus();

    await userEvent.keyboard("{ArrowUp}");
    expect(screen.getByRole("button", { name: /^HTML basics/ })).toHaveFocus();
  });

  it("moves out to a skill's modules and back with left and right", async () => {
    await open();
    screen.getByRole("button", { name: /^JavaScript, skill/ }).focus();

    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("button", { name: /^JavaScript basics/ })).toHaveFocus();

    await userEvent.keyboard("{ArrowLeft}");
    expect(screen.getByRole("button", { name: /^JavaScript, skill/ })).toHaveFocus();
  });

  it("jumps to the first and last node with Home and End", async () => {
    await open();
    screen.getByRole("button", { name: /^CSS, skill/ }).focus();

    await userEvent.keyboard("{End}");
    expect(screen.getByRole("button", { name: /^Project Certificate/ })).toHaveFocus();

    await userEvent.keyboard("{Home}");
    expect(screen.getByRole("button", { name: /^HTML, skill/ })).toHaveFocus();
  });

  it("does not run off either end of the roadmap", async () => {
    await open();
    const first = screen.getByRole("button", { name: /^HTML, skill/ });
    first.focus();
    await userEvent.keyboard("{ArrowUp}");
    expect(first).toHaveFocus();

    await userEvent.keyboard("{End}{ArrowDown}");
    expect(screen.getByRole("button", { name: /^Project Certificate/ })).toHaveFocus();
  });
});

describe("the side panel", () => {
  /** §12: focus moves into the panel, and returns to the node when it closes. */
  it("opens on Enter, takes focus, and hands it back on Escape", async () => {
    await open();
    const node = screen.getByRole("button", { name: /^Arrays and objects/ });
    node.focus();

    await userEvent.keyboard("{Enter}");
    const panel = screen.getByRole("complementary", { name: "Node details" });
    expect(within(panel).getByRole("heading", { name: "Arrays and objects" })).toHaveFocus();

    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    expect(node).toHaveFocus();
  });

  /**
   * §13.5: "state survives a breakpoint change". The selection lives in the URL
   * rather than in the view, so switching between the chart and the stacked
   * list keeps the same node open — and a node is linkable.
   */
  it("records the open node in the address, and clears it on close", async () => {
    await open();
    expect(screen.getByTestId("node-param")).toHaveTextContent("");

    await userEvent.click(screen.getByRole("button", { name: /^Git basics/ }));
    expect(screen.getByTestId("node-param")).toHaveTextContent("m-git-basics");

    await userEvent.keyboard("{Escape}");
    expect(screen.getByTestId("node-param")).toHaveTextContent("");
  });

  /** The other half of that: a link straight to a node opens it. */
  it("opens the node named in the address", async () => {
    api.roadmap(mockRoadmap);
    screenAt("/app/roadmap/r1?node=m-git-basics");
    expect(
      await screen.findByRole("heading", { name: "Git basics", level: 2 }),
    ).toBeInTheDocument();
  });

  /** §9: never "Locked" alone — say what opens it. */
  it("says what unlocks a locked module", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: /^DOM manipulation/ }));

    const panel = screen.getByRole("complementary");
    expect(panel).toHaveTextContent("Pass Arrays and objects to unlock this module.");
    expect(
      within(panel).getByRole("link", { name: /Go to the module that unlocks it/ }),
    ).toBeInTheDocument();
  });

  /** AGENT.md §7: all AI output is labelled as AI and carries a short reason. */
  it("labels an AI-added module and gives its reason", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: /^Practice: loops/ }));

    const panel = screen.getByRole("complementary");
    expect(panel).toHaveTextContent("Added by AI");
    expect(panel).toHaveTextContent("Added after two attempts on the arrays quiz.");
  });

  it("offers Continue on the current module and Test out beside it", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: /^Arrays and objects/ }));

    const panel = screen.getByRole("complementary");
    expect(within(panel).getByRole("link", { name: /Continue module/ })).toBeInTheDocument();
    expect(within(panel).getByRole("link", { name: "Test out" })).toBeInTheDocument();
  });

  /** §6 rule 6: a learner keeps the version they took. */
  it("explains a module with a newer version", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: /^Layout with flex and grid/ }));
    expect(screen.getByRole("complementary")).toHaveTextContent(
      /You keep the version you started/,
    );
  });

  /** §6 rule 7: progress belongs to the learner, not the roadmap. */
  it("says a shared module counts on every roadmap", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: /^Git basics/ }));
    expect(screen.getByRole("complementary")).toHaveTextContent(/counts on all of them/);
  });

  it("lists a skill's modules with their statuses", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: /^HTML, skill/ }));

    const panel = screen.getByRole("complementary");
    expect(within(panel).getByRole("link", { name: "HTML basics" })).toBeInTheDocument();
    expect(panel).toHaveTextContent("2 of 2 modules passed");
  });

  it("shows the decision's options and which is recommended", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: /^Choose your framework/ }));

    const panel = screen.getByRole("complementary");
    expect(panel).toHaveTextContent("React");
    expect(panel).toHaveTextContent("Recommended for you");
    expect(panel).toHaveTextContent(/Nothing after this step opens until you choose/);
  });

  it("tells a locked capstone what is left", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: /^Capstone project/ }));
    expect(screen.getByRole("complementary")).toHaveTextContent(
      /Pass the remaining \d+ modules to open the capstone/,
    );
  });

  it("closes from the Close button too", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: /^Git basics/ }));
    await userEvent.click(screen.getByRole("button", { name: "Close details" }));
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  });
});

describe("accessibility", () => {
  it("has no axe violations", async () => {
    const { container } = await open();
    await expectNoAxeViolations(container);
  });

  it("has no axe violations with the panel open", async () => {
    const { container } = await open();
    await userEvent.click(screen.getByRole("button", { name: /^Arrays and objects/ }));
    await expectNoAxeViolations(container);
  });
});

describe("the chart view", () => {
  /**
   * §11.3: on md and lg the chart replaces the stacked list, and §12 requires
   * "an equivalent nested list structure in the DOM". Both hold here because
   * the chart carries the very same component the sm view renders — nothing is
   * duplicated, so nothing can drift.
   */
  it("keeps the nested list beside the canvas, and announces the roadmap once", async () => {
    setBreakpoint("lg");
    await open();

    const lists = screen.getAllByRole("list", { name: /Junior Web Developer roadmap/i });
    expect(lists).toHaveLength(1);
    expect(
      within(lists[0]).getByRole("button", { name: /^Arrays and objects/ }),
    ).toBeInTheDocument();
  });

  /** §13.5: the same data, the same selection — the width changes, not the state. */
  it("keeps the open node across a live breakpoint change", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: /^Git basics/ }));
    expect(screen.getByRole("heading", { name: "Git basics", level: 2 })).toBeInTheDocument();

    act(() => setBreakpoint("lg"));

    expect(screen.getByRole("heading", { name: "Git basics", level: 2 })).toBeInTheDocument();
    expect(screen.getByTestId("node-param")).toHaveTextContent("m-git-basics");
  });

  /** §11.1: one layout. No control anywhere offers to switch views. */
  it("offers no view switcher", async () => {
    setBreakpoint("lg");
    await open();
    const switcher = /desktop view|mobile view|switch (to )?(view|layout)|classic view/i;
    for (const control of screen.getAllByRole("button")) {
      expect(control).not.toHaveAccessibleName(switcher);
    }
  });
});

describe("when the roadmap cannot be shown", () => {
  /** §13.6: protected content never flashes — the screen says it is working. */
  it("says it is loading before the roadmap arrives", () => {
    api.roadmap(mockRoadmap);
    screenAt("/app/roadmap/r1");

    expect(screen.getByRole("status")).toHaveTextContent(/loading your roadmap/i);
    expect(screen.queryByRole("list", { name: /roadmap/i })).not.toBeInTheDocument();
  });

  /**
   * §9: errors explain and direct. A 404 here is usually someone else's
   * roadmap, so it must not say "it doesn't exist" — the API deliberately
   * cannot tell those apart, and neither should the copy.
   */
  it("explains a roadmap it cannot open, and offers a way on", async () => {
    api.roadmapFails(404);
    screenAt("/app/roadmap/r1");

    expect(await screen.findByRole("heading", { name: /couldn't find that roadmap/i })).toBeInTheDocument();
    expect(screen.getByText(/may belong to another account/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /see your roadmaps/i })).toBeInTheDocument();
  });

  it("says a failure is temporary rather than blaming the learner", async () => {
    api.roadmapFails(500, "Something went wrong.");
    screenAt("/app/roadmap/r1");

    expect(await screen.findByRole("heading", { name: /isn't available right now/i })).toBeInTheDocument();
    expect(screen.getByText(/your progress is safe/i)).toBeInTheDocument();
  });

  /**
   * The Zod boundary earning its keep: a response missing a field the chart
   * needs fails at the edge, not three components deep as `undefined`.
   */
  it("treats a response it cannot parse as a failure, not as an empty roadmap", async () => {
    api.roadmap({ id: "r1", careerPathTitle: "Junior Web Developer" });
    screenAt("/app/roadmap/r1");

    expect(await screen.findByRole("heading", { name: /isn't available right now/i })).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: /roadmap/i })).not.toBeInTheDocument();
  });
});
