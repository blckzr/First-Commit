import { beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { render } from "../../test/render";
import { server } from "../../test/server";
import { expectNoAxeViolations } from "../../test/axe";
import { ExerciseEditor } from "./ExerciseEditor";

const BASE = "http://localhost:4000";
const MODULE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const VERSION = "22222222-2222-4222-8222-222222222222";

/**
 * design.md §6.3's Test cases and Rubric tabs.
 *
 * **The screen cannot declare an exercise verified**, and most of this is about
 * that: the gate is the worker's `last_verified_at`, the screen only asks for a
 * run, and an author who edits after a green run has to be told the green is
 * gone before they go looking for Publish.
 */

const url = `${BASE}/admin/modules/${MODULE}/versions/${VERSION}/exercise`;

const anExercise = (over: Record<string, unknown> = {}) => ({
  id: "ex1",
  title: "Sum of even numbers",
  instructions: "Add up the even numbers.",
  passingScore: 100,
  runtime: "javascript",
  starterFiles: [{ path: "script.js", content: "function sumEven() {}" }],
  referenceSolution: [{ path: "script.js", content: "// the answer" }],
  testCases: [
    { name: "Sums [2, 4, 6] to 12", code: "expect(sumEven([2,4,6])).toBe(12);", visible: true },
    { name: "Works on a longer list", code: "expect(sumEven([5,8])).toBe(8);", visible: false },
  ],
  rubric: [{ name: "Readability", description: "Names say what they hold." }],
  verifiedAt: null,
  ...over,
});

function exercise(
  over: Record<string, unknown> = {},
  lastRun: unknown = null,
  editable = true,
) {
  server.use(
    http.get(url, () =>
      HttpResponse.json({ editable, exercise: anExercise(over), lastRun }),
    ),
  );
}

const editor = () => <ExerciseEditor moduleId={MODULE} versionId={VERSION} />;

beforeEach(() => exercise());

describe("the verification gate", () => {
  it("says an unverified exercise cannot be published", async () => {
    render(editor());

    expect(await screen.findByText("Not verified")).toBeInTheDocument();
    expect(
      screen.getByText(/cannot be published/i),
    ).toBeInTheDocument();
  });

  it("says a verified one can", async () => {
    exercise({ verifiedAt: "2026-11-02T10:00:00Z" });
    render(editor());

    expect(await screen.findByText("Verified")).toBeInTheDocument();
    expect(screen.getByText(/passes every test case/i)).toBeInTheDocument();
  });

  it("asks the worker to run the tests", async () => {
    let asked = false;
    server.use(
      http.post(`${url}/verify`, () => {
        asked = true;
        return HttpResponse.json({ jobId: "job1", queued: true }, { status: 202 });
      }),
    );
    render(editor());

    await userEvent.click(await screen.findByRole("button", { name: /run tests/i }));

    await waitFor(() => expect(asked).toBe(true));
  });

  /**
   * **An edit invalidates the green.** The API clears `last_verified_at` on
   * every save, so a screen still showing "Verified" after a change would be
   * telling an author something that is about to stop being true.
   */
  it("stops showing verified once something is edited", async () => {
    exercise({ verifiedAt: "2026-11-02T10:00:00Z" });
    render(editor());

    await screen.findByText("Verified");
    await userEvent.type(screen.getByLabelText(/exercise title/i), "!");

    expect(screen.getByText("Not verified")).toBeInTheDocument();
  });

  /** Running against unsaved edits would verify something nobody stored. */
  it("will not run the tests against unsaved changes", async () => {
    render(editor());

    await userEvent.type(await screen.findByLabelText(/exercise title/i), "!");

    expect(screen.getByRole("button", { name: /run tests/i })).toBeDisabled();
    expect(screen.getByText(/save your changes before running/i)).toBeInTheDocument();
  });

  it("shows the result, naming a failing case", async () => {
    exercise({}, {
      status: "completed",
      at: "2026-11-02T10:00:00Z",
      error: null,
      result: {
        verified: false,
        outcomes: [
          { name: "Sums [2, 4, 6] to 12", passed: true },
          { name: "Works on a longer list", passed: false, expected: "8", actual: "0" },
        ],
      },
    });
    render(editor());

    expect(await screen.findByText(/last run/i)).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText(/expected 8, got 0/i)).toBeInTheDocument();
  });

  /** An author wrote the hidden cases and cannot fix one they are not shown. */
  it("shows a failing hidden case by name", async () => {
    exercise({}, {
      status: "completed",
      at: "2026-11-02T10:00:00Z",
      error: null,
      result: {
        verified: false,
        outcomes: [{ name: "Works on a longer list", passed: false, expected: "8", actual: "0" }],
      },
    });
    render(editor());

    expect(await screen.findByText("Works on a longer list")).toBeInTheDocument();
  });

  it("says when a run is still going", async () => {
    exercise({}, { status: "running", at: "2026-11-02T10:00:00Z", error: null, result: null });
    render(editor());

    expect(await screen.findByRole("button", { name: /running/i })).toBeDisabled();
  });
});

describe("test cases", () => {
  /**
   * §6 rule 2: a hidden case exists so a solution that special-cases the
   * visible inputs does not pass. An author who cannot see which are hidden
   * cannot write that trap.
   */
  it("shows which cases a learner can see", async () => {
    render(editor());

    const boxes = await screen.findAllByRole("checkbox");
    expect(boxes[0]).toBeChecked();
    expect(boxes[1]).not.toBeChecked();
    expect(screen.getByText(/so a hard-coded answer fails here/i)).toBeInTheDocument();
  });

  it("adds a case", async () => {
    render(editor());

    await userEvent.click(await screen.findByRole("button", { name: /add test case/i }));

    expect(screen.getByLabelText("Case 3 name")).toBeInTheDocument();
  });

  it("sends what was edited", async () => {
    let sent: { testCases: { name: string }[] } | undefined;
    server.use(
      http.put(url, async ({ request }) => {
        sent = (await request.json()) as typeof sent;
        return HttpResponse.json({ testCases: 2, verified: false });
      }),
    );
    render(editor());

    await userEvent.clear(await screen.findByLabelText("Case 1 name"));
    await userEvent.type(screen.getByLabelText("Case 1 name"), "Renamed");
    await userEvent.click(screen.getByRole("button", { name: /save exercise/i }));

    await waitFor(() => expect(sent!.testCases[0].name).toBe("Renamed"));
  });
});

describe("the rubric", () => {
  it("says it is admin-only", async () => {
    render(editor());

    // "never sent to a learner" appears twice on purpose — the reference
    // solution says it too, and both are §6 rule 2. Asserted on the rubric's own
    // sentence rather than the shared phrase.
    expect(await screen.findByText(/read by the code review ai/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue("Readability")).toBeInTheDocument();
  });
});

describe("a published version", () => {
  it("shows the exercise read-only", async () => {
    exercise({}, null, false);
    render(editor());

    expect(await screen.findByText(/learners are working on this/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /save exercise/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /run tests/i })).not.toBeInTheDocument();
  });
});

describe("accessibility", () => {
  it("has no axe violations", async () => {
    const { container } = render(editor());

    await screen.findByText("Not verified");
    await expectNoAxeViolations(container);
  });
});
