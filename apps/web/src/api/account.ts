import { z } from "zod";
import { apiRequest } from "./client.js";

/**
 * The account (design.md §5.18).
 *
 * **Nothing here takes a user id**, because none of the endpoints do: the
 * account acted on is the session's. A client that could name an account would
 * be a client that could name somebody else's, and the shape is the first place
 * to make that impossible.
 *
 * The export is not here — it is a file download, so it goes through
 * `downloadFile` for the same reason the PDFs do: the API is on another origin
 * and a plain `<a href>` would arrive without the session cookie.
 */

const Account = z.object({
  fullName: z.string(),
  email: z.string(),
  emailVerified: z.boolean(),
  createdAt: z.string().nullable(),
  /**
   * Whether the delete can succeed, decided by the API.
   *
   * An admin cannot be deleted — the activity log is append-only, so removing
   * the account would mean editing the record of what it did. The browser must
   * not work that out for itself: it is a schema fact, and a screen that
   * guesses it will be wrong the moment the schema moves.
   */
  canDelete: z.boolean(),
});
export type Account = z.infer<typeof Account>;

const ProfileSaved = z.object({
  fullName: z.string(),
  email: z.string(),
  emailChanged: z.boolean(),
  /**
   * False when the address changed but the mail did not go out. The screen says
   * so and offers the resend — reporting "check your inbox" for a message that
   * was never sent leaves somebody waiting on nothing.
   */
  verificationSent: z.boolean(),
});

export const accountKey = ["account"] as const;

export const accountApi = {
  get: (signal?: AbortSignal) => apiRequest("/account", { schema: Account, signal }),

  saveProfile: (profile: { fullName: string; email: string }) =>
    apiRequest("/account/profile", { method: "PUT", body: profile, schema: ProfileSaved }),

  changePassword: (passwords: { currentPassword: string; newPassword: string }) =>
    apiRequest("/account/password", {
      method: "PUT",
      body: passwords,
      schema: z.object({ changed: z.boolean(), otherSessionsEnded: z.boolean() }),
    }),

  /** No body. The account is the session's, and §5.18's dialog is the confirmation. */
  deleteAccount: () =>
    apiRequest("/account", {
      method: "DELETE",
      schema: z.object({ deleted: z.boolean() }),
    }),
};
