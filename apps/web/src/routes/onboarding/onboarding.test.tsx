import { describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router";
import { render } from "../../test/render";
import { RequireLearner } from "../../app/guards";
import { api } from "../../test/server";
import { expectNoAxeViolations } from "../../test/axe";
import { About } from "./About";
import { Target } from "./Target";
import { Placement } from "./Placement";
import { Generating } from "./Generating";

const navigate = vi.fn();
vi.mock("react-router", async () => {
  const actual = await vi.importActual<typeof import("react-router")>("react-router");
  return { ...actual, useNavigate: () => navigate };
});

const PATH = {
  id: "33333333-3333-3333-3333-333333333333",
  slug: "junior-web-developer",
  title: "Junior Web Developer",
  description: "Build websites and web apps for a company or clients.",
};

const FRESH = { step: "about" as const };

/** design.md §5.4 — a skill to rate, and the check behind it. */
const SKILL = {
  id: "s1",
  slug: "html",
  name: "HTML",
  description: "The structure of a page.",
  moduleCount: 2,
  check: {
    title: "HTML placement check",
    instructions: "Two questions.",
    questions: [
      { id: "q1", prompt: "What does a <section> mean?", options: [
        { id: "q1a", text: "The content belongs together" },
        { id: "q1b", text: "The content is centred" },
      ] },
      { id: "q2", prompt: "When is alt empty?", options: [
        { id: "q2a", text: "When the image is decorative" },
        { id: "q2b", text: "Never" },
      ] },
    ],
  },
};

describe("About", () => {
  it("saves the answers and moves to the next step", async () => {
    let sent: unknown;
    api.onboarding(FRESH);
    api.onboardingStepSucceeds("about", "/onboarding/target", (body) => (sent = body));
    render(<About />, { route: "/onboarding/about" });

    await userEvent.click(await screen.findByLabelText("I've tried a bit — a tutorial or two"));
    await userEvent.click(screen.getByLabelText("A job at a company"));
    await userEvent.type(screen.getByLabelText("Hours a week you can study"), "10");
    await userEvent.click(screen.getByRole("button", { name: /continue/i }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/onboarding/target"));
    expect(sent).toEqual({ experienceLevel: "some", goal: "company_job", weeklyHours: 10 });
  });

  /**
   * §5.4: "Back returns to the previous step with the earlier answers still
   * filled in." The answers live on the server, so a fresh page load must
   * refill them too — not just an in-app Back.
   */
  it("refills answers already saved", async () => {
    api.onboarding({
      step: "target",
      about: { experienceLevel: "comfortable", goal: "freelance", weeklyHours: 12 },
    });
    render(<About />, { route: "/onboarding/about" });

    await waitFor(() =>
      expect(screen.getByLabelText("I can build small things on my own")).toBeChecked(),
    );
    expect(screen.getByLabelText("Freelance or client work")).toBeChecked();
    expect(screen.getByLabelText("Hours a week you can study")).toHaveValue(12);
  });

  /** design.md §9 gives this exact sentence, so the screen must not invent its own. */
  it.each(["0", "41", "seven"])("explains %s hours instead of calling the API", async (value) => {
    api.onboarding(FRESH);
    render(<About />, { route: "/onboarding/about" });

    await userEvent.click(await screen.findByLabelText("I've never written code"));
    await userEvent.click(screen.getByLabelText("I'm not sure yet"));
    await userEvent.type(screen.getByLabelText("Hours a week you can study"), value);
    await userEvent.click(screen.getByRole("button", { name: /continue/i }));

    expect(screen.getByLabelText("Hours a week you can study")).toHaveAccessibleDescription(
      /between 1 and 40/,
    );
    expect(navigate).not.toHaveBeenCalled();
  });

  it("surfaces an API refusal", async () => {
    api.onboarding(FRESH);
    api.onboardingStepFails("about", 409, "Finish the earlier steps first.");
    render(<About />, { route: "/onboarding/about" });

    await userEvent.click(await screen.findByLabelText("I've never written code"));
    await userEvent.click(screen.getByLabelText("I'm not sure yet"));
    await userEvent.type(screen.getByLabelText("Hours a week you can study"), "5");
    await userEvent.click(screen.getByRole("button", { name: /continue/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/earlier steps/i);
  });

  it("has no axe violations", async () => {
    api.onboarding(FRESH);
    const { container } = render(<About />, { route: "/onboarding/about" });
    await screen.findByLabelText("I've never written code");
    await expectNoAxeViolations(container);
  });
});

describe("Target", () => {
  it("sends the chosen path", async () => {
    let sent: unknown;
    api.onboarding({ step: "target" });
    api.careerPaths([PATH]);
    api.onboardingStepSucceeds("target", "/onboarding/placement", (body) => (sent = body));
    render(<Target />, { route: "/onboarding/target" });

    await userEvent.click(await screen.findByRole("button", { name: /Junior Web Developer/ }));
    await userEvent.click(screen.getByRole("button", { name: /continue/i }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/onboarding/placement"));
    expect(sent).toEqual({ careerPathId: PATH.id });
  });

  /** The card is a toggle, so its state has to reach assistive tech, not just CSS. */
  it("reports the selection with aria-pressed", async () => {
    api.onboarding({ step: "target" });
    api.careerPaths([PATH]);
    render(<Target />, { route: "/onboarding/target" });

    const card = await screen.findByRole("button", { name: /Junior Web Developer/ });
    expect(card).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(card);
    expect(card).toHaveAttribute("aria-pressed", "true");
  });

  it("shows the earlier choice as selected", async () => {
    api.onboarding({ step: "placement", careerPathId: PATH.id });
    api.careerPaths([PATH]);
    render(<Target />, { route: "/onboarding/target" });

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Junior Web Developer/ })).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
  });

  /**
   * design.md §9: an empty state points at what happens next. The learner
   * cannot publish a career path, so the copy says who can rather than
   * offering them a dead button.
   */
  it("explains an empty catalogue and disables continue", async () => {
    api.onboarding({ step: "target" });
    api.careerPaths([]);
    render(<Target />, { route: "/onboarding/target" });

    expect(await screen.findByText(/no career paths have been published/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();
  });

  it("has no axe violations", async () => {
    api.onboarding({ step: "target" });
    api.careerPaths([PATH]);
    const { container } = render(<Target />, { route: "/onboarding/target" });
    await screen.findByRole("button", { name: /Junior Web Developer/ });
    await expectNoAxeViolations(container);
  });
});

describe("Placement", () => {
  /**
   * §5.4: "'I don't know yet' is always available." The questions are not
   * specified yet (AGENT.md §11), so the skip is the whole screen — and it
   * still has to record a result and queue the roadmap.
   */
  /** §5.4: "I don't know yet" is always available — and it asks nothing more. */
  it("sends ratings with no answers when nothing is claimed", async () => {
    let sent: unknown;
    api.onboarding({ step: "placement", careerPathId: PATH.id, placement: { skills: [SKILL] } });
    api.onboardingStepSucceeds("placement", "/onboarding/generating", (body) => (sent = body));
    render(<Placement />, { route: "/onboarding/placement" });

    await userEvent.click(await screen.findByRole("button", { name: /new to all of this/i }));
    await userEvent.click(screen.getByRole("button", { name: /continue/i }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/onboarding/generating"));
    expect(sent).toEqual({ careerPathId: PATH.id, ratings: { html: "new" }, answers: {} });
  });

  /**
   * A rating cannot clear a module on its own — every module on the path is
   * required for the certificate — so claiming a skill leads to the check
   * rather than straight to Continue.
   */
  it("asks the check only for a skill rated comfortable", async () => {
    api.onboarding({ step: "placement", careerPathId: PATH.id, placement: { skills: [SKILL] } });
    render(<Placement />, { route: "/onboarding/placement" });

    await userEvent.click(await screen.findByLabelText("I can use it with help"));
    expect(screen.getByRole("button", { name: /continue/i })).toBeInTheDocument();

    await userEvent.click(screen.getByLabelText("I'm comfortable with it"));
    await userEvent.click(screen.getByRole("button", { name: /check what i know — 2 questions/i }));

    expect(screen.getByText(SKILL.check.questions[0].prompt)).toBeInTheDocument();
    expect(screen.getByText(/clears 2 modules if you pass/i)).toBeInTheDocument();
  });

  /** The browser sends the option it chose. It never sends a score (§6 rule 1). */
  it("sends chosen options and never a score", async () => {
    let sent: Record<string, unknown> = {};
    api.onboarding({ step: "placement", careerPathId: PATH.id, placement: { skills: [SKILL] } });
    api.onboardingStepSucceeds(
      "placement",
      "/onboarding/generating",
      (body) => (sent = body as Record<string, unknown>),
    );
    render(<Placement />, { route: "/onboarding/placement" });

    await userEvent.click(await screen.findByLabelText("I'm comfortable with it"));
    await userEvent.click(screen.getByRole("button", { name: /check what i know/i }));
    await userEvent.click(screen.getByLabelText(SKILL.check.questions[0].options[0].text));
    await userEvent.click(screen.getByRole("button", { name: /continue/i }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/onboarding/generating"));
    expect(sent.ratings).toEqual({ html: "comfortable" });
    expect(sent.answers).toEqual({ q1: "q1a" });
    expect(Object.keys(sent)).not.toContain("score");
    expect(Object.keys(sent)).not.toContain("passed");
  });

  /** Dropping the claim must drop the answers given under it. */
  it("forgets the answers when a claim is withdrawn", async () => {
    let sent: Record<string, unknown> = {};
    api.onboarding({ step: "placement", careerPathId: PATH.id, placement: { skills: [SKILL] } });
    api.onboardingStepSucceeds(
      "placement",
      "/onboarding/generating",
      (body) => (sent = body as Record<string, unknown>),
    );
    render(<Placement />, { route: "/onboarding/placement" });

    await userEvent.click(await screen.findByLabelText("I'm comfortable with it"));
    await userEvent.click(screen.getByRole("button", { name: /check what i know/i }));
    await userEvent.click(screen.getByLabelText(SKILL.check.questions[0].options[0].text));
    await userEvent.click(screen.getByRole("button", { name: /back/i }));
    await userEvent.click(screen.getByLabelText("I've seen it"));
    await userEvent.click(screen.getByRole("button", { name: /continue/i }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/onboarding/generating"));
    expect(sent.answers).toEqual({});
  });

  it("says a wrong answer cannot set the learner back", async () => {
    api.onboarding({ step: "placement", careerPathId: PATH.id, placement: { skills: [SKILL] } });
    render(<Placement />, { route: "/onboarding/placement" });

    await userEvent.click(await screen.findByLabelText("I'm comfortable with it"));
    await userEvent.click(screen.getByRole("button", { name: /check what i know/i }));
    expect(screen.getByText(/nothing here can set you back/i)).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    api.onboarding({ step: "placement", careerPathId: PATH.id, placement: { skills: [SKILL] } });
    const { container } = render(<Placement />, { route: "/onboarding/placement" });
    await screen.findByLabelText("New to me");
    await expectNoAxeViolations(container);
  });
});

/**
 * Mounted under the real guard, because the bug this covers was the two of them
 * disagreeing — the screen navigating to `/app` while `RequireLearner` was
 * redirecting there too.
 */
function underGuard() {
  return render(
    <Routes>
      <Route element={<RequireLearner needsOnboarding />}>
        <Route path="/onboarding/generating" element={<Generating />} />
      </Route>
      <Route path="/app" element={<p>the app</p>} />
    </Routes>,
    { route: "/onboarding/generating" },
  );
}

describe("Generating", () => {
  it("explains the wait and that leaving is safe", async () => {
    api.onboarding({ step: "generating", careerPathId: PATH.id });
    render(<Generating />, { route: "/onboarding/generating" });

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(/under a minute/i);
    expect(status).toHaveTextContent(/leave this page/i);
  });

  /**
   * The bar is decoration: the wait has no measurable percentage, so inventing
   * one — including through `aria-valuenow` — would be a number we made up.
   */
  it("shows no invented percentage", () => {
    api.onboarding({ step: "generating", careerPathId: PATH.id });
    render(<Generating />, { route: "/onboarding/generating" });

    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  /**
   * The worker moves the step; the browser only reads it.
   *
   * `done` means the session's `onboardingStep` is stale, so the screen
   * refreshes it and `RequireLearner` does the redirect. **It must not navigate
   * itself** — two redirects fighting is what produced "Maximum update depth
   * exceeded" and made the browser throttle navigation.
   */
  it("refreshes the session, and the guard does the redirect", async () => {
    const calls = api.sessionFinishesOnboarding();
    api.onboarding({ step: "done", careerPathId: PATH.id });
    underGuard();

    expect(await screen.findByText("the app")).toBeInTheDocument();
    // Fetched on mount, then again because the screen invalidated it.
    expect(calls.n).toBeGreaterThan(1);
    // The screen itself navigates nowhere. Two redirects fighting is the bug.
    expect(navigate).not.toHaveBeenCalled();
  });

  /**
   * And it settles. The loop this replaced produced "Maximum update depth
   * exceeded" and made the browser throttle navigation, so the assertion that
   * matters is that the requests stop.
   */
  it("stops asking once it has its answer", async () => {
    const calls = api.sessionFinishesOnboarding();
    api.onboarding({ step: "done", careerPathId: PATH.id });
    underGuard();

    await screen.findByText("the app");
    const settled = calls.n;
    await new Promise((r) => setTimeout(r, 400));

    expect(calls.n).toBe(settled);
  });

  /**
   * The bug this covers: the worker gives up after three attempts, and the
   * screen had no idea. It polled the step, saw `generating`, and said "this
   * usually takes under a minute" for as long as the learner was willing to
   * look at it — which with Ollama not running was forever.
   */
  it("says so when the job has failed, without waiting a minute first", async () => {
    api.onboarding({ step: "generating", generation: "failed", careerPathId: PATH.id });
    render(<Generating />, { route: "/onboarding/generating" });

    expect(await screen.findByText(/couldn't build your roadmap/i)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/your answers are saved/i);
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  /**
   * §5.4's "Try again that does not lose the learner's answers". It re-queues
   * the job the learner already has — it used to navigate back to placement,
   * which left a second roadmap behind every time.
   */
  it("re-queues the job rather than sending the learner back a step", async () => {
    const calls = api.onboardingRetry();
    api.onboarding({ step: "generating", generation: "failed", careerPathId: PATH.id });
    render(<Generating />, { route: "/onboarding/generating" });

    await userEvent.click(await screen.findByRole("button", { name: /try again/i }));

    await waitFor(() => expect(calls.n).toBe(1));
    expect(navigate).not.toHaveBeenCalled();
  });

  it("shows no failure message while the job is still running", async () => {
    api.onboarding({ step: "generating", generation: "running", careerPathId: PATH.id });
    render(<Generating />, { route: "/onboarding/generating" });

    expect(screen.getByRole("status")).toHaveTextContent(/under a minute/i);
    expect(screen.queryByText(/couldn't build your roadmap/i)).not.toBeInTheDocument();
  });

  it("offers Try again only once the wait is long", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      api.onboarding({ step: "generating", careerPathId: PATH.id });
      render(<Generating />, { route: "/onboarding/generating" });

      expect(screen.queryByRole("button", { name: /try again/i })).not.toBeInTheDocument();

      await vi.advanceTimersByTimeAsync(61_000);

      expect(await screen.findByRole("button", { name: /try again/i })).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent(/answers are saved/i);
    } finally {
      vi.useRealTimers();
    }
  });

  it("has no axe violations", async () => {
    api.onboarding({ step: "generating", careerPathId: PATH.id });
    const { container } = render(<Generating />, { route: "/onboarding/generating" });
    await expectNoAxeViolations(container);
  });
});
