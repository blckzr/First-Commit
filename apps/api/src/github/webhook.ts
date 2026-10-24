import { createHmac, timingSafeEqual } from "node:crypto";
import { Router, type Request } from "express";
import type { Pool } from "pg";
import { config } from "../config.js";

/**
 * GitHub webhook deliveries (`project-proposal.md` §6.2, `database-schema.md` §7).
 *
 * §6.2: "Each push sends an event to the Express API's public address. The
 * worker also checks for new commits periodically, in case a delivery fails
 * while the API is waking from sleep." This is the first half; `commits.ts`
 * remains the second.
 *
 * ### It is built before it can be delivered to
 *
 * A public HTTPS address is what GitHub needs to *reach* this. It is not what
 * the endpoint needs to **exist and be proved**: the signature, the
 * deduplication and the push handling are all exercised here against supertest.
 * Deploying turns it on; it does not write it. (An earlier note in this repo
 * called the whole item blocked on deployment, which was wrong.)
 *
 * ### No session, so the signature is the whole of the authentication
 *
 * There is no cookie on a webhook and no `Origin` worth trusting, so §6.1's
 * session rules cannot apply. What stands in their place is an HMAC over the
 * **raw** body with a shared secret, compared in constant time. Everything this
 * endpoint goes on to write is derived from a payload that proved it came from
 * GitHub, and from nothing else in the request.
 *
 * ### Unconfigured means closed, not open
 *
 * Without `GITHUB_WEBHOOK_SECRET` every delivery is refused. The alternative —
 * accepting unsigned payloads when no secret is set — would make a missing
 * environment variable into an open door that writes commit history for any
 * project somebody can name.
 */

/** `github_events` keeps the raw delivery for idempotency and debugging (§6 rule 2: admin-only). */
interface PushPayload {
  repository?: { id?: number; full_name?: string };
  commits?: {
    id?: string;
    message?: string;
    timestamp?: string;
    author?: { username?: string };
  }[];
  head_commit?: { id?: string; message?: string; timestamp?: string } | null;
}

export function githubWebhookRoutes(pool: Pool, webhookSecret?: string | null): Router {
  const router = Router();

  router.post("/webhooks/github", async (req, res) => {
    // Injected so a test can cover both the configured and unconfigured cases,
    // the same way `workerSecret` is.
    const secret = webhookSecret === undefined ? config.githubWebhookSecret : webhookSecret;
    if (!secret) {
      // Closed rather than open. See the note above.
      res.status(503).json({ error: "Webhooks are not configured." });
      return;
    }

    const raw = (req as Request & { rawBody?: Buffer }).rawBody;
    const signature = header(req, "x-hub-signature-256");

    if (!raw || !signature || !isSigned(raw, signature, secret)) {
      // No detail: a precise reason tells somebody probing which half they got
      // right.
      res.status(401).json({ error: "Bad signature." });
      return;
    }

    const deliveryId = header(req, "x-github-delivery");
    const eventType = header(req, "x-github-event") ?? "unknown";
    if (!deliveryId) {
      res.status(400).json({ error: "Missing delivery id." });
      return;
    }

    /**
     * **The delivery is recorded before it is processed**, and `delivery_id` is
     * unique. GitHub retries a delivery it believes failed, so the same push
     * arrives more than once by design — the insert is what makes a retry
     * harmless rather than a second copy of the history.
     *
     * A conflict means we have seen it: answer 200 and stop. Answering an error
     * would make GitHub retry it again, forever.
     */
    try {
      await pool.query(
        `insert into github_events (delivery_id, event_type, payload)
         values ($1, $2, $3)`,
        [deliveryId, eventType, JSON.stringify(req.body ?? {})],
      );
    } catch (err) {
      /**
       * `delivery_id` is unique, so a duplicate raises 23505 — and that is the
       * signal, not an error.
       *
       * Deliberately **not** `on conflict do nothing … returning`: pg-mem
       * returns the existing row there where PostgreSQL returns none (AGENT.md
       * §4 records the quirk), so the check would read "new" under test and
       * "seen" in production — the divergence `packages/test-db` exists to stop.
       */
      if ((err as { code?: string }).code === "23505") {
        res.status(200).json({ status: "already seen" });
        return;
      }
      throw err;
    }

    try {
      if (eventType === "push") await handlePush(pool, req.body as PushPayload);

      await pool.query(`update github_events set processed_at = now() where delivery_id = $1`, [
        deliveryId,
      ]);
    } catch (err) {
      /**
       * The error is stored and the response is still 200.
       *
       * A 500 would have GitHub retry a delivery that will fail the same way
       * every time, and the retries eventually disable the webhook for the whole
       * App — for every learner, because of one project. The row keeps the
       * payload and the reason so it can be replayed by hand.
       */
      await pool.query(`update github_events set error = $2 where delivery_id = $1`, [
        deliveryId,
        (err as Error).message.slice(0, 500),
      ]);
    }

    res.status(200).json({ status: "ok" });
  });

  return router;
}

/**
 * Records the pushed commits against the project that owns the repository.
 *
 * Matched on **GitHub's numeric repository id** first. A learner can rename or
 * transfer a repository at any time and the name would stop matching; the id
 * does not change. The full name is a fallback for a project connected before
 * an id was stored.
 */
async function handlePush(pool: Pool, payload: PushPayload): Promise<void> {
  const repoId = payload.repository?.id;
  const fullName = payload.repository?.full_name;
  if (!repoId && !fullName) return;

  const project = await pool.query<{ id: string }>(
    `select id from capstone_projects
      where ($1::bigint is not null and repo_github_id = $1::bigint)
         or ($1::bigint is null and repo_full_name = $2)
      limit 1`,
    [repoId ?? null, fullName ?? null],
  );

  // A push from a repository no project claims. Not an error: the App may be
  // installed on repositories the learner never connected here.
  if (!project.rows[0]) return;

  const commits = payload.commits?.length
    ? payload.commits
    : payload.head_commit
      ? [payload.head_commit]
      : [];

  for (const commit of commits) {
    if (!commit?.id) continue;

    /**
     * `on conflict do nothing` for the same reason `commits.ts` has it: the
     * sync-on-read path and this one both see the same push, and the history
     * must not double. That is now a real collision rather than a hypothetical.
     */
    await pool.query(
      `insert into project_commits (project_id, sha, message, author_login, pushed_at)
       values ($1, $2, $3, $4, $5)
       on conflict (project_id, sha) do nothing`,
      [
        project.rows[0].id,
        commit.id,
        commit.message ?? "",
        (commit as { author?: { username?: string } }).author?.username ?? null,
        commit.timestamp ?? new Date().toISOString(),
      ],
    );
  }
}

/**
 * GitHub's `sha256=<hex>` over the raw body.
 *
 * `timingSafeEqual` rather than `===`: a byte-by-byte comparison that returns
 * early leaks, in its timing, how much of a guess was right — which is enough to
 * find a valid signature one character at a time. It throws on a length
 * mismatch, so the lengths are checked first.
 */
export function isSigned(body: Buffer, signature: string, secret: string): boolean {
  const expected = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;

  return timingSafeEqual(a, b);
}

function header(req: Request, name: string): string | null {
  const value = req.headers[name];
  return typeof value === "string" && value.length > 0 ? value : null;
}
