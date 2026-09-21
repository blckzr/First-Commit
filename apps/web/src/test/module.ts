import type { GradeResult, ModulePage, Quiz } from "../api/modules";

/**
 * Fixtures for the module page and the quiz, typed against the API schemas so a
 * change to either breaks here rather than at the first render.
 *
 * The lesson exercises every block type §13.3 defines, including backticks for
 * inline code — the renderer switches exhaustively, and a fixture that only
 * used paragraphs would leave most of that untested.
 */

export const mockModule: ModulePage = {
  moduleId: "mod-html-basics",
  slug: "html-basics",
  kind: "core",
  skillTitle: "HTML",
  technologyName: null,
  versionId: "v1",
  versionNo: 1,
  title: "HTML basics",
  description: "The tags a page is built from, and how a browser reads them.",
  estimatedHours: 4,
  enrolled: false,
  currentLessonId: null,
  completion: null,
  newerVersion: null,
  lessons: [
    {
      id: "lesson-1",
      sortOrder: 0,
      title: "What a page is made of",
      completed: false,
      content: {
        blocks: [
          { type: "paragraph", text: "An HTML file is a list of elements." },
          // No backticks, and HTML-looking text. A lesson teaching HTML will
          // contain tags in prose, and none of it may become markup.
          { type: "paragraph", text: "Write <strong>bold</strong> with the strong element." },
          { type: "heading", text: "The shape of every page" },
          { type: "paragraph", text: "The `<head>` holds information about the page." },
          { type: "code", language: "html", code: "<p>Hello</p>", caption: "A paragraph" },
          { type: "list", items: ["One", "Two"] },
          { type: "list", ordered: true, items: ["First", "Second"] },
          { type: "callout", tone: "info", text: "`lang` tells a screen reader the language." },
          { type: "callout", tone: "notice", text: "A `<br>` list is not a list." },
        ],
      },
    },
    {
      id: "lesson-2",
      sortOrder: 1,
      title: "Saying what content means",
      completed: false,
      content: { blocks: [{ type: "paragraph", text: "A div is a box with no meaning." }] },
    },
    {
      id: "lesson-3",
      sortOrder: 2,
      title: "Images, links, and alt text",
      completed: false,
      // Not every lesson is written; the page has to say so rather than render blank.
      content: null,
    },
  ],
  assessments: [
    {
      id: "a1",
      type: "quiz",
      title: "HTML basics quiz",
      instructions: "Four questions.",
      passingScore: 70,
      questionCount: 4,
      bestScore: null,
      attempts: 0,
      passed: false,
    },
  ],
};

export const mockQuiz: Quiz = {
  id: "a1",
  title: "HTML basics quiz",
  instructions: "Four questions on the tags and structure from this module.",
  passingScore: 70,
  moduleId: "mod-html-basics",
  moduleTitle: "HTML basics",
  attempts: 0,
  questions: [
    {
      id: "q1",
      prompt: "What does a section element tell a browser that a div does not?",
      options: [
        { id: "q1-a", text: "That the content inside is one part of the page" },
        { id: "q1-b", text: "That the content should be centred" },
      ],
    },
    {
      id: "q2",
      prompt: "Why does an img need an alt attribute?",
      options: [
        { id: "q2-a", text: "To describe the image to people who cannot see it" },
        { id: "q2-b", text: "To set the image's width" },
      ],
    },
  ],
};

/** A pass. Both explanations come back because both answers were right. */
export const passedResult: GradeResult = {
  attemptNo: 1,
  score: 100,
  correctCount: 2,
  questionCount: 2,
  needed: 2,
  passed: true,
  completedModule: true,
  answers: [
    {
      questionId: "q1",
      chosenOptionId: "q1-a",
      correct: true,
      correctOptionId: "q1-a",
      explanation: "A section says the content inside belongs together.",
      linkedLessonId: null,
    },
    {
      questionId: "q2",
      chosenOptionId: "q2-a",
      correct: true,
      correctOptionId: "q2-a",
      explanation: "alt is what a screen reader announces.",
      linkedLessonId: null,
    },
  ],
};

/**
 * A fail. Note what the wrong answer carries: no `correctOptionId` and no
 * explanation (§5.10 keeps retakes meaningful), and a lesson to go back to.
 */
export const failedResult: GradeResult = {
  attemptNo: 1,
  score: 50,
  correctCount: 1,
  questionCount: 2,
  needed: 2,
  passed: false,
  completedModule: false,
  answers: [
    {
      questionId: "q1",
      chosenOptionId: "q1-a",
      correct: true,
      correctOptionId: "q1-a",
      explanation: "A section says the content inside belongs together.",
      linkedLessonId: null,
    },
    {
      questionId: "q2",
      chosenOptionId: "q2-b",
      correct: false,
      correctOptionId: null,
      explanation: null,
      linkedLessonId: "lesson-3",
    },
  ],
};
