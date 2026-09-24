import { z } from "zod";
import { apiRequest } from "./client.js";

/**
 * The auth endpoints, as the browser sees them.
 *
 * Shapes are validated at the boundary (design.md §13.1 lists Zod for exactly
 * this), so a server change surfaces as one clear failure here rather than as
 * an undefined three components deep.
 */

export const SessionUser = z.object({
  id: z.string(),
  fullName: z.string(),
  email: z.string(),
  role: z.enum(["learner", "admin"]),
  emailVerified: z.boolean(),
});
export type SessionUser = z.infer<typeof SessionUser>;

const MeResponse = z.object({
  user: SessionUser,
  /** Null once onboarding is finished (design.md §4.3). */
  onboardingStep: z.string().nullable(),
  /**
   * Where the server says this learner belongs. The guards follow it rather
   * than each deciding for themselves — design.md §5.4's generating screen and
   * a guard once disagreed and the browser throttled navigation.
   *
   * Optional so a response from an older API still parses as signed in.
   */
  next: z.string().nullable().default(null),
});
const AuthResponse = z.object({ user: SessionUser, next: z.string() });
const MessageResponse = z.object({ message: z.string() });
const VerifiedResponse = z.object({ verified: z.boolean() });
const ResetResponse = z.object({ reset: z.boolean(), next: z.string() });

export interface SignUpInput {
  fullName: string;
  email: string;
  password: string;
}

export interface LogInInput {
  email: string;
  password: string;
}

export const authApi = {
  /** Throws ApiError(401) when signed out — callers treat that as "no session". */
  me: (signal?: AbortSignal) => apiRequest("/auth/me", { schema: MeResponse, signal }),

  signUp: (input: SignUpInput) =>
    apiRequest("/auth/signup", { method: "POST", body: input, schema: AuthResponse }),

  logIn: (input: LogInInput) =>
    apiRequest("/auth/login", { method: "POST", body: input, schema: AuthResponse }),

  logOut: () =>
    apiRequest("/auth/logout", { method: "POST", schema: z.undefined() }),

  forgotPassword: (email: string) =>
    apiRequest("/auth/password/forgot", {
      method: "POST",
      body: { email },
      schema: MessageResponse,
    }),

  resetPassword: (token: string, password: string) =>
    apiRequest("/auth/password/reset", {
      method: "POST",
      body: { token, password },
      schema: ResetResponse,
    }),

  verifyEmail: (token: string) =>
    apiRequest("/auth/verify-email", {
      method: "POST",
      body: { token },
      schema: VerifiedResponse,
    }),
};
