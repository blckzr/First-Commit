import { z } from "zod";
import { apiRequest } from "./client.js";

/**
 * The quiz editor (design.md §6.3's Assessment tab).
 *
 * **`correctIndex`, not an option id.** The editor rewrites the whole quiz, so
 * ids it was given would not survive the round trip — carrying them would
 * invite sending one that no longer exists. An index into `options` is the only
 * reference that stays true across a replace.
 */

const Question = z.object({
  prompt: z.string(),
  explanation: z.string(),
  options: z.array(z.string()),
  correctIndex: z.number(),
});
export type Question = z.infer<typeof Question>;

const Quiz = z.object({
  id: z.string(),
  title: z.string(),
  instructions: z.string(),
  passingScore: z.number(),
  questions: z.array(Question),
});
export type Quiz = z.infer<typeof Quiz>;

const QuizResponse = z.object({
  editable: z.boolean(),
  quiz: Quiz.nullable(),
});

export const quizKey = (moduleId: string, versionId: string) =>
  ["admin", "quiz", moduleId, versionId];

export const adminQuizzesApi = {
  get: (moduleId: string, versionId: string, signal?: AbortSignal) =>
    apiRequest(`/admin/modules/${moduleId}/versions/${versionId}/quiz`, {
      schema: QuizResponse,
      signal,
    }),

  save: (
    moduleId: string,
    versionId: string,
    quiz: { title: string; instructions: string; passingScore: number; questions: Question[] },
  ) =>
    apiRequest(`/admin/modules/${moduleId}/versions/${versionId}/quiz`, {
      method: "PUT",
      body: quiz,
      schema: z.object({ questions: z.number() }),
    }),
};
