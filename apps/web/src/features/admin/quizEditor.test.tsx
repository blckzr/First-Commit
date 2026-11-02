import { beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { render } from "../../test/render";
import { server } from "../../test/server";
import { expectNoAxeViolations } from "../../test/axe";
import { QuizEditor } from "./QuizEditor";

const BASE = "http://localhost:4000";
const MODULE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const VERSION = "22222222-2222-4222-8222-222222222222";

/**
 * design.md §6.3's Assessment tab.
 *
 * The assertion that matters most is that **the correct answer is a radio**:
 * `quiz_answer_keys` holds exactly one option per question, so a control able
 * to express "two correct" or "none" would let an author build a quiz nobody
 * can pass. The API refuses it, but a refusal met after typing six options is a
 * worse screen than one that cannot ask the question.
 */

const question = (over: Record<string, unknown> = {}) => ({
  prompt: "Why must a component's name start with a capital letter?",
  explanation: "A lowercase name is treated as an HTML element.",
  options: ["JSX treats lowercase as HTML", "Style only", "It must not"],
  correctIndex: 0,
  ...over,
});

function quiz(over: Record<string, unknown> = {}, editable = true) {
  server.use(
    http.get(`${BASE}/admin/modules/${MODULE}/versions/${VERSION}/quiz`, () =>
      HttpResponse.json({
        editable,
        quiz: {
          id: "q1",
          title: "Components in React quiz",
          instructions: "Five questions.",
          passingScore: 70,
          questions: [question()],
          ...over,
        },
      }),
    ),
  );
}

const editor = () => <QuizEditor moduleId={MODULE} versionId={VERSION} />;

beforeEach(() => quiz());

describe("editing", () => {
  it("shows the quiz's questions and options", async () => {
    render(editor());

    expect(await screen.findByDisplayValue("Components in React quiz")).toBeInTheDocument();
    expect(screen.getByDisplayValue("JSX treats lowercase as HTML")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Style only")).toBeInTheDocument();
  });

  /** One correct answer by construction, not by validation. */
  it("marks the correct answer with a radio", async () => {
    render(editor());

    const radios = await screen.findAllByRole("radio");
    expect(radios).toHaveLength(3);
    expect(radios[0]).toBeChecked();
    expect(radios[1]).not.toBeChecked();
  });

  it("moves the correct answer when another radio is chosen", async () => {
    let sent: { questions: { correctIndex: number }[] } | undefined;
    server.use(
      http.put(
        `${BASE}/admin/modules/${MODULE}/versions/${VERSION}/quiz`,
        async ({ request }) => {
          sent = (await request.json()) as typeof sent;
          return HttpResponse.json({ questions: 1 });
        },
      ),
    );
    render(editor());

    const radios = await screen.findAllByRole("radio");
    await userEvent.click(radios[2]);
    await userEvent.click(screen.getByRole("button", { name: /save quiz/i }));

    await waitFor(() => expect(sent!.questions[0].correctIndex).toBe(2));
  });

  it("adds a question", async () => {
    render(editor());

    await userEvent.click(await screen.findByRole("button", { name: /add question/i }));

    expect(screen.getByLabelText("Question 2")).toBeInTheDocument();
  });

  /**
   * A question needs at least two options, so the last two cannot be removed.
   * The API refuses it; the screen does not offer it.
   */
  it("will not remove an option below two", async () => {
    quiz({ questions: [question({ options: ["a", "b"], correctIndex: 0 })] });
    render(editor());

    const removes = await screen.findAllByRole("button", { name: /remove option/i });
    for (const button of removes) expect(button).toBeDisabled();
  });

  /**
   * **Removing the correct option must not leave the key pointing at whatever
   * slides into its place.** That is a quiz with a silently wrong answer, and
   * nothing downstream would notice.
   */
  it("moves the correct answer when the correct option is removed", async () => {
    let sent: { questions: { correctIndex: number; options: string[] }[] } | undefined;
    server.use(
      http.put(
        `${BASE}/admin/modules/${MODULE}/versions/${VERSION}/quiz`,
        async ({ request }) => {
          sent = (await request.json()) as typeof sent;
          return HttpResponse.json({ questions: 1 });
        },
      ),
    );
    quiz({ questions: [question({ options: ["a", "b", "c"], correctIndex: 1 })] });
    render(editor());

    // Remove "b", which is the correct one.
    const removes = await screen.findAllByRole("button", { name: /remove option/i });
    await userEvent.click(removes[1]);
    await userEvent.click(screen.getByRole("button", { name: /save quiz/i }));

    await waitFor(() => {
      expect(sent!.questions[0].options).toEqual(["a", "c"]);
      expect(sent!.questions[0].correctIndex).toBe(0);
    });
  });

  /** Removing an option before the correct one shifts the index down with it. */
  it("keeps the correct answer on the same option when an earlier one goes", async () => {
    let sent: { questions: { correctIndex: number; options: string[] }[] } | undefined;
    server.use(
      http.put(
        `${BASE}/admin/modules/${MODULE}/versions/${VERSION}/quiz`,
        async ({ request }) => {
          sent = (await request.json()) as typeof sent;
          return HttpResponse.json({ questions: 1 });
        },
      ),
    );
    quiz({ questions: [question({ options: ["a", "b", "c"], correctIndex: 2 })] });
    render(editor());

    const removes = await screen.findAllByRole("button", { name: /remove option/i });
    await userEvent.click(removes[0]);
    await userEvent.click(screen.getByRole("button", { name: /save quiz/i }));

    await waitFor(() => {
      expect(sent!.questions[0].options).toEqual(["b", "c"]);
      // Still "c".
      expect(sent!.questions[0].correctIndex).toBe(1);
    });
  });

  it("says so when there are no questions", async () => {
    quiz({ questions: [] });
    render(editor());

    expect(await screen.findByText(/a learner would open it and find nothing/i)).toBeInTheDocument();
  });

  it("surfaces a refusal from the API", async () => {
    server.use(
      http.put(`${BASE}/admin/modules/${MODULE}/versions/${VERSION}/quiz`, () =>
        HttpResponse.json({ error: "A question needs at least two options." }, { status: 400 }),
      ),
    );
    render(editor());

    await userEvent.click(await screen.findByRole("button", { name: /save quiz/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/at least two options/i);
  });
});

describe("a published version", () => {
  /** Learners are being tested on it, so the screen must not offer edits. */
  it("shows the quiz read-only", async () => {
    quiz({}, false);
    render(editor());

    expect(
      await screen.findByText(/learners are being tested on this/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /save quiz/i })).not.toBeInTheDocument();
  });

  it("says so when there is no quiz at all", async () => {
    server.use(
      http.get(`${BASE}/admin/modules/${MODULE}/versions/${VERSION}/quiz`, () =>
        HttpResponse.json({ editable: false, quiz: null }),
      ),
    );
    render(editor());

    expect(await screen.findByText(/this version has no quiz/i)).toBeInTheDocument();
  });
});

describe("accessibility", () => {
  it("has no axe violations", async () => {
    const { container } = render(editor());

    await screen.findAllByRole("radio");
    await expectNoAxeViolations(container);
  });
});
