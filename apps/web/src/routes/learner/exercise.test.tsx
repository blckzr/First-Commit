import { beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router";
import { render } from "../../test/render";
import { server } from "../../test/server";
import { expectNoAxeViolations } from "../../test/axe";
import { Exercise } from "./Exercise";

const BASE = "http://localhost:4000";
const EXERCISE_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const SUBMISSION_ID = "55555555-5555-4555-8555-555555555555";

/**
 * jsdom has no layout, so CodeMirror renders but measures nothing. That is
 * fine for everything here — the editor is exercised through its accessible
 * name and its value, and the typing behaviour itself belongs to CodeMirror.
 */

const starter = {
  path: "script.js",
  content: "function sumEven(nums) {\n  return 0;\n}\n",
};

const exercise = {
  id: EXERCISE_ID,
  title: "Sum of even numbers",
  instructions: "Return the sum of the even numbers in the list.",
  runtime: "javascript",
  moduleId: "mmmmmmmm-mmmm-4mmm-8mmm-mmmmmmmmmmmm",
  moduleTitle: "Arrays and objects",
  starterFiles: [starter],
  visibleTests: [
    { id: "t1", name: "Sums [2, 4, 6] to 12" },
    { id: "t2", name: "Ignores odd numbers" },
  ],
  lastSubmission: null as unknown,
};

const results = [
  { testCaseId: "t1", name: "Sums [2, 4, 6] to 12", passed: true, hidden: false },
  {
    testCaseId: "t2",
    name: "Includes the first item",
    passed: false,
    expected: "2",
    actual: "0",
    hidden: false,
  },
];

const finished = {
  id: SUBMISSION_ID,
  status: "completed",
  passed: false,
  testResults: results,
  submittedAt: new Date().toISOString(),
  completedAt: new Date().toISOString(),
  feedbackStatus: "none",
  feedback: null as unknown,
};

/** The body the browser sent, so §6 rule 4 can be checked at the wire. */
let sent: unknown = null;

function serve(ex: object = exercise, submission: object | null = null) {
  server.use(
    http.get(`${BASE}/exercises/:id`, () => HttpResponse.json({ exercise: ex })),
    http.post(`${BASE}/exercises/:id/submissions`, async ({ request }) => {
      sent = await request.json();
      return HttpResponse.json(
        {
          submission: {
            id: SUBMISSION_ID,
            status: "queued",
            passed: null,
            testResults: null,
            submittedAt: new Date().toISOString(),
            completedAt: null,
            feedbackStatus: "none",
            feedback: null,
          },
        },
        { status: 201 },
      );
    }),
    http.get(`${BASE}/submissions/:id`, () =>
      HttpResponse.json({ submission: submission ?? finished }),
    ),
  );
}

beforeEach(() => {
  sent = null;
  serve();
});

const open = async () => {
  const view = render(
    <Routes>
      <Route path="/app/exercise/:id" element={<Exercise />} />
    </Routes>,
    { route: `/app/exercise/${EXERCISE_ID}` },
  );
  await screen.findByRole("heading", { name: "Exercise: Sum of even numbers" });
  return view;
};

describe("§5.11 — the exercise", () => {
  it("opens on the instructions with the editor beside them", async () => {
    await open();

    expect(screen.getByText("Return the sum of the even numbers in the list.")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Instructions" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("textbox", { name: "script.js, code editor" })).toBeInTheDocument();
  });

  /** Visible cases only. A hidden one must not appear in any shape (§6 rule 2). */
  it("lists what is checked, from the visible cases", async () => {
    await open();
    expect(screen.getByText("Sums [2, 4, 6] to 12")).toBeInTheDocument();
    expect(screen.getByText("Ignores odd numbers")).toBeInTheDocument();
  });

  it("links back to the module it belongs to", async () => {
    await open();
    expect(screen.getByRole("link", { name: /Back to Arrays and objects/ })).toHaveAttribute(
      "href",
      `/app/module/${exercise.moduleId}`,
    );
  });

  it("has no axe violations", async () => {
    const { container } = await open();
    await expectNoAxeViolations(container);
  });
});

describe("§6 rule 4 — only the server's run counts", () => {
  it("sends files and nothing else", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() => expect(sent).not.toBeNull());
    expect(sent).toEqual({ files: [{ path: "script.js", content: starter.content }] });
    // Not a passed flag, not a score, not a result the browser computed.
    expect(Object.keys(sent as object)).toEqual(["files"]);
  });

  /**
   * There is no in-browser "Run tests" yet: §5.11's instant run is Sandpack
   * practice for React and Vue, and Sandpack is not installed. A button that
   * appeared to run tests but produced no evidence would be worse than none.
   */
  it("offers no button that claims to run tests in the browser", async () => {
    await open();
    expect(screen.queryByRole("button", { name: /run tests/i })).not.toBeInTheDocument();
  });

  it("shows the results the server sent back", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() => {
      expect(screen.getByText("1 of 2 tests passed")).toBeInTheDocument();
    });
    expect(screen.getByText("Expected 2, got 0")).toBeInTheDocument();
  });

  /** §8: an outcome is icon + text + colour, never colour alone. */
  it("names each outcome in words, not only in colour", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Submit" }));

    const row = await screen.findByText("Includes the first item");
    expect(row.closest("li")).toHaveTextContent("Failed:");
    expect(
      screen.getByText("Sums [2, 4, 6] to 12", { selector: "span" }).closest("li"),
    ).toHaveTextContent("Passed:");
  });

  /** §5.11: "All 4 tests passed. Module exercise complete." */
  it("says so when everything passed", async () => {
    serve(exercise, {
      ...finished,
      passed: true,
      testResults: [{ testCaseId: "t1", name: "Sums [2, 4, 6] to 12", passed: true, hidden: false }],
    });
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() => {
      expect(
        screen.getByText("All 1 tests passed. Module exercise complete."),
      ).toBeInTheDocument();
    });
  });

  /**
   * A hidden case reports its name and outcome and nothing else — the worker
   * redacts its values before they ever reach the browser.
   */
  it("shows a failed hidden case without showing what it checked", async () => {
    serve(exercise, {
      ...finished,
      testResults: [
        { testCaseId: "t1", name: "Sums [2, 4, 6] to 12", passed: true, hidden: false },
        { testCaseId: "h1", name: "Works on a longer list", passed: false, hidden: true },
      ],
    });
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Submit" }));

    const row = await screen.findByText("Works on a longer list");
    expect(row.closest("li")).toHaveTextContent("This is one of the hidden checks.");
    expect(row.closest("li")).not.toHaveTextContent("Expected");
  });

  /** §9: explain and direct. A sandbox that is not configured says so. */
  it("reports a run that could not happen", async () => {
    serve(exercise, {
      ...finished,
      status: "error",
      passed: null,
      testResults: { error: "No sandbox is configured, so javascript submissions cannot be run." },
    });
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() => {
      expect(screen.getByText(/No sandbox is configured/)).toBeInTheDocument();
    });
  });

  it("says so when the submission itself fails to send", async () => {
    server.use(
      http.post(`${BASE}/exercises/:id/submissions`, () =>
        HttpResponse.json({ error: "Send at least one file." }, { status: 400 }),
      ),
    );
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Send at least one file.");
    });
  });
});

describe("§5.11 — AI feedback", () => {
  const withFeedback = {
    ...finished,
    feedbackStatus: "completed",
    feedback: {
      aiOutputId: "99999999-9999-4999-8999-999999999999",
      flagged: false,
      summary: "Your loop starts at index 1, so the first number is never checked.",
      issues: [
        { line: 3, problem: "The first item is skipped.", hint: "Where do arrays start in JS?" },
      ],
      encouragement: "You're one character away.",
    },
  };

  it("labels it as AI and offers the flag (§7)", async () => {
    serve(exercise, withFeedback);
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() => expect(screen.getByText("AI feedback")).toBeInTheDocument());
    expect(screen.getByText(/Your loop starts at index 1/)).toBeInTheDocument();
    expect(screen.getByText(/Line 3:/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Is this wrong?" })).toBeInTheDocument();
  });

  /** §7: the results are the source of truth, so they come first. */
  it("puts the results above the feedback", async () => {
    serve(exercise, withFeedback);
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() => expect(screen.getByText("AI feedback")).toBeInTheDocument());
    const panel = document.getElementById("panel-results")!;
    const order = panel.textContent ?? "";
    expect(order.indexOf("1 of 2 tests passed")).toBeLessThan(order.indexOf("AI feedback"));
  });

  it.each([
    ["queued", "Feedback is queued. Your test results are ready below."],
    ["running", "Writing feedback on your test results…"],
  ])("says %s while there is none yet", async (status, message) => {
    serve(exercise, { ...finished, feedbackStatus: status });
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() => expect(screen.getByText(message)).toBeInTheDocument());
  });

  /** §9's own sentence: no apology, and the results are still there. */
  it("says the feedback is unavailable without hiding the results", async () => {
    serve(exercise, { ...finished, feedbackStatus: "failed" });
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() => {
      expect(screen.getByText(/Feedback isn't available right now/)).toBeInTheDocument();
    });
    expect(screen.getByText("1 of 2 tests passed")).toBeInTheDocument();
  });

  it("shows no feedback panel when none was asked for", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() => expect(screen.getByText("1 of 2 tests passed")).toBeInTheDocument());
    expect(screen.queryByText("AI feedback")).not.toBeInTheDocument();
  });
});

describe("§5.11 — the editor", () => {
  it("reopens the learner's own last attempt", async () => {
    serve({
      ...exercise,
      lastSubmission: { ...finished, files: [{ path: "script.js", content: "my work so far" }] },
    });
    await open();

    expect(screen.getByRole("textbox", { name: "script.js, code editor" })).toHaveTextContent(
      "my work so far",
    );
  });

  it("goes straight to the results when there is a finished attempt", async () => {
    serve({ ...exercise, lastSubmission: finished });
    await open();

    expect(screen.getByRole("tab", { name: "Results" })).toHaveAttribute("aria-selected", "true");
  });

  /** A learner who goes back to the instructions stays there. */
  it("keeps the tab the learner picked", async () => {
    serve({ ...exercise, lastSubmission: finished });
    await open();
    await userEvent.click(screen.getByRole("tab", { name: "Instructions" }));

    expect(screen.getByRole("tab", { name: "Instructions" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("Return the sum of the even numbers in the list.")).toBeInTheDocument();
  });

  it("resets to the starter files, not to the last attempt", async () => {
    serve({
      ...exercise,
      lastSubmission: { ...finished, files: [{ path: "script.js", content: "my work so far" }] },
    });
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Reset code" }));

    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "script.js, code editor" })).toHaveTextContent(
        "return 0",
      );
    });
  });
});
