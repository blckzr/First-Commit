import { describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { render } from "../../test/render";
import { api, LEARNER } from "../../test/server";
import { mockRoadmap } from "../../test/roadmap";
import { expectNoAxeViolations } from "../../test/axe";
import { RoadmapReview } from "./RoadmapReview";

const navigate = vi.fn();
vi.mock("react-router", async () => {
  const actual = await vi.importActual<typeof import("react-router")>("react-router");
  return { ...actual, useNavigate: () => navigate, useParams: () => ({ id: "r1" }) };
});

/**
 * design.md §5.5 — the review is where onboarding ends, and the first place a
 * learner ever sees what the Roadmap AI wrote about their plan.
 */
const open = async (roadmap: unknown = mockRoadmap) => {
  api.signedIn(LEARNER, null);
  api.roadmap(roadmap);
  const result = render(<RoadmapReview />, { route: "/app/roadmap/r1/review" });
  await screen.findByRole("heading", { level: 1 });
  return result;
};

describe("the summary", () => {
  /** §5.5: "16 modules, about 14 weeks at 6 hours a week". */
  it("says how long it is likely to take", async () => {
    await open();
    expect(
      screen.getByText(/16 modules, about 14 weeks at 6 hours a week/i),
    ).toBeInTheDocument();
  });

  it("drops the estimate when the learner never said their hours", async () => {
    await open({ ...mockRoadmap, weeklyHours: null, estimatedWeeks: null });
    expect(screen.getByText(/^16 modules$/)).toBeInTheDocument();
    expect(screen.queryByText(/a week/)).not.toBeInTheDocument();
  });

  /** What placement bought, said where the learner will look for it. */
  it("reports what placement cleared", async () => {
    await open();
    expect(screen.getByText("1 tested out")).toBeInTheDocument();
    expect(screen.getByText(/so 10 remain/)).toBeInTheDocument();
  });

  it("says nothing about placement when nothing was cleared", async () => {
    await open({ ...mockRoadmap, testedOutCount: 0, aiRationale: null });
    expect(screen.queryByText(/tested out/)).not.toBeInTheDocument();
  });
});

describe("the AI explanation", () => {
  /** §7: AI output is labelled as AI, carries a reason, and is flaggable. */
  it("shows the reason and labels it as AI", async () => {
    await open();
    expect(screen.getByText("AI")).toBeInTheDocument();
    expect(screen.getByText(/I recommend the Frontend track/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /is this wrong/i })).toBeDisabled();
  });

  it("is absent when the roadmap has no explanation", async () => {
    await open({ ...mockRoadmap, aiRationale: null });
    expect(screen.queryByText("AI")).not.toBeInTheDocument();
  });
});

describe("adjusting weekly hours", () => {
  it("sends the new figure and nothing else", async () => {
    let sent: unknown;
    await open();
    api.roadmapPatch({ ...mockRoadmap, weeklyHours: 12, estimatedWeeks: 7 }, (b) => (sent = b), mockRoadmap.id);

    await userEvent.click(screen.getByRole("button", { name: /adjust weekly hours/i }));
    const field = screen.getByLabelText(/hours a week/i);
    await userEvent.clear(field);
    await userEvent.type(field, "12");
    await userEvent.click(screen.getByRole("button", { name: /save hours/i }));

    await waitFor(() => expect(sent).toEqual({ weeklyHours: 12 }));
  });

  /** §9 gives the sentence, and it is refused before the API is troubled. */
  it.each(["0", "41", "seven"])("explains %s instead of calling the API", async (value) => {
    let called = false;
    await open();
    api.roadmapPatch(mockRoadmap, () => (called = true), mockRoadmap.id);

    await userEvent.click(screen.getByRole("button", { name: /adjust weekly hours/i }));
    const field = screen.getByLabelText(/hours a week/i);
    await userEvent.clear(field);
    await userEvent.type(field, value);
    await userEvent.click(screen.getByRole("button", { name: /save hours/i }));

    expect(field).toHaveAccessibleDescription(/between 1 and 40/);
    expect(called).toBe(false);
  });

  it("surfaces an API refusal", async () => {
    await open();
    api.roadmapPatchFails(400, "Enter weekly hours as a number between 1 and 40.", mockRoadmap.id);

    await userEvent.click(screen.getByRole("button", { name: /adjust weekly hours/i }));
    const field = screen.getByLabelText(/hours a week/i);
    await userEvent.clear(field);
    await userEvent.type(field, "12");
    await userEvent.click(screen.getByRole("button", { name: /save hours/i }));

    await waitFor(() =>
      expect(field).toHaveAccessibleDescription(/between 1 and 40/),
    );
  });
});

describe("starting", () => {
  /**
   * The session's `next` points at this screen until a module is opened, so
   * leaving has to refresh it — otherwise the guard sends the learner back.
   */
  it("refreshes the session before going to the app", async () => {
    const { client } = await open();
    const spy = vi.spyOn(client, "invalidateQueries");

    await userEvent.click(screen.getByRole("button", { name: /start learning/i }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/app"));
    expect(spy).toHaveBeenCalledWith({ queryKey: ["session"] });
  });
});

describe("failures", () => {
  it("explains a roadmap that is not theirs without implying it exists", async () => {
    api.signedIn(LEARNER, null);
    api.roadmapFails(404);
    render(<RoadmapReview />, { route: "/app/roadmap/r1/review" });

    expect(await screen.findByRole("heading", { name: /couldn't find that roadmap/i })).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = await open();
    await expectNoAxeViolations(container);
  });
});
