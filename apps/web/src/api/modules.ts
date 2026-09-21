import { z } from "zod";
import { apiRequest } from "./client.js";

/**
 * The module page and the quiz (design.md §5.9, §5.10), validated at the
 * boundary.
 *
 * `LessonBlock` mirrors §13.3: a block list where `text` is plain except for
 * `backticks` marking inline code. Parsing it here means the renderer can
 * switch exhaustively on `type` and an unknown block is a parse failure at the
 * edge, not an empty gap in the middle of a lesson.
 */

const LessonBlock = z.discriminatedUnion("type", [
  z.object({ type: z.literal("paragraph"), text: z.string() }),
  z.object({ type: z.literal("heading"), text: z.string() }),
  z.object({ type: z.literal("list"), ordered: z.boolean().optional(), items: z.array(z.string()) }),
  z.object({
    type: z.literal("code"),
    language: z.string(),
    code: z.string(),
    caption: z.string().optional(),
  }),
  z.object({ type: z.literal("callout"), tone: z.enum(["info", "notice"]), text: z.string() }),
]);
export type LessonBlock = z.infer<typeof LessonBlock>;

const Lesson = z.object({
  id: z.string(),
  sortOrder: z.number(),
  title: z.string(),
  content: z.object({ blocks: z.array(LessonBlock) }).nullable(),
  completed: z.boolean(),
});
export type Lesson = z.infer<typeof Lesson>;

const Assessment = z.object({
  id: z.string(),
  type: z.enum(["quiz", "code"]),
  title: z.string(),
  instructions: z.string(),
  passingScore: z.number(),
  questionCount: z.number(),
  bestScore: z.number().nullable(),
  attempts: z.number(),
  passed: z.boolean(),
});
export type Assessment = z.infer<typeof Assessment>;

export const ModulePage = z.object({
  moduleId: z.string(),
  slug: z.string(),
  kind: z.string(),
  skillTitle: z.string(),
  technologyName: z.string().nullable(),
  versionId: z.string(),
  versionNo: z.number(),
  title: z.string(),
  description: z.string(),
  estimatedHours: z.number(),
  lessons: z.array(Lesson),
  assessments: z.array(Assessment),
  enrolled: z.boolean(),
  currentLessonId: z.string().nullable(),
  completion: z.object({ method: z.string(), score: z.number().nullable() }).nullable(),
  newerVersion: z.object({ versionNo: z.number(), changeSummary: z.string() }).nullable(),
});
export type ModulePage = z.infer<typeof ModulePage>;

const ModuleResponse = z.object({ module: ModulePage });

export const Quiz = z.object({
  id: z.string(),
  title: z.string(),
  instructions: z.string(),
  passingScore: z.number(),
  moduleId: z.string(),
  moduleTitle: z.string(),
  attempts: z.number(),
  questions: z.array(
    z.object({
      id: z.string(),
      prompt: z.string(),
      options: z.array(z.object({ id: z.string(), text: z.string() })),
    }),
  ),
});
export type Quiz = z.infer<typeof Quiz>;

const QuizResponse = z.object({ assessment: Quiz });

/**
 * A graded attempt. `correctOptionId` and `explanation` are null for a question
 * answered wrongly — §5.10 keeps retakes meaningful — so the result screen has
 * to handle their absence rather than treating it as a bug.
 */
export const GradeResult = z.object({
  attemptNo: z.number(),
  score: z.number(),
  correctCount: z.number(),
  questionCount: z.number(),
  needed: z.number(),
  passed: z.boolean(),
  completedModule: z.boolean(),
  answers: z.array(
    z.object({
      questionId: z.string(),
      chosenOptionId: z.string().nullable(),
      correct: z.boolean(),
      correctOptionId: z.string().nullable(),
      explanation: z.string().nullable(),
      linkedLessonId: z.string().nullable(),
    }),
  ),
});
export type GradeResult = z.infer<typeof GradeResult>;

const AttemptResponse = z.object({ result: GradeResult });

export const modulesApi = {
  get: (moduleId: string, signal?: AbortSignal) =>
    apiRequest(`/modules/${moduleId}`, { schema: ModuleResponse, signal }).then((r) => r.module),

  start: (moduleId: string) =>
    apiRequest(`/modules/${moduleId}/start`, {
      method: "POST",
      body: {},
      schema: z.object({ started: z.boolean() }),
    }),

  completeLesson: (lessonId: string) =>
    apiRequest(`/lessons/${lessonId}/complete`, {
      method: "POST",
      body: {},
      schema: z.object({ completed: z.boolean() }),
    }),

  quiz: (assessmentId: string, signal?: AbortSignal) =>
    apiRequest(`/assessments/${assessmentId}`, { schema: QuizResponse, signal }).then(
      (r) => r.assessment,
    ),

  /**
   * Submits chosen options and nothing else. There is deliberately no way to
   * send a score from here — the server computes it (AGENT.md §6 rule 1), and
   * the API rejects a body carrying one.
   */
  submitQuiz: (assessmentId: string, answers: Record<string, string>, testOut = false) =>
    apiRequest(`/assessments/${assessmentId}/attempts`, {
      method: "POST",
      body: testOut ? { answers, testOut: true } : { answers },
      schema: AttemptResponse,
    }).then((r) => r.result),
};
