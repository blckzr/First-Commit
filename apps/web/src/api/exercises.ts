import { z } from "zod";
import { apiRequest } from "./client.js";

/**
 * Coding exercises (design.md §5.11).
 *
 * Note what the schemas below **cannot** describe: a hidden test case's name or
 * assertion, a reference solution, a rubric. The API does not send them
 * (AGENT.md §6 rule 2), and parsing with Zod here means a response that started
 * sending one would be a visible shape change rather than something that
 * quietly rendered.
 */

const File = z.object({ path: z.string(), content: z.string() });
export type ExerciseFile = z.infer<typeof File>;

/**
 * One case as the worker reported it.
 *
 * A hidden case arrives with its name and outcome and nothing else — that is
 * the redaction the worker applies, and the reason `expected` and `actual` are
 * optional here rather than required.
 */
const TestResult = z.object({
  testCaseId: z.string().optional(),
  name: z.string(),
  passed: z.boolean(),
  expected: z.string().optional(),
  actual: z.string().optional(),
  hidden: z.boolean().default(false),
});
export type TestResult = z.infer<typeof TestResult>;

/** What the worker writes when the code did not run at all. */
const RunError = z.object({ error: z.string() });

const Feedback = z.object({
  aiOutputId: z.string(),
  flagged: z.boolean(),
  summary: z.string(),
  issues: z.array(
    z.object({
      line: z.number().nullable(),
      problem: z.string(),
      hint: z.string(),
    }),
  ),
  encouragement: z.string(),
});
export type Feedback = z.infer<typeof Feedback>;

const Submission = z.object({
  id: z.string(),
  status: z.string(),
  /** Present on the attempt the exercise reopens, absent when polling one. */
  files: z.array(File).optional(),
  passed: z.boolean().nullable(),
  testResults: z.union([z.array(TestResult), RunError]).nullable(),
  submittedAt: z.string(),
  completedAt: z.string().nullable().default(null),
  feedbackStatus: z.string().default("none"),
  feedback: Feedback.nullable().default(null),
});
export type Submission = z.infer<typeof Submission>;

const Exercise = z.object({
  id: z.string(),
  title: z.string(),
  instructions: z.string(),
  runtime: z.string().nullable(),
  moduleId: z.string(),
  moduleTitle: z.string(),
  starterFiles: z.array(File),
  /** Visible cases only, by name. There is no count of the hidden ones. */
  visibleTests: z.array(z.object({ id: z.string(), name: z.string() })),
  lastSubmission: Submission.nullable(),
});
export type Exercise = z.infer<typeof Exercise>;

const ExerciseResponse = z.object({ exercise: Exercise });
const SubmissionResponse = z.object({ submission: Submission });

export const exercisesApi = {
  get: (id: string, signal?: AbortSignal) =>
    apiRequest(`/exercises/${id}`, { schema: ExerciseResponse, signal }).then((r) => r.exercise),

  /**
   * §5.11's "Submit", and §6 rule 4: files, nothing else. The result is a
   * request to be graded — `passed` is null until the worker has run the tests
   * itself.
   */
  submit: (id: string, files: ExerciseFile[]) =>
    apiRequest(`/exercises/${id}/submissions`, {
      method: "POST",
      body: { files },
      schema: SubmissionResponse,
    }).then((r) => r.submission),

  submission: (id: string, signal?: AbortSignal) =>
    apiRequest(`/submissions/${id}`, { schema: SubmissionResponse, signal }).then(
      (r) => r.submission,
    ),
};
