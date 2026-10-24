import { randomBytes } from "node:crypto";
import { Router } from "express";
import type { Pool } from "pg";
import { config } from "../config.js";
import { requireAuth, sessionUser } from "../middleware/session.js";
import type { GitHubClient } from "./index.js";

/**
 * Connecting a GitHub account (design.md §5.14 stage 2, proposal §6.2).
 *
 * ### The callback is a GET that writes, and that is not a mistake
 *
 * OAuth sends the learner back by browser redirect, so the only method
 * available is GET. The CSRF guard covers state-changing *methods* and cannot
 * help here, which is exactly what the `state` parameter is for: a random value
 * minted when the flow starts, kept in an `httpOnly` cookie, and required to
 * match on the way back.
 *
 * Without it, anyone could send a signed-in learner to
 * `/github/callback?installation_id=<theirs>&code=<theirs>` and attach **their**
 * repository to that learner's account — which would put someone else's code
 * behind that learner's Project Certificate.
 *
 * ### One GitHub account, one learner
 *
 * `github_connections.github_user_id` is `unique`. A second platform account
 * connecting the same GitHub account is refused rather than silently moved,
 * because moving it would take a repository away from the first learner's
 * project without either of them being told.
 */

/** Short-lived, and only has to survive one round trip to GitHub. */
const STATE_COOKIE = "fc_github_state";
const STATE_MAX_AGE_MS = 10 * 60 * 1000;

export function githubRoutes(pool: Pool, github: GitHubClient): Router {
  const router = Router();

  /**
   * Where to send the learner. The URL is built by the client, so the
   * development one can point straight back at the callback and the real one at
   * `github.com/apps/<slug>/installations/new`.
   */
  router.get("/github/connect", requireAuth, (req, res) => {
    sessionUser(req);

    const state = randomBytes(32).toString("base64url");
    res.cookie(STATE_COOKIE, state, {
      httpOnly: true,
      secure: config.isProduction,
      // Matches the session cookie's policy, so both survive GitHub's
      // cross-site redirect back to this API.
      sameSite: config.isProduction ? "none" : "lax",
      maxAge: STATE_MAX_AGE_MS,
      path: "/",
    });

    /**
     * Made absolute against **this API's** own host.
     *
     * The development client returns a relative callback, because it is the
     * only implementation that sends the learner back to us rather than to
     * github.com — and it cannot know what host it is running on. Left
     * relative, the browser would resolve it against the web app's origin
     * (:5173) and never reach the API (:4000), which would break the one flow
     * the development client exists to make workable. An absolute GitHub URL
     * passes through untouched, since `URL` ignores the base for one.
     */
    const url = new URL(github.installUrl(state), `${req.protocol}://${req.get("host")}`);

    res.json({ url: url.toString(), configured: github.configured });
  });

  router.get("/github/callback", requireAuth, async (req, res) => {
    const user = sessionUser(req);

    const expected = (req.cookies as Record<string, string> | undefined)?.[STATE_COOKIE];
    const state = single(req.query.state);
    res.clearCookie(STATE_COOKIE, { path: "/" });

    /**
     * Compared before anything is read from the request. A missing cookie is
     * the same answer as a wrong one — saying which would tell somebody
     * probing whether the flow had been started.
     */
    if (!expected || !state || expected !== state) {
      return redirect(res, "state");
    }

    const code = single(req.query.code);
    const installationId = Number(single(req.query.installation_id));
    if (!code || !Number.isInteger(installationId) || installationId <= 0) {
      return redirect(res, "incomplete");
    }

    let identity;
    try {
      identity = await github.identify(code);
    } catch {
      // An expired or reused code is something the learner can simply do again,
      // so it goes back as a message rather than a 500.
      return redirect(res, "code");
    }

    /**
     * `on conflict (user_id)` reconnects the same learner — changing GitHub
     * account, or reinstalling on a different repository, both land here and
     * are ordinary. `github_user_id` being taken by *another* learner is not,
     * and raises 23505 on the unique index instead.
     */
    try {
      await pool.query(
        `insert into github_connections (user_id, github_user_id, github_username, installation_id)
         values ($1, $2, $3, $4)
         on conflict (user_id) do update
           set github_user_id = excluded.github_user_id,
               github_username = excluded.github_username,
               installation_id = excluded.installation_id,
               connected_at = now()`,
        [user.id, identity.githubUserId, identity.login, installationId],
      );
    } catch (err) {
      if ((err as { code?: string }).code === "23505") return redirect(res, "taken");
      throw err;
    }

    return redirect(res, null);
  });

  /** What the learner has connected, for §5.14 stage 2 and §5.18's settings. */
  router.get("/github/connection", requireAuth, async (req, res) => {
    const user = sessionUser(req);

    const { rows } = await pool.query<{
      github_username: string;
      installation_id: string;
      connected_at: string;
    }>(
      `select github_username, installation_id, connected_at
         from github_connections where user_id = $1`,
      [user.id],
    );

    if (!rows[0]) {
      res.json({ connected: false, configured: github.configured, repositories: [] });
      return;
    }

    /**
     * The repositories the installation actually grants, read live rather than
     * stored. A learner can change the selection on GitHub at any time, and a
     * remembered list would offer a repository the platform can no longer read.
     *
     * A failure here is not a failed connection — it is one the platform cannot
     * see right now, which the screen says rather than pretending the account
     * is disconnected.
     */
    let repositories: { id: number; fullName: string; private: boolean }[] = [];
    let reachable = true;
    try {
      repositories = await github.installationRepositories(Number(rows[0].installation_id));
    } catch {
      reachable = false;
    }

    res.json({
      connected: true,
      configured: github.configured,
      login: rows[0].github_username,
      connectedAt: rows[0].connected_at,
      reachable,
      repositories,
    });
  });

  return router;
}

/**
 * Back to §5.14 with the outcome in the address.
 *
 * A reason rather than a message: the screen owns the wording (§9), and a
 * sentence in a query string would be one more place for copy to drift.
 */
function redirect(res: import("express").Response, problem: string | null): void {
  const url = new URL("/app/capstone", config.appOrigin);
  if (problem) url.searchParams.set("github", problem);
  else url.searchParams.set("github", "connected");
  res.redirect(url.toString());
}

/** Express gives `string | string[]`; a repeated parameter must not slip through. */
function single(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
