import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router";
import { render } from "../../test/render";
import { api } from "../../test/server";
import { failedResult, mockQuiz, passedResult } from "../../test/module";
import { expectNoAxeViolations } from "../../test/axe";
import { Quiz } from "./Quiz";

/** design.md §5.10. */
function at(route: string) {
  return render(
    <Routes>
      <Route path="/app/quiz/:id" element={<Quiz />} />
    </Routes>,
    { route },
  );
}

const open = async (route = "/app/quiz/a1") => {
  api.quiz(mockQuiz);
  const result = at(route);
  await screen.findByRole("heading", { level: 1 });
  return result;
};

/** Answers every question with its first option and submits. */
async function answerAll() {
  await userEvent.click(screen.getByLabelText(mockQuiz.questions[0].options[0].text));
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  await userEvent.click(screen.getByLabelText(mockQuiz.questions[1].options[0].text));
  await userEvent.click(screen.getByRole("button", { name: /submit answers/i }));
}

describe("taking a quiz", () => {
  it("shows one question at a time, with its position", async () => {
    await open();

    expect(screen.getByText("Question 1 of 2")).toBeInTheDocument();
    expect(screen.getByText(mockQuiz.questions[0].prompt)).toBeInTheDocument();
    expect(screen.queryByText(mockQuiz.questions[1].prompt)).not.toBeInTheDocument();
  });

  /** §12: no time limits on placement or quizzes, and the learner is told. */
  it("says there is no time limit", async () => {
    await open();
    expect(screen.getByText(/no time limit/i)).toBeInTheDocument();
  });

  it("moves forward and back without losing an answer", async () => {
    await open();

    await userEvent.click(screen.getByLabelText(mockQuiz.questions[0].options[0].text));
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Question 2 of 2")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /previous/i }));
    expect(screen.getByLabelText(mockQuiz.questions[0].options[0].text)).toBeChecked();
  });

  it("cannot go back from the first question", async () => {
    await open();
    expect(screen.getByRole("button", { name: /previous/i })).toBeDisabled();
  });

  /**
   * AGENT.md §6 rule 1. The browser sends chosen option ids and nothing else —
   * no score, no `passed`, no count. If this ever changes, the API rejects the
   * body outright, but the browser should not be trying.
   */
  it("sends only the chosen options", async () => {
    let sent: unknown;
    api.quiz(mockQuiz);
    api.quizGrades(passedResult, (body) => (sent = body));
    at("/app/quiz/a1");
    await screen.findByRole("heading", { level: 1 });

    await answerAll();
    await screen.findByRole("heading", { name: /you got 2 of 2/i });

    expect(sent).toEqual({ answers: { q1: "q1-a", q2: "q2-a" } });
  });

  it("marks a test-out attempt as one, and says what it means", async () => {
    let sent: unknown;
    api.quiz(mockQuiz);
    api.quizGrades(passedResult, (body) => (sent = body));
    at("/app/quiz/a1?testout=1");
    await screen.findByRole("heading", { level: 1 });

    expect(screen.getByText(/you are testing out/i)).toBeInTheDocument();
    expect(screen.getByText(/no penalty for not passing/i)).toBeInTheDocument();

    await answerAll();
    await screen.findByRole("heading", { name: /you got 2 of 2/i });
    expect(sent).toEqual({ answers: { q1: "q1-a", q2: "q2-a" }, testOut: true });
  });
});

describe("the result", () => {
  const submitFor = async (result: unknown, route = "/app/quiz/a1") => {
    api.quiz(mockQuiz);
    api.quizGrades(result);
    at(route);
    await screen.findByRole("heading", { level: 1 });
    await answerAll();
  };

  it("reports a pass and that the skill is now verified", async () => {
    await submitFor(passedResult);

    expect(await screen.findByRole("heading", { name: /you got 2 of 2 \(100%\)/i })).toBeInTheDocument();
    expect(screen.getByText("Passed")).toBeInTheDocument();
    expect(screen.getByText(/HTML basics is now a verified skill/i)).toBeInTheDocument();
  });

  /** §5.10: "You got 4 of 8 (50%). You need 6 to pass." */
  it("reports a fail with how many were needed", async () => {
    await submitFor(failedResult);

    const heading = await screen.findByRole("heading", { name: /you got 1 of 2/i });
    expect(heading).toHaveTextContent("You need 2 to pass.");
  });

  /**
   * §5.10: "Correct answers are shown only for questions answered correctly,
   * so retakes remain meaningful." The API withholds them; this asserts the
   * screen does not put them back.
   */
  it("shows no right answer for a question answered wrongly", async () => {
    await submitFor(failedResult);
    await screen.findByRole("heading", { name: /you got 1 of 2/i });

    const review = screen.getByRole("region", { name: /topics to review/i });
    expect(review).toHaveTextContent(/alt attribute/i);
    // The wrong question's options must not be labelled as correct anywhere.
    expect(document.body.textContent).not.toMatch(/the correct answer/i);
    expect(screen.queryByText("To describe the image to people who cannot see it")).not.toBeInTheDocument();
  });

  /** §5.10's "Topics to review | Lesson 2 | [Review lesson]". */
  it("links a missed question to the lesson it came from", async () => {
    await submitFor(failedResult);
    await screen.findByRole("heading", { name: /you got 1 of 2/i });

    const review = screen.getByRole("region", { name: /topics to review/i });
    const link = within(review).getByRole("link", { name: /review lesson/i });
    expect(link).toHaveAttribute("href", "/app/module/mod-html-basics?lesson=lesson-3");
  });

  it("explains the questions answered correctly", async () => {
    await submitFor(passedResult);
    await screen.findByRole("heading", { name: /you got 2 of 2/i });

    const right = screen.getByRole("region", { name: /what you got right/i });
    expect(right).toHaveTextContent(/A section says the content inside belongs together/);
  });

  it("offers a retake only after a fail", async () => {
    await submitFor(failedResult);
    await screen.findByRole("heading", { name: /you got 1 of 2/i });
    expect(screen.getByRole("button", { name: /retake quiz/i })).toBeInTheDocument();
  });

  it("offers no retake after a pass", async () => {
    await submitFor(passedResult);
    await screen.findByRole("heading", { name: /you got 2 of 2/i });
    expect(screen.queryByRole("button", { name: /retake quiz/i })).not.toBeInTheDocument();
  });

  it("starts the quiz over on retake", async () => {
    await submitFor(failedResult);
    await screen.findByRole("heading", { name: /you got 1 of 2/i });

    await userEvent.click(screen.getByRole("button", { name: /retake quiz/i }));

    expect(screen.getByText("Question 1 of 2")).toBeInTheDocument();
    expect(screen.getByLabelText(mockQuiz.questions[0].options[0].text)).not.toBeChecked();
  });

  /** A learner who already passed and is reviewing should not be told otherwise. */
  it("says an already-complete module keeps its best score", async () => {
    await submitFor({ ...passedResult, completedModule: false });
    await screen.findByRole("heading", { name: /you got 2 of 2/i });
    expect(screen.getByText(/your best score stands/i)).toBeInTheDocument();
  });
});

describe("when the quiz cannot be shown", () => {
  it("says it is loading first", () => {
    api.quiz(mockQuiz);
    at("/app/quiz/a1");
    expect(screen.getByRole("status")).toHaveTextContent(/loading the quiz/i);
  });

  it("explains a quiz it cannot open", async () => {
    api.quizFails(404);
    at("/app/quiz/a1");
    expect(await screen.findByRole("heading", { name: /couldn't find that quiz/i })).toBeInTheDocument();
  });

  /**
   * §9: an error explains and directs. A failed submission must keep the
   * learner on their answers — losing them would be the worst moment to do it.
   */
  it("keeps the answers and surfaces the error when submitting fails", async () => {
    api.quiz(mockQuiz);
    api.quizGradeFails(500, "We couldn't mark that. Your answers are still here.");
    at("/app/quiz/a1");
    await screen.findByRole("heading", { level: 1 });

    await userEvent.click(screen.getByLabelText(mockQuiz.questions[0].options[0].text));
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.click(screen.getByLabelText(mockQuiz.questions[1].options[0].text));
    await userEvent.click(screen.getByRole("button", { name: /submit answers/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't mark that/i);
    // Still on the last question, with the answer intact.
    expect(screen.getByLabelText(mockQuiz.questions[1].options[0].text)).toBeChecked();
    expect(screen.queryByRole("heading", { name: /you got/i })).not.toBeInTheDocument();
  });
});

describe("accessibility", () => {
  it("has no axe violations on a question", async () => {
    const { container } = await open();
    await expectNoAxeViolations(container);
  });

  it("has no axe violations on a result", async () => {
    api.quiz(mockQuiz);
    api.quizGrades(failedResult);
    const { container } = at("/app/quiz/a1");
    await screen.findByRole("heading", { level: 1 });
    await answerAll();
    await screen.findByRole("heading", { name: /you got 1 of 2/i });
    await expectNoAxeViolations(container);
  });
});
