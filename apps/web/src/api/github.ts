import { z } from "zod";
import { apiRequest } from "./client.js";

/**
 * The learner's GitHub connection (design.md §5.14 stage 2).
 *
 * **Nothing here holds a token.** The browser never sees one: the API keeps the
 * App credentials, and this only ever learns which account is connected and
 * which repositories that installation grants.
 */

const Repository = z.object({
  id: z.number(),
  fullName: z.string(),
  private: z.boolean(),
});
export type Repository = z.infer<typeof Repository>;

export const GitHubConnection = z.object({
  connected: z.boolean(),
  /** False when no App is registered — the API is using its development client. */
  configured: z.boolean(),
  login: z.string().optional(),
  connectedAt: z.string().optional(),
  /**
   * Whether GitHub answered just now. A connected account the platform cannot
   * reach is not a disconnected one, and the screen says so rather than
   * offering to reconnect something that is already fine.
   */
  reachable: z.boolean().optional(),
  repositories: z.array(Repository),
});
export type GitHubConnection = z.infer<typeof GitHubConnection>;

const ConnectUrl = z.object({ url: z.string(), configured: z.boolean() });

export const githubKey = ["github", "connection"];

export const githubApi = {
  connection: (signal?: AbortSignal) =>
    apiRequest("/github/connection", { schema: GitHubConnection, signal }),

  /**
   * Where to send the learner. Fetched rather than built here, because only the
   * API knows whether a real App is configured and what its install URL is.
   */
  connectUrl: (signal?: AbortSignal) =>
    apiRequest("/github/connect", { schema: ConnectUrl, signal }),
};
