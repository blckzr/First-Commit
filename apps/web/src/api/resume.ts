import { z } from "zod";
import { apiRequest } from "./client.js";

/**
 * The resume (design.md §5.16).
 *
 * **Nothing here can add a skill.** The evidence comes down from the API and the
 * only thing that goes back up is *which* of it to show, by id. §5.16: learners
 * "choose which to include but cannot add unverified skills" — so there is no
 * call shaped to let them.
 */

const VerifiedSkill = z.object({
  skillId: z.string(),
  name: z.string(),
  moduleCount: z.number(),
  method: z.enum(["passed", "tested_out"]),
});
export type VerifiedSkill = z.infer<typeof VerifiedSkill>;

const VerifiedCertificate = z.object({
  publicCode: z.string(),
  title: z.string(),
  issuedAt: z.string(),
});

const VerifiedProject = z.object({
  id: z.string(),
  title: z.string(),
  repoFullName: z.string().nullable(),
  demoUrl: z.string().nullable(),
  technology: z.string().nullable(),
  completedAt: z.string(),
});

const Evidence = z.object({
  skills: z.array(VerifiedSkill),
  certificates: z.array(VerifiedCertificate),
  /** Empty until a capstone is finished — §7: no capstone, no Projects section. */
  projects: z.array(VerifiedProject),
});
export type Evidence = z.infer<typeof Evidence>;

const Details = z.object({
  fullName: z.string(),
  email: z.string(),
  phone: z.string(),
  city: z.string(),
  links: z.array(z.object({ label: z.string(), url: z.string() })),
  education: z.array(
    z.object({
      school: z.string(),
      degree: z.string().default(""),
      start: z.string().default(""),
      end: z.string().default(""),
    }),
  ),
});
export type Details = z.infer<typeof Details>;

const Content = z.object({
  summary: z.string().default(""),
  skills: z.array(z.string()).default([]),
  projects: z.array(z.object({ projectId: z.string(), description: z.string() })).default([]),
});
export type Content = z.infer<typeof Content>;

const ResumePage = z.object({
  resume: z.object({
    id: z.string(),
    careerPathId: z.string().nullable(),
    selected: z.object({
      skillIds: z.array(z.string()).default([]),
      certificateCodes: z.array(z.string()).default([]),
      projectIds: z.array(z.string()).default([]),
    }),
    content: Content.nullable(),
    /** Which fields the model wrote, so §5.16 can label them. */
    aiFields: z.array(z.string()),
    generatedAt: z.string().nullable(),
    status: z.string(),
  }),
  evidence: Evidence,
  details: Details,
});
export type ResumePage = z.infer<typeof ResumePage>;

export interface DetailsInput {
  email: string;
  phone: string;
  city: string;
  links: { label: string; url: string }[];
  education: { school: string; degree: string; start: string; end: string }[];
}

export const resumeApi = {
  get: (signal?: AbortSignal) => apiRequest("/resume", { schema: ResumePage, signal }),

  saveDetails: (details: DetailsInput) =>
    apiRequest("/resume/details", {
      method: "PUT",
      body: details,
      schema: z.object({ details: z.unknown() }),
    }),

  /** Ids only. The API checks each one against the evidence before storing it. */
  setSelection: (selection: {
    careerPathId?: string | null;
    skillIds?: string[];
    certificateCodes?: string[];
    projectIds?: string[];
  }) =>
    apiRequest("/resume/selection", {
      method: "PUT",
      body: selection,
      schema: z.object({ selected: z.unknown(), careerPathId: z.string().nullable() }),
    }),

  /** No body: what goes on a resume is the server's to decide (§6 rule 1). */
  generate: () =>
    apiRequest("/resume/generate", {
      method: "POST",
      body: {},
      schema: z.object({ status: z.string() }),
    }),

  edit: (content: { summary?: string; projects?: { projectId: string; description: string }[] }) =>
    apiRequest("/resume", {
      method: "PATCH",
      body: content,
      schema: z.object({ content: Content, aiFields: z.array(z.string()) }),
    }),
};
