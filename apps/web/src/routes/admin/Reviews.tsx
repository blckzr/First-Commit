import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "../../components/core/Badge";
import { Button } from "../../components/core/Button";
import { Card } from "../../components/core/Card";
import { Icon } from "../../components/core/Icon";
import {
  adminIntegrityApi,
  integrityDetailKey,
  integrityKey,
  type Flag,
  type Ruling,
} from "../../api/adminIntegrity";
import { ApiError } from "../../api/client";
import styles from "./Reviews.module.css";

/**
 * design.md §6.6 — Project reviews.
 *
 * **A flag is a question, not a verdict**, and the screen has to read that way.
 * Every signal the platform raises has an innocent explanation: somebody who
 * builds offline for a week and pushes once has done the work, and looks
 * identical from here to somebody who pasted a finished repository. So the
 * evidence sits beside the learner's name and the conclusion does not.
 *
 * Nothing here has happened to the learner yet. Until an admin rules, the
 * milestone still passed and the Project Certificate still stands — and three
 * of the four outcomes leave it standing afterwards.
 *
 * **Rejecting is the exception, and it is labelled as one.** §6.6: "Rejecting a
 * project revokes its Project Certificate." The button says so, because an
 * admin should not discover that from the changelog.
 */

const TYPE_LABEL: Record<Flag["type"], string> = {
  single_commit: "Most work in one commit",
  similarity: "Similar to another project",
  weak_explanation: "Explanation answer is very short",
  other: "Flagged for review",
};

const RULINGS: { id: Ruling; label: string; note?: string }[] = [
  { id: "cleared", label: "Clear flag" },
  { id: "explanation_requested", label: "Request explanation" },
  { id: "redo_requested", label: "Request milestone redo" },
  { id: "rejected", label: "Reject project", note: "This revokes the Project Certificate." },
];

export function Reviews() {
  const [showAll, setShowAll] = useState(false);
  const [selectedId, setSelectedId] = useState<string>();

  const status = showAll ? null : "open";

  const { data, isPending, error } = useQuery({
    queryKey: [...integrityKey, status],
    queryFn: ({ signal }) => adminIntegrityApi.list(status, signal),
  });

  if (isPending) {
    return (
      <p role="status" aria-live="polite" className={styles.loading}>
        Loading flagged projects…
      </p>
    );
  }

  if (error || !data) {
    return (
      <p role="alert" className={styles.error}>
        {error instanceof ApiError ? error.message : "That did not load. Try again in a moment."}
      </p>
    );
  }

  const open = data.flags.filter((flag) => flag.status === "open");
  const selected = data.flags.find((flag) => flag.id === selectedId) ?? data.flags[0];

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Project reviews</h1>

        <div className={styles.tabs} role="group" aria-label="Which projects to show">
          <Button
            variant={showAll ? "secondary" : "primary"}
            onClick={() => setShowAll(false)}
            aria-pressed={!showAll}
          >
            Flagged ({open.length})
          </Button>
          <Button
            variant={showAll ? "primary" : "secondary"}
            onClick={() => setShowAll(true)}
            aria-pressed={showAll}
          >
            All flags
          </Button>
        </div>
      </header>

      {data.flags.length === 0 ? (
        <Card className={styles.empty}>
          <p className={styles.emptyText}>
            {showAll
              ? "No project has been flagged yet."
              : "Nothing is waiting for review. Flags appear here when a project finishes."}
          </p>
        </Card>
      ) : (
        <div className={styles.columns}>
          <nav aria-label="Flagged projects" className={styles.list}>
            <ul className={styles.flags}>
              {data.flags.map((flag) => (
                <li key={flag.id}>
                  <button
                    type="button"
                    className={[styles.flagRow, flag.id === selected?.id ? styles.selected : ""]
                      .filter(Boolean)
                      .join(" ")}
                    aria-current={flag.id === selected?.id ? "true" : undefined}
                    onClick={() => setSelectedId(flag.id)}
                  >
                    <span className={styles.flagHead}>
                      <Icon name="flag" aria-hidden className={styles.flagIcon} />
                      <span className={styles.learner}>{flag.learner.name}</span>
                      {/* §8: status is a word, not only a colour. */}
                      {flag.status !== "open" && <Badge tone="neutral">Decided</Badge>}
                    </span>
                    <span className={styles.brief}>{flag.project.briefTitle}</span>
                    <span className={styles.reason}>{TYPE_LABEL[flag.type]}</span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          {selected && <ReviewPanel key={selected.id} flag={selected} />}
        </div>
      )}
    </div>
  );
}

function ReviewPanel({ flag }: { flag: Flag }) {
  const client = useQueryClient();
  const [reason, setReason] = useState("");
  const [chosen, setChosen] = useState<Ruling>();

  const { data, isPending } = useQuery({
    queryKey: integrityDetailKey(flag.id),
    queryFn: ({ signal }) => adminIntegrityApi.detail(flag.id, signal),
  });

  const rule = useMutation({
    mutationFn: (status: Ruling) => adminIntegrityApi.rule(flag.id, status, reason),
    async onSuccess() {
      await client.invalidateQueries({ queryKey: integrityKey });
      await client.invalidateQueries({ queryKey: integrityDetailKey(flag.id) });
      setReason("");
      setChosen(undefined);
    },
  });

  return (
    <Card className={styles.panel}>
      <header className={styles.panelHead}>
        <h2 className={styles.panelTitle}>{flag.project.briefTitle}</h2>
        {flag.project.repoFullName && (
          <a
            className={styles.repoLink}
            href={`https://github.com/${flag.project.repoFullName}`}
            target="_blank"
            rel="noreferrer noopener"
          >
            <code className={styles.repo}>{flag.project.repoFullName}</code>
            <Icon name="external-link" aria-hidden />
            <span className={styles.visuallyHidden}>Opens GitHub in a new tab</span>
          </a>
        )}
      </header>

      <p className={styles.flagSummary}>
        <strong>Flag:</strong> {TYPE_LABEL[flag.type]}
        {describeDetails(flag)}
      </p>

      {flag.status !== "open" && (
        <Card className={styles.decided}>
          <p className={styles.decidedText}>
            Already decided: <strong>{flag.status.replace(/_/g, " ")}</strong>
            {flag.decisionReason ? ` — ${flag.decisionReason}` : ""}
          </p>
        </Card>
      )}

      {isPending ? (
        <p className={styles.loading}>Loading the project…</p>
      ) : (
        data && (
          <>
            <section aria-labelledby={`commits-${flag.id}`}>
              <h3 id={`commits-${flag.id}`} className={styles.sectionTitle}>
                Commit history ({data.commits.length})
              </h3>
              {data.commits.length === 0 ? (
                <p className={styles.hint}>No commits recorded.</p>
              ) : (
                <ul className={styles.commits}>
                  {data.commits.map((commit) => (
                    <li key={commit.sha} className={styles.commit}>
                      <code className={styles.repo}>{commit.sha.slice(0, 7)}</code>
                      <span className={styles.commitMessage}>
                        {commit.message.split("\n")[0]}
                      </span>
                      <time className={styles.hint} dateTime={commit.pushedAt}>
                        {new Date(commit.pushedAt).toLocaleDateString()}
                      </time>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {data.explanations.length > 0 && (
              <section aria-labelledby={`answers-${flag.id}`}>
                <h3 id={`answers-${flag.id}`} className={styles.sectionTitle}>
                  Explanation answers
                </h3>
                <dl className={styles.answers}>
                  {data.explanations.map((item) => (
                    <div key={item.title} className={styles.answer}>
                      <dt className={styles.question}>
                        {item.title}: {item.question}
                      </dt>
                      <dd className={styles.answerText}>
                        {item.answer ? (
                          `“${item.answer}”`
                        ) : (
                          /* Not answered is not a weak answer — nothing required one. */
                          <em className={styles.hint}>Not answered.</em>
                        )}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            )}
          </>
        )
      )}

      <section aria-labelledby={`decide-${flag.id}`} className={styles.decision}>
        <h3 id={`decide-${flag.id}`} className={styles.sectionTitle}>
          Decision
        </h3>

        <label className={styles.label} htmlFor={`reason-${flag.id}`}>
          Reason (required)
        </label>
        <textarea
          id={`reason-${flag.id}`}
          className={styles.textarea}
          rows={3}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />

        <div className={styles.rulings}>
          {RULINGS.map((ruling) => (
            <span key={ruling.id} className={styles.ruling}>
              <Button
                variant={ruling.id === "rejected" ? "destructive" : "secondary"}
                disabled={!reason.trim() || rule.isPending}
                onClick={() => {
                  setChosen(ruling.id);
                  rule.mutate(ruling.id);
                }}
              >
                {rule.isPending && chosen === ruling.id ? "Saving…" : ruling.label}
              </Button>
              {/*
                §6.6: rejecting revokes the Project Certificate. An admin should
                not have to discover that from the changelog.
              */}
              {ruling.note && <span className={styles.rulingNote}>{ruling.note}</span>}
            </span>
          ))}
        </div>

        {!reason.trim() && (
          <p className={styles.hint}>
            Every decision is recorded in the activity log with its reason.
          </p>
        )}

        {rule.error && (
          <p role="alert" className={styles.error}>
            {rule.error instanceof ApiError
              ? rule.error.message
              : "That did not save. Try again in a moment."}
          </p>
        )}
      </section>
    </Card>
  );
}

/** The numbers behind a flag, in a sentence rather than as raw JSON. */
function describeDetails(flag: Flag): string {
  const details = flag.details as { commits?: number; milestones?: number };

  if (flag.type === "single_commit" && details.commits !== undefined) {
    return ` — ${details.commits} commit${details.commits === 1 ? "" : "s"} across ${
      details.milestones ?? "?"
    } milestones.`;
  }
  return ".";
}
