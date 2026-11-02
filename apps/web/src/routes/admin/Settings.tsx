import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "../../components/core/Badge";
import { Button } from "../../components/core/Button";
import { Card } from "../../components/core/Card";
import {
  adminSettingsApi,
  adminSettingsKeys,
  type LearningRule,
} from "../../api/adminSettings";
import { ApiError } from "../../api/client";
import styles from "./Settings.module.css";

/**
 * design.md §6.11 — Settings.
 *
 * §6.11's three sections, with the two that cannot be edited saying why rather
 * than offering a control that would be refused:
 *
 * - **AI.** The active prompt per component, its version, and the model that
 *   actually ran it — read-only. §6.11 asks for prompt editing; AGENT.md §7
 *   keeps prompt text in the worker's source and makes the worker **refuse to
 *   start** if a stored version's text differs. An edit box here would stop the
 *   worker, and the first symptom would be learners getting no feedback at all.
 * - **GitHub.** Whether an App is configured, and how deliveries went. No
 *   credential is read or shown; the App's id, secret and private key are
 *   environment configuration.
 * - **Learning rules.** The one section that writes. Each rule says **what
 *   reads it**, and a rule nothing reads yet says so on the page — §6.11's
 *   "shows what it affects", taken literally enough to be uncomfortable.
 *
 * Every change is recorded in the activity log, which §6.11 requires.
 */

const COMPONENTS: Record<string, string> = {
  code_feedback: "Code Review AI",
  roadmap_generation: "Roadmap AI",
  resume_generation: "Resume AI",
  milestone_review: "Milestone review",
  technology_recommendation: "Technology recommendation",
  roadmap_adaptation: "Roadmap adaptation",
};

const DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function Settings() {
  return (
    <div className={styles.page}>
      <header>
        <h1 className={styles.title}>Settings</h1>
        <p className={styles.lede}>
          How the platform is configured. Changing a setting says what it affects and is recorded
          in the activity log.
        </p>
      </header>

      <LearningRules />
      <AiSection />
      <GitHubSection />
    </div>
  );
}

function LearningRules() {
  const { data, isPending, error } = useQuery({
    queryKey: adminSettingsKeys.learning,
    queryFn: ({ signal }) => adminSettingsApi.learning(signal),
  });

  return (
    <section>
      <h2 className={styles.sectionTitle}>Learning rules</h2>

      {isPending ? (
        <p role="status" aria-live="polite" className={styles.hint}>
          Loading the rules…
        </p>
      ) : error ? (
        <p role="alert" className={styles.error}>
          {error instanceof ApiError
            ? error.message
            : "The rules did not load. Try again in a moment."}
        </p>
      ) : (
        <ul className={styles.ruleList}>
          {data.rules.map((rule) => (
            <li key={rule.key}>
              <Rule rule={rule} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Rule({ rule }: { rule: LearningRule }) {
  const client = useQueryClient();
  /**
   * `key` on the input rather than an effect syncing the prop into state. The
   * field resets when the saved value changes, which is both simpler and the
   * correct behaviour — an effect would overwrite what an admin was typing.
   */
  const [value, setValue] = useState(String(rule.value));

  const mutation = useMutation({
    mutationFn: () => adminSettingsApi.setRule(rule.key, Number(value)),
    onSuccess: (next) => {
      client.setQueryData(adminSettingsKeys.learning, next);
      void client.invalidateQueries({ queryKey: ["admin", "log"] });
    },
  });

  const unchanged = Number(value) === rule.value;

  return (
    <Card className={styles.rule}>
      <div className={styles.ruleHead}>
        <div>
          <h3 className={styles.ruleTitle}>{rule.label}</h3>
          {/* §6.11: "shows what it affects". */}
          <p className={styles.affects}>{rule.affects}</p>
        </div>
        {/*
          §8: status is icon + text + colour, never colour alone. A rule nothing
          enforces is not an error — it is a value the platform is storing and
          not yet using, which an admin has every right to know before setting
          it.
        */}
        <Badge tone={rule.enforced ? "verified" : "notice"}>
          {rule.enforced ? "In use" : "Stored, not used yet"}
        </Badge>
      </div>

      <form
        className={styles.ruleForm}
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate();
        }}
      >
        <div className={styles.ruleField}>
          <label className={styles.label} htmlFor={`rule-${rule.key}`}>
            {rule.unit === "percent" ? "Percent" : "Attempts"}
          </label>
          <input
            key={rule.value}
            id={`rule-${rule.key}`}
            type="number"
            inputMode="numeric"
            className={styles.number}
            min={rule.min}
            max={rule.max}
            step={1}
            defaultValue={rule.value}
            onChange={(event) => setValue(event.target.value)}
          />
        </div>
        <Button type="submit" disabled={unchanged || mutation.isPending}>
          {mutation.isPending ? "Saving…" : "Save"}
        </Button>
      </form>

      <p className={styles.hint}>
        {rule.stored && rule.updatedAt
          ? `Set on ${DATE.format(new Date(rule.updatedAt))}.`
          : `Not set — the platform is using its default of ${rule.value}.`}
      </p>

      {mutation.error && (
        <p role="alert" className={styles.error}>
          {mutation.error instanceof ApiError
            ? mutation.error.message
            : "That did not save. Try again in a moment."}
        </p>
      )}
      {mutation.isSuccess && !mutation.error && (
        <p role="status" aria-live="polite" className={styles.saved}>
          Saved. Recorded in the activity log.
        </p>
      )}
    </Card>
  );
}

function AiSection() {
  const { data, isPending, error } = useQuery({
    queryKey: adminSettingsKeys.ai,
    queryFn: ({ signal }) => adminSettingsApi.ai(signal),
  });

  return (
    <section>
      <h2 className={styles.sectionTitle}>AI</h2>

      {isPending ? (
        <p role="status" aria-live="polite" className={styles.hint}>
          Loading the AI settings…
        </p>
      ) : error ? (
        <p role="alert" className={styles.error}>
          {error instanceof ApiError
            ? error.message
            : "The AI settings did not load. Try again in a moment."}
        </p>
      ) : (
        <>
          <Card className={styles.readOnly}>
            <p className={styles.hint}>
              <strong>Prompts are read-only here.</strong> {data.editableReason}
            </p>
          </Card>

          {data.prompts.length === 0 ? (
            <Card className={styles.empty}>
              <p className={styles.hint}>
                No prompt is registered yet. The worker writes one for each component when it
                starts.
              </p>
            </Card>
          ) : (
            <ul className={styles.promptList}>
              {data.prompts.map((prompt) => (
                <li key={prompt.component}>
                  <Card className={styles.prompt}>
                    <div className={styles.promptHead}>
                      <h3 className={styles.ruleTitle}>
                        {COMPONENTS[prompt.component] ?? prompt.component}
                      </h3>
                      <span className={styles.version}>Version {prompt.versionNo}</span>
                    </div>
                    <p className={styles.affects}>
                      {/*
                        The model that ran, from `ai_jobs.model` — not an echo
                        of configuration. The API cannot see the worker's
                        environment, and reporting what it was told rather than
                        what it did is how a settings page starts lying.
                      */}
                      {prompt.model
                        ? `Last run on ${prompt.model} · ${prompt.runs} ${
                            prompt.runs === 1 ? "job" : "jobs"
                          }`
                        : "Nothing has run through this component yet, so there is no model to report."}
                    </p>
                    <details className={styles.details}>
                      <summary className={styles.summary}>Prompt text</summary>
                      <pre className={styles.promptText}>{prompt.content}</pre>
                    </details>
                  </Card>
                </li>
              ))}
            </ul>
          )}

          {/*
            §6.11 asks for two more things the API cannot do. Named, with the
            reason, rather than drawn as controls that would be refused.
          */}
          <Card className={styles.notBuilt}>
            <h3 className={styles.notBuiltTitle}>Not built</h3>
            <ul className={styles.plainList}>
              {data.notBuilt.map((item) => (
                <li key={item.what}>
                  <strong>{item.what}.</strong> {item.why}
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </section>
  );
}

function GitHubSection() {
  const { data, isPending, error } = useQuery({
    queryKey: adminSettingsKeys.github,
    queryFn: ({ signal }) => adminSettingsApi.github(signal),
  });

  return (
    <section>
      <h2 className={styles.sectionTitle}>GitHub</h2>

      {isPending ? (
        <p role="status" aria-live="polite" className={styles.hint}>
          Loading the GitHub status…
        </p>
      ) : error ? (
        <p role="alert" className={styles.error}>
          {error instanceof ApiError
            ? error.message
            : "The GitHub status did not load. Try again in a moment."}
        </p>
      ) : (
        <>
          <Card className={styles.github}>
            <div className={styles.ruleHead}>
              <div>
                <h3 className={styles.ruleTitle}>App connection</h3>
                <p className={styles.affects}>
                  {data.configured
                    ? "A real GitHub App is configured. Learners connect their own repositories."
                    : "No App is configured, so the development client is in use: it invents a consistent account and repository so the capstone flow works without one."}
                </p>
              </div>
              <Badge tone={data.configured ? "verified" : "notice"}>
                {data.configured ? "Configured" : "Development client"}
              </Badge>
            </div>
            <p className={styles.hint}>{data.editableReason}</p>
          </Card>

          <Card className={styles.github}>
            <h3 className={styles.ruleTitle}>Event delivery</h3>
            {data.byType.length === 0 ? (
              <p className={styles.hint}>
                No webhook deliveries yet. They appear here once a learner pushes to a connected
                repository.
              </p>
            ) : (
              <ul className={styles.plainList}>
                {data.byType.map((type) => (
                  <li key={type.eventType}>
                    <strong>{type.eventType}</strong> — {type.received} received,{" "}
                    {type.processed} processed
                    {type.failed > 0 ? `, ${type.failed} failed` : ""}
                  </li>
                ))}
              </ul>
            )}

            {data.recent.some((delivery) => delivery.error) && (
              <div className={styles.failures}>
                <h4 className={styles.notBuiltTitle}>Recent failures</h4>
                <ul className={styles.plainList}>
                  {data.recent
                    .filter((delivery) => delivery.error)
                    .map((delivery) => (
                      <li key={delivery.deliveryId}>
                        {delivery.eventType} on{" "}
                        {DATE.format(new Date(delivery.receivedAt))} —{" "}
                        <span className={styles.failureText}>{delivery.error}</span>
                      </li>
                    ))}
                </ul>
              </div>
            )}
          </Card>
        </>
      )}
    </section>
  );
}
