import { describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router";
import { render } from "../../test/render";
import { api } from "../../test/server";
import { chosenDecision, mockDecision, recommendedDecision } from "../../test/decision";
import { expectNoAxeViolations } from "../../test/axe";
import { TechnologyChoice } from "./TechnologyChoice";

const navigate = vi.fn();
vi.mock("react-router", async () => {
  const actual = await vi.importActual<typeof import("react-router")>("react-router");
  return { ...actual, useNavigate: () => navigate };
});

/** design.md §5.8. */
function at(route: string) {
  return render(
    <Routes>
      <Route path="/app/roadmap/:id/technology/:decisionId" element={<TechnologyChoice />} />
    </Routes>,
    { route },
  );
}

const open = async (decision: unknown = mockDecision) => {
  api.decision(decision);
  const result = at("/app/roadmap/r1/technology/d1");
  await screen.findByRole("heading", { level: 1 });
  return result;
};

const card = (name: string) =>
  screen.getByRole("heading", { level: 2, name }).closest("li")!;

describe("the comparison", () => {
  it("shows every option with what it brings", async () => {
    await open();

    expect(screen.getByRole("heading", { level: 1, name: "Choose your framework" })).toBeInTheDocument();
    expect(within(card("React")).getByText(/Build UIs from JavaScript components/)).toBeInTheDocument();
    expect(within(card("React")).getByText(/majority of frontend postings/)).toBeInTheDocument();
    expect(within(card("Vue")).getByText(/Gentler/)).toBeInTheDocument();
  });

  /** The comparison keys are free-form content, so they become the labels. */
  it("turns a camelCase comparison key into a readable label", async () => {
    await open();
    expect(within(card("React")).getByText("Learning curve:")).toBeInTheDocument();
    expect(within(card("React")).getByText("Job demand:")).toBeInTheDocument();
  });

  it("says how many modules each option puts on the roadmap", async () => {
    await open();
    const react = card("React");
    expect(within(react).getByText("On your roadmap:")).toBeInTheDocument();
    expect(within(react).getByText(/^2 modules/)).toBeInTheDocument();
  });

  it("explains what the choice is for", async () => {
    await open();
    expect(screen.getByText(/Pick the framework your Frontend modules and capstone will use/)).toBeInTheDocument();
    expect(screen.getByText(/switch later and keep your progress/i)).toBeInTheDocument();
  });
});

describe("the AI recommendation", () => {
  /** §7: labelled as AI, with a short reason, and flaggable. */
  it("is labelled and carries its reason", async () => {
    await open(recommendedDecision);

    expect(screen.getByText("AI")).toBeInTheDocument();
    expect(screen.getByText(/appears in more junior job postings/)).toBeInTheDocument();
    /*
     * No flag control here yet. A flag points at the `ai_outputs` row the text
     * came from, and nothing writes
     * `roadmap_technology_choices.recommendation_reason` — the Roadmap AI
     * picks a track, not a framework. The control arrives with the
     * recommendation that would produce one.
     */
    expect(screen.queryByRole("button", { name: /is this wrong/i })).not.toBeInTheDocument();
  });

  /** §12: the recommendation is announced as text, not only a visual label. */
  it("marks the recommended option in words", async () => {
    await open(recommendedDecision);
    expect(within(card("React")).getByText("Recommended")).toBeInTheDocument();
    expect(within(card("Vue")).queryByText("Recommended")).not.toBeInTheDocument();
  });

  /** The recommendation is its own AI job and is not built; absent, not faked. */
  it("is absent when there is none", async () => {
    await open();
    expect(screen.queryByText("AI")).not.toBeInTheDocument();
    expect(screen.queryByText("Recommended")).not.toBeInTheDocument();
  });
});

describe("choosing", () => {
  /** §5.8: "Choosing shows a confirmation." */
  it("confirms before doing anything", async () => {
    let sent: unknown;
    api.decision(mockDecision);
    api.choiceSucceeds(
      { technologyId: "tech-react", added: 2, removed: 0, switched: false },
      (body) => (sent = body),
    );
    at("/app/roadmap/r1/technology/d1");
    await screen.findByRole("heading", { level: 1 });

    await userEvent.click(screen.getByRole("button", { name: "Choose React" }));

    expect(
      screen.getByRole("heading", { name: /your roadmap will use react/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/switch later from the roadmap menu/i)).toBeInTheDocument();
    // Nothing sent yet.
    expect(sent).toBeUndefined();
  });

  /**
   * AGENT.md §6 rule 1: the browser says which option, and nothing about what
   * that does to the roadmap.
   */
  it("sends only the chosen option", async () => {
    let sent: unknown;
    api.decision(mockDecision);
    api.choiceSucceeds(
      { technologyId: "tech-react", added: 2, removed: 0, switched: false },
      (body) => (sent = body),
    );
    at("/app/roadmap/r1/technology/d1");
    await screen.findByRole("heading", { level: 1 });

    await userEvent.click(screen.getByRole("button", { name: "Choose React" }));
    await userEvent.click(
      within(screen.getByRole("region", { name: /your roadmap will use react/i })).getByRole(
        "button",
        { name: "Choose React" },
      ),
    );

    expect(sent).toEqual({ technologyId: "tech-react" });
  });

  it("returns to the roadmap once the choice is recorded", async () => {
    api.decision(mockDecision);
    api.choiceSucceeds({ technologyId: "tech-react", added: 2, removed: 0, switched: false });
    at("/app/roadmap/r1/technology/d1");
    await screen.findByRole("heading", { level: 1 });

    await userEvent.click(screen.getByRole("button", { name: "Choose React" }));
    const confirm = screen.getByRole("region", { name: /your roadmap will use react/i });
    await userEvent.click(within(confirm).getByRole("button", { name: "Choose React" }));

    expect(navigate).toHaveBeenCalledWith("/app/roadmap/r1");
  });

  it("can be cancelled without sending anything", async () => {
    let sent: unknown;
    api.decision(mockDecision);
    api.choiceSucceeds({ technologyId: "tech-react", added: 2, removed: 0, switched: false }, (b) => (sent = b));
    at("/app/roadmap/r1/technology/d1");
    await screen.findByRole("heading", { level: 1 });

    await userEvent.click(screen.getByRole("button", { name: "Choose React" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("region", { name: /your roadmap will use/i })).not.toBeInTheDocument();
    expect(sent).toBeUndefined();
  });

  /** §12: focus moves into a panel when it opens. */
  it("moves focus into the confirmation", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Choose React" }));
    expect(screen.getByRole("heading", { name: /your roadmap will use react/i })).toHaveFocus();
  });

  it("surfaces a refusal from the API", async () => {
    api.decision(mockDecision);
    api.choiceFails(404, "Not found");
    at("/app/roadmap/r1/technology/d1");
    await screen.findByRole("heading", { level: 1 });

    await userEvent.click(screen.getByRole("button", { name: "Choose React" }));
    const confirm = screen.getByRole("region", { name: /your roadmap will use react/i });
    await userEvent.click(within(confirm).getByRole("button", { name: "Choose React" }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });
});

/**
 * §5.8: "Switch to Vue? Your core and concept modules stay passed. Your 3
 * passed React modules stay on your resume. Vue modules replace React modules
 * on your roadmap."
 */
describe("switching", () => {
  it("marks the current choice and does not offer to re-choose it", async () => {
    await open(chosenDecision);

    expect(within(card("React")).getByText("Your choice")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Using React" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Choose Vue" })).toBeEnabled();
  });

  it("says exactly what a switch does to what was already passed", async () => {
    await open(chosenDecision);
    await userEvent.click(screen.getByRole("button", { name: "Choose Vue" }));

    const confirm = screen.getByRole("region", { name: /switch to vue/i });
    expect(confirm).toHaveTextContent("Your core and frontend modules stay passed.");
    expect(confirm).toHaveTextContent("Your 3 passed React modules stay on your resume.");
    expect(confirm).toHaveTextContent("Vue modules replace React modules on your roadmap.");
  });

  it("leaves out the resume line when nothing was passed", async () => {
    await open({
      ...chosenDecision,
      options: [{ ...chosenDecision.options[0], passedCount: 0 }, chosenDecision.options[1]],
    });
    await userEvent.click(screen.getByRole("button", { name: "Choose Vue" }));

    const confirm = screen.getByRole("region", { name: /switch to vue/i });
    expect(confirm).not.toHaveTextContent(/stay on your resume/);
    expect(confirm).toHaveTextContent(/stay passed/);
  });

  it("tells the learner which technology is in use", async () => {
    await open(chosenDecision);
    expect(screen.getByText(/Your roadmap uses React/)).toBeInTheDocument();
  });
});

describe("when the choice cannot be shown", () => {
  it("says it is loading first", () => {
    api.decision(mockDecision);
    at("/app/roadmap/r1/technology/d1");
    expect(screen.getByRole("status")).toHaveTextContent(/loading your options/i);
  });

  it("explains a choice it cannot open", async () => {
    api.decisionFails(404);
    at("/app/roadmap/r1/technology/d1");
    expect(await screen.findByRole("heading", { name: /couldn't find that choice/i })).toBeInTheDocument();
  });

  /** §9: reassure — nothing on the roadmap has changed. */
  it("says the roadmap is untouched when it fails", async () => {
    api.decisionFails(500, "Something went wrong.");
    at("/app/roadmap/r1/technology/d1");
    expect(await screen.findByRole("heading", { name: /isn't available right now/i })).toBeInTheDocument();
    expect(screen.getByText(/nothing on your roadmap has changed/i)).toBeInTheDocument();
  });

  it("treats an unparseable response as a failure", async () => {
    api.decision({ id: "d1", title: "Choose your framework" });
    at("/app/roadmap/r1/technology/d1");
    expect(await screen.findByRole("heading", { name: /isn't available right now/i })).toBeInTheDocument();
  });
});

describe("accessibility", () => {
  it("has no axe violations", async () => {
    const { container } = await open(recommendedDecision);
    await expectNoAxeViolations(container);
  });

  it("has no axe violations with the confirmation open", async () => {
    const { container } = await open(chosenDecision);
    await userEvent.click(screen.getByRole("button", { name: "Choose Vue" }));
    await expectNoAxeViolations(container);
  });
});
