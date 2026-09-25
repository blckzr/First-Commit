import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router";
import { render } from "../../test/render";
import { api } from "../../test/server";
import { mockModule } from "../../test/module";
import { expectNoAxeViolations } from "../../test/axe";
import { Module } from "./Module";

/**
 * design.md §5.9. The API is stubbed at the network boundary, so every test
 * exercises the real query, the Zod parse of the lesson blocks, and the render.
 */
function at(route: string) {
  return render(
    <Routes>
      <Route path="/app/module/:id" element={<Module />} />
    </Routes>,
    { route },
  );
}

const open = async (module: unknown = mockModule) => {
  api.module(module);
  const result = at("/app/module/m1");
  await screen.findByRole("heading", { level: 1 });
  return result;
};

describe("the module page", () => {
  it("shows the module, its lessons, and the quiz", async () => {
    await open();

    expect(screen.getByRole("heading", { level: 1, name: "HTML basics" })).toBeInTheDocument();

    /**
     * §5.9: the quiz is a row in the lesson list, not a control beside it —
     * three lessons and the quiz make four rows.
     */
    const nav = screen.getByRole("navigation", { name: "Lessons in this module" });
    expect(within(nav).getAllByRole("listitem")).toHaveLength(4);
    expect(within(nav).getByRole("link", { name: /quiz/i })).toBeInTheDocument();
    expect(nav).toHaveTextContent("4 questions");
  });

  it("opens the first lesson by default", async () => {
    await open();
    expect(
      screen.getByRole("heading", { level: 2, name: "What a page is made of" }),
    ).toBeInTheDocument();
  });

  /** §13.5: the open lesson is in the URL, so it is linkable and survives a resize. */
  it("opens the lesson named in the address", async () => {
    api.module(mockModule);
    at("/app/module/m1?lesson=lesson-2");
    expect(
      await screen.findByRole("heading", { level: 2, name: "Saying what content means" }),
    ).toBeInTheDocument();
  });

  it("moves between lessons", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: /Saying what content means/ }));
    expect(
      screen.getByRole("heading", { level: 2, name: "Saying what content means" }),
    ).toBeInTheDocument();
  });

  /** §9: an unwritten lesson says so rather than showing a blank column. */
  it("says when a lesson has not been written", async () => {
    api.module(mockModule);
    at("/app/module/m1?lesson=lesson-3");
    expect(await screen.findByText(/hasn't been written yet/i)).toBeInTheDocument();
  });

  it("resumes at the lesson the learner reached", async () => {
    await open({ ...mockModule, enrolled: true, currentLessonId: "lesson-2" });
    expect(
      screen.getByRole("heading", { level: 2, name: "Saying what content means" }),
    ).toBeInTheDocument();
  });
});

describe("lesson content", () => {
  /** Every block type §13.3 defines has to render. */
  it("renders each kind of block", async () => {
    await open();

    expect(screen.getByText(/An HTML file is a list of elements/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "The shape of every page" })).toBeInTheDocument();
    expect(screen.getByText("<p>Hello</p>")).toBeInTheDocument();
    expect(screen.getByText("A paragraph")).toBeInTheDocument();
    expect(screen.getByText("One")).toBeInTheDocument();
    expect(screen.getByText("First")).toBeInTheDocument();
    expect(screen.getByText(/tells a screen reader the language/)).toBeInTheDocument();
  });

  /** §8: a callout is icon + word + colour, never colour alone. */
  it("labels callouts in words", async () => {
    await open();
    expect(screen.getByText("Note")).toBeInTheDocument();
    expect(screen.getByText("Watch out")).toBeInTheDocument();
  });

  /**
   * The case that matters most: text with **no** backticks at all.
   *
   * A lesson teaching HTML is full of tags written in prose, and none of it may
   * become markup. This is the assertion that stops the renderer ever reaching
   * for `dangerouslySetInnerHTML` as a shortcut.
   */
  it("renders HTML-looking prose as text, not as markup", async () => {
    const { container } = await open();

    expect(screen.getByText(/Write <strong>bold<\/strong> with the strong element/)).toBeInTheDocument();
    expect(container.querySelector("strong")).toBeNull();
  });

  /**
   * Backticks are the only inline grammar, and they render as a `<code>` text
   * node — never as markup.
   */
  it("renders backticks as inline code, not as markup", async () => {
    const { container } = await open();

    const inline = container.querySelectorAll("p code");
    expect(inline.length).toBeGreaterThan(0);
    expect([...inline].some((el) => el.textContent === "<head>")).toBe(true);
    // The angle brackets are text, so no element was created from them.
    expect(container.querySelector("head")).toBeNull();
  });
});

describe("reading a lesson", () => {
  it("marks it read, enrols the learner, and moves on", async () => {
    let completed: string | undefined;
    api.module(mockModule);
    api.lessonCompletes((lessonId) => (completed = lessonId));

    at("/app/module/m1");
    await screen.findByRole("heading", { level: 1 });

    await userEvent.click(screen.getByRole("button", { name: /next lesson/i }));

    expect(completed).toBe("lesson-1");
    expect(
      await screen.findByRole("heading", { level: 2, name: "Saying what content means" }),
    ).toBeInTheDocument();
  });

  it("announces that the lesson was marked read", async () => {
    api.module(mockModule);
    api.lessonCompletes();
    at("/app/module/m1");
    await screen.findByRole("heading", { level: 1 });

    await userEvent.click(screen.getByRole("button", { name: /next lesson/i }));
    expect(await screen.findByRole("status")).toHaveTextContent(/marked as read/i);
  });

  it("shows which lessons are already read, in words as well as a tick", async () => {
    const read = {
      ...mockModule,
      enrolled: true,
      lessons: mockModule.lessons.map((l, i) => (i === 0 ? { ...l, completed: true } : l)),
    };
    await open(read);

    const nav = screen.getByRole("navigation", { name: "Lessons in this module" });
    expect(within(nav).getByText("Read")).toBeInTheDocument();
  });

  it("offers no Previous on the first lesson", async () => {
    await open();
    expect(screen.getByRole("button", { name: /previous/i })).toBeDisabled();
  });
});

describe("versions and completion", () => {
  /** §6 rule 6 / §5.9: in progress — you keep your version. */
  it("explains a newer version to a learner part-way through", async () => {
    await open({
      ...mockModule,
      enrolled: true,
      newerVersion: { versionNo: 2, changeSummary: "Clearer examples." },
    });
    expect(screen.getByRole("note")).toHaveTextContent(/newer version .* is available/i);
    expect(screen.getByRole("note")).toHaveTextContent(/keep your progress/i);
  });

  /** And to one who already passed: the credit stays. */
  it("explains a newer version to a learner who already passed", async () => {
    await open({
      ...mockModule,
      completion: { method: "passed", score: 88 },
      newerVersion: { versionNo: 2, changeSummary: "Clearer examples." },
    });
    expect(screen.getByRole("note")).toHaveTextContent(/updated after you passed it/i);
    expect(screen.getByRole("note")).toHaveTextContent(/Your credit stays/i);
  });

  /** §8: "Passed, 88%" — the score is part of the status. */
  it("shows a completion with its score", async () => {
    await open({ ...mockModule, completion: { method: "passed", score: 88 } });
    expect(screen.getByText("Passed, 88%")).toBeInTheDocument();
  });

  it("says tested out rather than passed", async () => {
    await open({ ...mockModule, completion: { method: "tested_out", score: null } });
    expect(screen.getByText("Tested out")).toBeInTheDocument();
  });

  /** §5.9: "Already know this?" — offered only while there is something to gain. */
  it("offers test-out on a module not yet complete", async () => {
    await open();
    expect(screen.getByRole("link", { name: /test out/i })).toBeInTheDocument();
  });

  it("stops offering test-out once the module is complete", async () => {
    await open({ ...mockModule, completion: { method: "passed", score: 88 } });
    expect(screen.queryByRole("link", { name: /test out/i })).not.toBeInTheDocument();
  });
});

describe("when the module cannot be shown", () => {
  it("says it is loading first", () => {
    api.module(mockModule);
    at("/app/module/m1");
    expect(screen.getByRole("status")).toHaveTextContent(/loading this module/i);
  });

  it("explains a module it cannot open", async () => {
    api.moduleFails(404);
    at("/app/module/m1");
    expect(await screen.findByRole("heading", { name: /couldn't find that module/i })).toBeInTheDocument();
  });

  it("treats an unparseable response as a failure", async () => {
    api.module({ moduleId: "m1", title: "HTML basics" });
    at("/app/module/m1");
    expect(await screen.findByRole("heading", { name: /isn't available right now/i })).toBeInTheDocument();
  });
});

describe("accessibility", () => {
  it("has no axe violations", async () => {
    const { container } = await open();
    await expectNoAxeViolations(container);
  });
});

describe("§5.9 — the exercise row", () => {
  const withExercise = {
    ...mockModule,
    assessments: [
      ...mockModule.assessments,
      {
        id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        type: "code" as const,
        title: "Sum of even numbers",
        instructions: "Return the sum of the evens.",
        passingScore: 100,
        questionCount: 0,
        bestScore: null,
        attempts: 0,
        passed: false,
      },
    ],
  };

  it("links to the exercise screen", async () => {
    await open(withExercise);
    expect(screen.getByRole("link", { name: /Exercise/ })).toHaveAttribute(
      "href",
      "/app/exercise/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    );
  });

  it("says when it has been passed", async () => {
    await open({
      ...withExercise,
      assessments: withExercise.assessments.map((a) =>
        a.type === "code" ? { ...a, passed: true } : a,
      ),
    });
    expect(screen.getByRole("link", { name: /Exercise/ })).toHaveTextContent("Passed");
  });

  it("shows no exercise row on a module without one", async () => {
    await open();
    expect(screen.queryByRole("link", { name: /Exercise/ })).not.toBeInTheDocument();
  });
});
