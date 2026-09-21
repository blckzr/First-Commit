import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import { render } from "../../test/render";
import { api, LEARNER } from "../../test/server";
import { emptyHome, mockHome } from "../../test/home";
import { expectNoAxeViolations } from "../../test/axe";
import { Home } from "./Home";

/**
 * design.md §5.6. The API is stubbed at the network boundary, so each test
 * exercises the real query, the Zod parse and the render together.
 */
/**
 * Waits for a panel heading, not the `h1` — the greeting renders immediately,
 * while both the session and the home query are still in flight, so waiting on
 * it would assert against a half-loaded page.
 */
const open = async (home: unknown = mockHome) => {
  api.signedIn(LEARNER);
  api.home(home);
  const result = render(<Home />, { route: "/app" });
  await screen.findAllByRole("heading", { level: 2 });
  return result;
};

describe("the greeting", () => {
  it("uses the learner's first name", async () => {
    await open();
    expect(
      await screen.findByText(/Good (morning|afternoon|evening), Jan/),
    ).toBeInTheDocument();
  });
});

describe("the Continue panel", () => {
  /** §5.6: "Arrays and objects, lesson 2 of 4". */
  it("says what to do next and where in it the learner is", async () => {
    await open();

    expect(screen.getByRole("heading", { name: "Arrays and objects" })).toBeInTheDocument();
    expect(screen.getByText(/Lesson 2 of 4/)).toBeInTheDocument();
    expect(screen.getByText(/about 5 hours/)).toBeInTheDocument();
  });

  /** §8: "You are here" is icon + text + colour. */
  it("marks it as where the learner is, in words", async () => {
    await open();
    expect(screen.getByText("You are here")).toBeInTheDocument();
  });

  /** §9: a button says what happens, and the link opens the exact lesson. */
  it("links straight to the lesson they stopped at", async () => {
    await open();
    const link = screen.getByRole("link", { name: /continue lesson/i });
    expect(link).toHaveAttribute("href", "/app/module/mod-arrays?lesson=lesson-2");
  });

  it("says Start module when nothing has been started yet", async () => {
    await open({
      ...mockHome,
      continue: { ...mockHome.continue!, started: false, lessonNumber: 1 },
    });
    expect(screen.getByRole("link", { name: /start module/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /continue lesson/i })).not.toBeInTheDocument();
  });

  it("drops the lesson count for a module with no lessons", async () => {
    await open({
      ...mockHome,
      continue: { ...mockHome.continue!, lessonNumber: null, lessonCount: 0, lessonId: null },
    });
    expect(screen.queryByText(/Lesson \d of/)).not.toBeInTheDocument();
    expect(screen.getByText(/JavaScript · about 5 hours/)).toBeInTheDocument();
  });

  it("says so when there is nothing waiting", async () => {
    await open({ ...mockHome, continue: null });
    expect(screen.getByRole("heading", { name: /nothing is waiting on you/i })).toBeInTheDocument();
  });
});

describe("the roadmap panel", () => {
  it("shows progress and links to the roadmap", async () => {
    await open();

    expect(
      screen.getByRole("heading", { name: "Junior Web Developer, Frontend" }),
    ).toBeInTheDocument();
    expect(screen.getByText("6 of 16 modules passed")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /view roadmap/i })).toHaveAttribute(
      "href",
      "/app/roadmap/10000000-0000-0000-0000-000000000001",
    );
  });

  /** The numbers come from the API, which computes them from evidence (§6 rule 1). */
  it("reports whatever the API says, and invents nothing", async () => {
    await open({
      ...mockHome,
      roadmap: { ...mockHome.roadmap!, passedCount: 0, totalCount: 12 },
    });
    expect(screen.getByText("0 of 12 modules passed")).toBeInTheDocument();
  });
});

describe("the Updates panel", () => {
  /** §7: AI output is labelled as AI and carries a short reason. */
  it("labels an AI-added module and gives its reason", async () => {
    await open();

    const updates = screen.getByText(/Practice: loops was added/).closest("li")!;
    expect(within(updates).getByText("Added by AI")).toBeInTheDocument();
    expect(updates).toHaveTextContent(/Added after two attempts on the arrays quiz/);
    expect(within(updates).getByRole("link", { name: /view module/i })).toHaveAttribute(
      "href",
      "/app/module/mod-loops",
    );
  });

  it("offers See what changed for an updated module, and does not call it AI", async () => {
    await open({
      ...mockHome,
      updates: [
        {
          id: "updated-mod-html",
          kind: "module_updated",
          text: "HTML basics was updated after you passed it. Your credit stays — see what changed.",
          moduleId: "mod-html",
          fromAi: false,
        },
      ],
    });

    expect(screen.getByRole("link", { name: /see what changed/i })).toBeInTheDocument();
    expect(screen.queryByText("Added by AI")).not.toBeInTheDocument();
  });

  it("is absent when there is nothing to report", async () => {
    await open({ ...mockHome, updates: [] });
    expect(screen.queryByText("Updates")).not.toBeInTheDocument();
  });
});

describe("empty and failed states", () => {
  /** §5.6: "Choose a target job to build your first roadmap." */
  it("invites a learner with no roadmap to build one", async () => {
    await open(emptyHome);

    expect(
      screen.getByRole("heading", { name: /choose a target job to build your first roadmap/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /build my roadmap/i })).toBeInTheDocument();
  });

  it("says it is loading before anything arrives", () => {
    api.signedIn(LEARNER);
    api.home(mockHome);
    render(<Home />, { route: "/app" });
    expect(screen.getByRole("status")).toHaveTextContent(/loading what's next/i);
  });

  /** §9: explain and reassure, without blaming the learner. */
  it("reassures when progress cannot be loaded", async () => {
    api.signedIn(LEARNER);
    api.homeFails(500);
    render(<Home />, { route: "/app" });

    expect(
      await screen.findByRole("heading", { name: /couldn't load your progress/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/nothing you have done is lost/i)).toBeInTheDocument();
  });

  /** The Zod boundary: a half-shaped response is a failure, not an empty Home. */
  it("treats an unparseable response as a failure", async () => {
    api.signedIn(LEARNER);
    api.home({ roadmap: { id: "r1" } });
    render(<Home />, { route: "/app" });

    expect(
      await screen.findByRole("heading", { name: /couldn't load your progress/i }),
    ).toBeInTheDocument();
  });
});

describe("accessibility", () => {
  it("has no axe violations", async () => {
    const { container } = await open();
    await expectNoAxeViolations(container);
  });

  it("has no axe violations on the empty state", async () => {
    const { container } = await open(emptyHome);
    await expectNoAxeViolations(container);
  });
});
