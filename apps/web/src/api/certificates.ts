import { z } from "zod";
import { apiRequest } from "./client.js";

/**
 * Certificates (design.md §5.15).
 *
 * **There is no `issue` here, and there is no endpoint to call.** AGENT.md §6
 * rule 1: the backend checks the requirements itself. Reading the list is what
 * triggers the check, which is why `list()` is the only learner call.
 */

const Certificate = z.object({
  publicCode: z.string(),
  type: z.enum(["completion", "project"]),
  title: z.string(),
  recipientName: z.string(),
  skills: z.array(z.string()),
  status: z.enum(["valid", "revoked", "reissued"]),
  issuedAt: z.string(),
  revokedAt: z.string().nullable(),
  roadmapId: z.string(),
  verifyPath: z.string(),
});
export type Certificate = z.infer<typeof Certificate>;

/** Why a roadmap has not earned one yet, so §5.15 can say something true. */
const Progress = z.object({
  roadmapId: z.string(),
  title: z.string(),
  required: z.number(),
  completed: z.number(),
  blockedBy: z.enum(["no-modules", "technology-not-chosen"]).nullable(),
});
export type Progress = z.infer<typeof Progress>;

const CertificateList = z.object({
  certificates: z.array(Certificate),
  progress: z.array(Progress),
  /**
   * §5.15's Project Certificate card.
   *
   * A union rather than one shape with optional fields, so the screen cannot
   * read a milestone count off a certificate that has been earned, or a reason
   * off one that has not.
   */
  projectCertificate: z.union([
    z.object({ available: z.literal(true) }),
    z.object({
      available: z.literal(false),
      reason: z.enum(["no-project", "in-progress"]),
      /** Present on `in-progress`, so the card can say "2 of 5". */
      complete: z.number().optional(),
      total: z.number().optional(),
    }),
  ]),
});
export type CertificateList = z.infer<typeof CertificateList>;

/**
 * The public verification result. Three states, all of them a 200 — §5.15 spells
 * out a page for an unknown code, which is an answer rather than an error.
 *
 * A discriminated union, so the screen cannot read `recipientName` off a revoked
 * result: the API does not send it, and this makes reading it a compile error
 * rather than `undefined` on the page.
 */
const Verification = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("valid"),
    code: z.string(),
    type: z.enum(["completion", "project"]),
    recipientName: z.string(),
    title: z.string(),
    issuedAt: z.string(),
    skills: z.array(z.string()),
    projectTitle: z.string().nullable(),
    repository: z.string().nullable(),
  }),
  z.object({
    status: z.literal("revoked"),
    code: z.string(),
    revokedAt: z.string().nullable(),
    // No reason, by design — §5.15 shows the date and nothing else.
  }),
  z.object({ status: z.literal("not-found"), code: z.string() }),
]);
export type Verification = z.infer<typeof Verification>;

const VerificationResponse = z.object({ result: Verification });

export const certificatesApi = {
  list: (signal?: AbortSignal) =>
    apiRequest("/certificates", { schema: CertificateList, signal }),

  /** Public: no session, and none is sent. */
  verify: (code: string, signal?: AbortSignal) =>
    apiRequest(`/verify/${encodeURIComponent(code)}`, {
      schema: VerificationResponse,
      signal,
    }).then((r) => r.result),
};
