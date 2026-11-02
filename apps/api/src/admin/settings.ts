import { Router } from "express";
import { z } from "zod";
import type { Pool } from "pg";
import { HttpError } from "../middleware/errors.js";
import { requireAdmin, requireAuth, sessionUser } from "../middleware/session.js";
import { logAdminAction } from "./log.js";
import type { GitHubClient } from "../github/index.js";

/**
 * Platform settings (design.md §6.11).
 *
 * §6.11 asks for three sections. **Two of them are read-only here, and that is a
 * decision rather than an omission:**
 *
 * ### AI — shown, not edited
 *
 * §6.11 says "edit the prompts for each AI component". AGENT.md §7 says prompt
 * text lives in the worker's source, is versioned in `ai_prompts`, and **the
 * worker refuses to start if a stored version's text differs from the code's**.
 * Those cannot both hold: an admin editing a prompt through this screen would
 * stop the worker on its next boot, and the first symptom would be learners
 * getting no feedback at all. So this reads the active prompt, its version and
 * the model that actually ran, and §6.11 now says view rather than edit. The
 * alternative — making the database authoritative and dropping the worker's
 * check — inverts a deliberate safety check so a typo in a text box can reach
 * the model.
 *
 * **The model comes from `ai_jobs.model`, not from configuration.** The API
 * cannot see the worker's `.env`, and an echo of a config value would say what
 * the platform was *told* rather than what it did. The jobs table records what
 * each run used, so this reports the model that produced the most recent
 * answer per component — which is also the only version of this figure that
 * stays true after someone changes the worker's environment and forgets.
 *
 * §6.11's "set context limits" and "test a prompt against sample input" are
 * **not built**, and the screen says so. Both belong to the worker: the context
 * window is its configuration (`model-setup-guide.md` §7), and testing a prompt
 * needs an Ollama call the API cannot make — the worker owns the model and only
 * ever dials out, which is the whole shape of the architecture. `npm run
 * try:feedback` and `npm run try:roadmap` are where a prompt is tried today.
 *
 * ### GitHub — status, never credentials
 *
 * Whether a real App is configured, and how recent deliveries went. **No
 * secret is read, returned, or logged**: AGENT.md's secrets rule, and a screen
 * that displayed a private key would put it in a browser cache. "Manage the
 * connection" is therefore environment configuration on Render, not a form.
 *
 * ### Learning rules — the one section that writes
 *
 * `platform_settings` is a key/value table and nothing in the repo read it
 * before this file. A settings screen whose knobs control nothing is worse than
 * no screen, so each rule declares **what reads it**, and the screen shows that
 * — `enforced: false` says, on the page, that storing the value is all that
 * happens today. `passing_score_default` is genuinely read: the quiz editor
 * starts a new quiz at it.
 *
 * Every change is logged (§6.11: "recorded in the activity log"), with the old
 * and the new value in the details, because "changed the passing score" without
 * the previous value is not a record of anything.
 */

/**
 * The settings this platform has.
 *
 * **A closed list, not free-form keys.** `platform_settings` has a `text`
 * primary key, so without this an admin screen could write `passing_score`
 * beside `passing_score_default` and neither would be wrong — the table would
 * hold two plausible settings and the reader would use one of them. A key not
 * named here is refused.
 *
 * `affects` is §6.11's "shows what it affects", and it is the field that keeps
 * the screen honest: it names the code that reads the value, so a rule nothing
 * reads cannot be described as if it did.
 */
const RULES = {
  passing_score_default: {
    label: "Pass mark for a new quiz",
    affects: "The score a new quiz starts at in the module editor (§6.3).",
    /**
     * Read by `GET /admin/modules/:id/versions/:versionId/quiz`, which hands it
     * to the editor when a version has no quiz yet.
     *
     * **It does not move an existing quiz's pass mark.** Each quiz stores its
     * own `assessments.passing_score`, and §6 rule 6 means a learner's attempt
     * was graded against the quiz as it stood. Re-grading history from a
     * settings page is the exact thing rule 6 forbids.
     */
    enforced: true,
    min: 1,
    max: 100,
    unit: "percent",
    fallback: 70,
  },
  reinforcement_after_attempts: {
    label: "Failed attempts before a reinforcement module is added",
    affects:
      "Nothing yet. Reinforcement modules are on the roadmap type and in the seed data, but no code adds one.",
    enforced: false,
    min: 1,
    max: 10,
    unit: "attempts",
    fallback: 2,
  },
  challenge_above_score: {
    label: "Score above which a challenge module is offered",
    affects: "Nothing yet. No code offers a challenge module.",
    enforced: false,
    min: 1,
    max: 100,
    unit: "percent",
    fallback: 90,
  },
} as const;

type RuleKey = keyof typeof RULES;

const isRuleKey = (value: string): value is RuleKey => value in RULES;

/**
 * The pass mark a new quiz starts at.
 *
 * Exported because this is what makes `passing_score_default` a setting rather
 * than a stored number: the quiz editor's response calls it. A missing or
 * unreadable row falls back to the declared default rather than failing the
 * request — an admin opening the module editor should not meet an error because
 * nobody has ever visited the settings screen.
 */
export async function defaultPassingScore(pool: Pool): Promise<number> {
  const { rows } = await pool.query<{ value: unknown }>(
    `select value from platform_settings where key = 'passing_score_default'`,
  );
  const parsed = z.number().int().min(1).max(100).safeParse(rows[0]?.value);
  return parsed.success ? parsed.data : RULES.passing_score_default.fallback;
}

const RuleBody = z
  .object({ value: z.number().int("Enter a whole number.") })
  .strict();

export function adminSettingsRoutes(pool: Pool, github: GitHubClient): Router {
  const router = Router();

  /**
   * §6.11's AI section, read-only.
   *
   * The prompt text is returned in full. §6 rule 2 keeps prompts out of a
   * *learner* response; this is an admin route, and judging a prompt means
   * reading all of it — the same reasoning that lets §6.8's flag screen show a
   * rubric.
   */
  router.get("/admin/settings/ai", requireAuth, requireAdmin, async (_req, res) => {
    const prompts = await pool.query<{
      component: string;
      version_no: number;
      content: string;
      created_at: Date;
    }>(
      `select component::text as component, version_no, content, created_at
         from ai_prompts
        where is_active
        order by component`,
    );

    /*
     * The model each component last actually ran on.
     *
     * Grouped in SQL and reduced in TypeScript rather than with a window
     * function: `distinct on` and `row_number() over` are both more than pg-mem
     * parses, and an aggregate this small is not worth a query the tests cannot
     * run. One row per (type, model) comes back, not one per job.
     */
    const runs = await pool.query<{
      type: string;
      model: string | null;
      n: string;
      last: Date | null;
    }>(
      `select type::text as type, model, count(*) as n, max(completed_at) as last
         from ai_jobs
        where status = 'completed' and model is not null
        group by type, model`,
    );

    const latest = new Map<string, { model: string; at: Date | null; runs: number }>();
    for (const row of runs.rows) {
      const current = latest.get(row.type);
      const at = row.last;
      if (!current || (at && current.at && at > current.at) || (at && !current.at)) {
        latest.set(row.type, { model: row.model!, at, runs: Number(row.n) });
      }
    }

    res.json({
      prompts: prompts.rows.map((row) => ({
        component: row.component,
        versionNo: row.version_no,
        content: row.content,
        createdAt: row.created_at,
        model: latest.get(row.component)?.model ?? null,
        lastRunAt: latest.get(row.component)?.at ?? null,
        runs: latest.get(row.component)?.runs ?? 0,
      })),
      /**
       * Why the text is not editable here, in the response rather than only in
       * the screen's copy — so the reason travels with the data and a second
       * client cannot offer an edit box the API would have to refuse.
       */
      editable: false,
      editableReason:
        "Prompt text lives in the worker's source and is registered in ai_prompts on start. The worker refuses to start if a stored version's text differs from the code's, so editing a prompt here would stop it.",
      /** §6.11 asks for these two; neither is something the API can do. */
      notBuilt: [
        {
          what: "Context limits",
          why: "The context window is the worker's own configuration (model-setup-guide.md §7). The API cannot read or set the worker's environment.",
        },
        {
          what: "Test a prompt against sample input",
          why: "Running a prompt needs Ollama, which only the worker can reach. npm run try:feedback and npm run try:roadmap do this today.",
        },
      ],
    });
  });

  /**
   * §6.11's GitHub section: whether an App is configured, and how deliveries
   * are going.
   *
   * **No credential is read here.** `configured` is a boolean the client
   * already exposes, and the counts come from `github_events`, which stores
   * deliveries. The payloads are not returned: §6 rule 2 lists GitHub events
   * among the things that stay admin-side, and a webhook payload is large and
   * full of a learner's repository detail that nothing on this screen needs.
   */
  router.get("/admin/settings/github", requireAuth, requireAdmin, async (_req, res) => {
    const events = await pool.query<{
      event_type: string;
      n: string;
      processed: string;
      failed: string;
      last: Date | null;
    }>(
      `select event_type,
              count(*) as n,
              count(case when processed_at is not null then 1 end) as processed,
              count(case when error is not null then 1 end) as failed,
              max(received_at) as last
         from github_events
        group by event_type
        order by event_type`,
    );

    /*
     * `count(case when ... then 1 end)`, not `count(*) filter (where ...)`.
     * pg-mem **silently ignores** the `filter` clause and returns the unfiltered
     * count, so "12 of 12 processed" would have been the test's answer for 12
     * deliveries of which 3 failed. A wrong number no test disagrees with.
     */

    const recent = await pool.query<{
      delivery_id: string;
      event_type: string;
      received_at: Date;
      processed_at: Date | null;
      error: string | null;
    }>(
      `select delivery_id, event_type, received_at, processed_at, error
         from github_events
        order by received_at desc
        limit 20`,
    );

    res.json({
      /** False means the development client, which invents a consistent account. */
      configured: github.configured,
      implementation: github.name,
      byType: events.rows.map((row) => ({
        eventType: row.event_type,
        received: Number(row.n),
        processed: Number(row.processed),
        failed: Number(row.failed),
        lastReceivedAt: row.last,
      })),
      recent: recent.rows.map((row) => ({
        deliveryId: row.delivery_id,
        eventType: row.event_type,
        receivedAt: row.received_at,
        processedAt: row.processed_at,
        /**
         * The stored error text. It comes from the API's own handler, not from
         * a learner or from GitHub, so it is safe to show an admin — and it is
         * the only thing that makes a failed delivery actionable.
         */
        error: row.error,
      })),
      editable: false,
      editableReason:
        "The App's id, client secret and private key are environment configuration on Render. They are never read or shown here.",
    });
  });

  /** §6.11's learning rules, each with what reads it. */
  router.get("/admin/settings/learning", requireAuth, requireAdmin, async (_req, res) => {
    res.json({ rules: await readRules(pool) });
  });

  /**
   * Change one rule.
   *
   * **The write and its log entry are one transaction** (§6.11: "recorded in
   * the activity log"). The log carries the previous value as well as the new
   * one — "changed the pass mark" alone is not a record of a change.
   *
   * `on conflict (key)` is an upsert because the row may never have existed:
   * `platform_settings` starts empty and a rule's declared fallback is what
   * applies until someone sets it.
   */
  router.put("/admin/settings/learning/:key", requireAuth, requireAdmin, async (req, res) => {
    const admin = sessionUser(req);
    const key = typeof req.params.key === "string" ? req.params.key : "";
    if (!isRuleKey(key)) throw new HttpError(404, "Not found");
    const rule = RULES[key];

    const parsed = RuleBody.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, parsed.error.issues[0]?.message ?? "Enter a number.");
    }
    const { value } = parsed.data;
    if (value < rule.min || value > rule.max) {
      throw new HttpError(
        400,
        `Enter ${rule.label.toLowerCase()} as a number between ${rule.min} and ${rule.max}.`,
      );
    }

    const client = await pool.connect();
    try {
      await client.query("begin");

      const before = await client.query<{ value: unknown }>(
        `select value from platform_settings where key = $1`,
        [key],
      );
      const previous = before.rows[0]?.value ?? null;

      /*
       * Written as a delete-then-insert rather than `on conflict`, because
       * pg-mem will not match `on conflict` against a table-level constraint
       * and returns the existing row where PostgreSQL returns none — the
       * documented divergence in packages/test-db. Both statements are in the
       * transaction, so there is no window where the setting is absent.
       */
      await client.query(`delete from platform_settings where key = $1`, [key]);
      await client.query(
        `insert into platform_settings (key, value, updated_by, updated_at)
         values ($1, $2::jsonb, $3, now())`,
        [key, JSON.stringify(value), admin.id],
      );

      await logAdminAction(client, {
        adminId: admin.id,
        action: "setting.changed",
        targetType: "platform_setting",
        /**
         * Null, because a setting is keyed by text and `target_id` is a uuid.
         * The key travels in the details, and `activity.ts` reads it from
         * there for this target type rather than trying to resolve a label.
         */
        targetId: null,
        reason: null,
        details: { key, from: previous, to: value, enforced: rule.enforced },
      });

      await client.query("commit");
    } catch (err) {
      await client.query("rollback").catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    res.json({ rules: await readRules(pool) });
  });

  return router;
}

/**
 * Every rule with its stored value, or its fallback where none is stored.
 *
 * `stored` is kept separate from `value` so the screen can say "the default"
 * rather than showing a number nobody chose as though someone had.
 */
async function readRules(pool: Pool) {
  const { rows } = await pool.query<{ key: string; value: unknown; updated_at: Date }>(
    `select key, value, updated_at from platform_settings`,
  );
  const stored = new Map(rows.map((row) => [row.key, row]));

  return (Object.keys(RULES) as RuleKey[]).map((key) => {
    const rule = RULES[key];
    const row = stored.get(key);
    const parsed = z.number().int().min(rule.min).max(rule.max).safeParse(row?.value);

    return {
      key,
      label: rule.label,
      /** §6.11: "shows what it affects". */
      affects: rule.affects,
      /** False says, on the screen, that storing the value is all that happens. */
      enforced: rule.enforced,
      min: rule.min,
      max: rule.max,
      unit: rule.unit,
      value: parsed.success ? parsed.data : rule.fallback,
      stored: parsed.success,
      updatedAt: parsed.success ? (row?.updated_at ?? null) : null,
    };
  });
}
