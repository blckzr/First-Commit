import { z } from "zod";
import { apiRequest } from "./client.js";

/**
 * Issued certificates (design.md §6.7).
 *
 * **There is no issue call, and there never will be.** §6.7 says it outright —
 * "Certificates are issued automatically when requirements are met; there is no
 * manual issue button" — and §6 rule 1 is the reason: `syncCertificates()`
 * reads evidence and decides. An admin can withdraw one the platform granted,
 * and nothing else.
 */

const AdminCertificate = z.object({
  id: z.string(),
  publicCode: z.string(),
  type: z.enum(["completion", "project"]),
  title: z.string(),
  recipientName: z.string(),
  status: z.enum(["valid", "revoked", "reissued"]),
  issuedAt: z.string(),
  revokedAt: z.string().nullable(),
  revokedReason: z.string().nullable(),
  learner: z.object({ id: z.string(), email: z.string() }),
});
export type AdminCertificate = z.infer<typeof AdminCertificate>;

const CertificateList = z.object({ certificates: z.array(AdminCertificate) });

export const adminCertificatesKey = (search: string) => ["admin", "certificates", search];

export const adminCertificatesApi = {
  list: (search: string, signal?: AbortSignal) =>
    apiRequest(
      `/admin/certificates${search ? `?q=${encodeURIComponent(search)}` : ""}`,
      { schema: CertificateList, signal },
    ),

  /** A reason is required here, by the endpoint, and by the schema's own check. */
  revoke: (id: string, reason: string) =>
    apiRequest(`/admin/certificates/${id}/revoke`, {
      method: "PATCH",
      body: { reason },
      schema: z.object({ status: z.string() }),
    }),
};
