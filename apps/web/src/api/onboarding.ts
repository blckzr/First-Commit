import { z } from "zod";
import { apiRequest } from "./client.js";

/** design.md §5.4 — the four onboarding steps. */

export const CareerPath = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  description: z.string(),
});
export type CareerPath = z.infer<typeof CareerPath>;

const CareerPaths = z.object({ careerPaths: z.array(CareerPath) });

export const AboutAnswers = z.object({
  experienceLevel: z.enum(["none", "some", "comfortable"]).nullable(),
  goal: z.enum(["company_job", "freelance", "undecided"]).nullable(),
  weeklyHours: z.number().nullable(),
});
export type AboutAnswers = z.infer<typeof AboutAnswers>;

/**
 * The Roadmap AI job's state, so the generating screen can say what is
 * actually happening. The API deliberately sends the status and not the
 * error text — that is an internal message (AGENT.md §6 rule 2).
 */
export const GenerationStatus = z.enum(["queued", "running", "completed", "failed"]);
export type GenerationStatus = z.infer<typeof GenerationStatus>;

const OnboardingState = z.object({
  step: z.string(),
  generation: GenerationStatus.nullable().default(null),
  about: AboutAnswers.nullable(),
  careerPathId: z.string().nullable(),
});
export type OnboardingState = z.infer<typeof OnboardingState>;

const StepResult = z.object({ step: z.string(), next: z.string() });

export interface AboutInput {
  experienceLevel: "none" | "some" | "comfortable";
  goal: "company_job" | "freelance" | "undecided";
  weeklyHours: number;
}

export const onboardingApi = {
  state: (signal?: AbortSignal) =>
    apiRequest("/onboarding", { schema: OnboardingState, signal }),

  careerPaths: (signal?: AbortSignal) =>
    apiRequest("/career-paths", { schema: CareerPaths, signal }).then((r) => r.careerPaths),

  saveAbout: (input: AboutInput) =>
    apiRequest("/onboarding/about", { method: "PUT", body: input, schema: StepResult }),

  saveTarget: (careerPathId: string) =>
    apiRequest("/onboarding/target", {
      method: "PUT",
      body: { careerPathId },
      schema: StepResult,
    }),

  savePlacement: (careerPathId: string, results: Record<string, unknown>) =>
    apiRequest("/onboarding/placement", {
      method: "POST",
      body: { careerPathId, results },
      schema: StepResult,
    }),

  /** Puts a failed roadmap job back on the queue. The API picks which job. */
  retryGeneration: () =>
    apiRequest("/onboarding/generating/retry", {
      method: "POST",
      body: {},
      schema: z.object({ status: GenerationStatus }),
    }),
};
