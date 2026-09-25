import { useState } from "react";
import { Badge } from "../../components/core/Badge";
import { Button } from "../../components/core/Button";
import { Card } from "../../components/core/Card";
import { LinkButton } from "../../components/core/LinkButton";
import { ProgressBar } from "../../components/learning/ProgressBar";
import { useRoadmaps, useSetRoadmapStatus } from "../../features/roadmap/useRoadmap";
import type { RoadmapSummary } from "../../api/roadmaps";
import styles from "./Roadmaps.module.css";

/**
 * design.md §5.12 — My roadmaps.
 *
 * **Progress is per learner, not per roadmap** (AGENT.md §6 rule 7). A module
 * passed once is passed on every roadmap that contains it, which is why a card
 * can say "6 of 16 passed (3 shared)": the shared ones were not earned twice,
 * they carried over. Saying so is the whole reason the count is on this screen
 * rather than only inside a roadmap.
 *
 * §5.12 also offers "Create roadmap". It is not here yet — creating one means
 * running the survey and target steps outside the onboarding guard, which does
 * not exist. A dead button would be worse than none; recorded in
 * docs/task-tracker.md.
 */
export function Roadmaps() {
  const { data, isPending, error } = useRoadmaps();
  const [showArchived, setShowArchived] = useState(false);

  if (isPending) {
    return (
      <p role="status" aria-live="polite" className={styles.loading}>
        Loading your roadmaps…
      </p>
    );
  }

  if (error || !data) {
    return (
      <Card surface="white" radius="panel" padding="lg" className={styles.empty}>
        <h1 className={styles.title}>Your roadmaps aren't available right now</h1>
        <p className={styles.lede}>
          This is usually temporary. Your progress is safe — try again in a moment.
        </p>
      </Card>
    );
  }

  const active = data.filter((r) => r.status !== "archived");
  const archived = data.filter((r) => r.status === "archived");

  return (
    <div className={styles.page}>
      <Card surface="white" radius="panel" padding="lg" className={styles.header}>
        <h1 className={styles.title}>My roadmaps</h1>
        <p className={styles.lede}>
          Everything you pass counts on every roadmap that contains it.
        </p>
      </Card>

      {active.length === 0 ? (
        /* §9: an empty state says what to do, not "Nothing here". */
        <Card surface="white" radius="panel" padding="lg" className={styles.empty}>
          <h2 className={styles.emptyTitle}>You have no active roadmaps</h2>
          <p className={styles.lede}>
            {archived.length > 0
              ? "Restore an archived one below to pick it back up."
              : "Choose a target job to build your first roadmap."}
          </p>
        </Card>
      ) : (
        <ul className={styles.list}>
          {active.map((roadmap) => (
            <li key={roadmap.id}>
              <RoadmapCard roadmap={roadmap} />
            </li>
          ))}
        </ul>
      )}

      {/* §5.12: "hidden entirely when there are no archived roadmaps". */}
      {archived.length > 0 && (
        <section className={styles.archived}>
          <div className={styles.archivedHead}>
            <h2 className={styles.archivedTitle}>Archived ({archived.length})</h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowArchived((open) => !open)}
              aria-expanded={showArchived}
              aria-controls="archived-roadmaps"
            >
              {showArchived ? "Hide" : "Show"}
            </Button>
          </div>
          {showArchived && (
            <ul id="archived-roadmaps" className={styles.list}>
              {archived.map((roadmap) => (
                <li key={roadmap.id}>
                  <RoadmapCard roadmap={roadmap} />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

function RoadmapCard({ roadmap }: { roadmap: RoadmapSummary }) {
  const setStatus = useSetRoadmapStatus();
  const archived = roadmap.status === "archived";
  const percent = roadmap.totalCount === 0 ? 0 : (roadmap.passedCount / roadmap.totalCount) * 100;

  const name = [roadmap.careerPathTitle, roadmap.trackTitle].filter(Boolean).join(", ");
  const progress =
    `${roadmap.passedCount} of ${roadmap.totalCount} modules passed` +
    (roadmap.sharedCount > 0 ? ` (${roadmap.sharedCount} shared)` : "");

  return (
    <Card surface="white" radius="card" padding="lg" className={styles.card}>
      <div className={styles.cardHead}>
        <h3 className={styles.cardTitle}>{name}</h3>
        {/* §8: status is icon + text + colour, never colour alone. */}
        <Badge tone={archived ? "neutral" : "verified"} icon={archived ? "circle" : "check"}>
          {archived ? "Archived" : "Active"}
        </Badge>
      </div>

      {/* §7: a progress bar is always paired with text, which is its label. */}
      <ProgressBar value={percent} label={progress} />

      <div className={styles.cardFoot}>
        <p className={styles.studied}>{lastStudied(roadmap.lastStudiedAt)}</p>
        <div className={styles.cardActions}>
          {archived ? (
            <Button
              variant="secondary"
              onClick={() => setStatus.mutate({ id: roadmap.id, status: "active" })}
              disabled={setStatus.isPending}
            >
              Restore roadmap
            </Button>
          ) : (
            <>
              <Button
                variant="ghost"
                onClick={() => setStatus.mutate({ id: roadmap.id, status: "archived" })}
                disabled={setStatus.isPending}
              >
                Archive
              </Button>
              <LinkButton to={`/app/roadmap/${roadmap.id}`}>Open roadmap</LinkButton>
            </>
          )}
        </div>
      </div>

      {setStatus.isError && (
        <p role="alert" className={styles.error}>
          That didn&apos;t save. Check your connection and try again.
        </p>
      )}
    </Card>
  );
}

/**
 * §5.12's "Last studied today" / "Last studied 5 days ago".
 *
 * Whole days, because "3 hours ago" on a learning platform invites a precision
 * nobody needs — the question the line answers is "how long since I looked at
 * this?", not "when exactly".
 */
function lastStudied(at: string | null): string {
  if (!at) return "Not started yet";

  const days = Math.floor((Date.now() - new Date(at).getTime()) / 86_400_000);
  if (days <= 0) return "Last studied today";
  if (days === 1) return "Last studied yesterday";
  if (days < 30) return `Last studied ${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? "Last studied a month ago" : `Last studied ${months} months ago`;
}
