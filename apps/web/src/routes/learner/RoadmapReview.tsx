import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Badge } from "../../components/core/Badge";
import { Button } from "../../components/core/Button";
import { Card } from "../../components/core/Card";
import { Input } from "../../components/forms/Input";
import { LinkButton } from "../../components/core/LinkButton";
import { RoadmapChart } from "../../components/roadmap/RoadmapChart";
import { RoadmapStacked } from "../../components/roadmap/RoadmapStacked";
import { useBreakpoint } from "../../hooks/useBreakpoint";
import { useRoadmap, roadmapKey } from "../../features/roadmap/useRoadmap";
import { useRoadmapNav } from "../../features/roadmap/useRoadmapNav";
import { roadmapsApi } from "../../api/roadmaps";
import { ApiError } from "../../api/client";
import { sessionKey } from "../../features/auth/useSession";
import type { Roadmap } from "../../features/roadmap/types";
import styles from "./RoadmapReview.module.css";

/**
 * design.md §5.5 — the roadmap review.
 *
 * Where onboarding ends. The learner sees the plan the Roadmap AI made, the
 * reason it gives, what placement already cleared, and how long it is likely
 * to take — then starts.
 *
 * **The AI's explanation reaches a learner here for the first time.** It has
 * been written to `roadmaps.ai_rationale` on every generation since the worker
 * was built and nothing has ever shown it. §7: it is labelled as AI, carries
 * its reason, and is flaggable.
 */
export function RoadmapReview() {
  const { id } = useParams();
  const { data, isPending, error } = useRoadmap(id);

  if (isPending) {
    return (
      <p role="status" aria-live="polite" className={styles.loading}>
        Loading your roadmap…
      </p>
    );
  }

  if (error || !data) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <Card surface="white" radius="panel" padding="lg" className={styles.empty}>
        <h1 className={styles.title}>
          {notFound ? "We couldn't find that roadmap" : "Your roadmap isn't available right now"}
        </h1>
        <p className={styles.lede}>
          {notFound
            ? "It may belong to another account, or it may have been archived."
            : "This is usually temporary. Your progress is safe — try again in a moment."}
        </p>
        <LinkButton to="/app" icon="arrow-right">Go to your roadmap</LinkButton>
      </Card>
    );
  }

  return <ReviewView roadmap={data} />;
}

function ReviewView({ roadmap }: { roadmap: Roadmap }) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const nav = useRoadmapNav(roadmap);
  const breakpoint = useBreakpoint();

  const [hours, setHours] = useState(String(roadmap.weeklyHours ?? ""));
  const [editing, setEditing] = useState(false);
  const [invalid, setInvalid] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (weeklyHours: number) => roadmapsApi.setWeeklyHours(roadmap.id, weeklyHours),
    async onSuccess() {
      setEditing(false);
      await client.invalidateQueries({ queryKey: roadmapKey(roadmap.id) });
    },
  });

  const remaining = roadmap.totalCount - roadmap.passedCount;
  const saveError = save.error instanceof ApiError ? save.error : null;

  function submitHours() {
    const value = Number(hours);
    // §9 gives this sentence; the API gives the same one, so a learner who
    // meets the limit twice reads it the same way both times.
    if (!Number.isInteger(value) || value < 1 || value > 40) {
      setInvalid("Enter weekly hours as a number between 1 and 40.");
      return;
    }
    setInvalid(null);
    save.mutate(value);
  }

  /** Leaving the review is the moment onboarding is actually over. */
  async function startLearning() {
    // The session's `next` points here until a module is opened; refreshing it
    // after leaving keeps the guards from sending the learner back.
    await client.invalidateQueries({ queryKey: sessionKey });
    void navigate("/app");
  }

  return (
    <>
      <Card as="header" surface="white" radius="panel" padding="lg" className={styles.header}>
        <span className={styles.eyebrow}>Your roadmap</span>
        <h1 className={styles.title}>
          {roadmap.careerPathTitle}
          {roadmap.trackTitle ? `, ${roadmap.trackTitle}` : ""}
        </h1>

        {/* §5.5: "16 modules, about 14 weeks at 6 hours a week". */}
        <p className={styles.summary}>
          {roadmap.totalCount} module{roadmap.totalCount === 1 ? "" : "s"}
          {roadmap.estimatedWeeks !== null && roadmap.weeklyHours !== null && (
            <>
              , about {roadmap.estimatedWeeks} week{roadmap.estimatedWeeks === 1 ? "" : "s"} at{" "}
              {roadmap.weeklyHours} hour{roadmap.weeklyHours === 1 ? "" : "s"} a week
            </>
          )}
        </p>

        {/* What placement bought, said plainly. */}
        {roadmap.testedOutCount > 0 && (
          <p className={styles.cleared}>
            <Badge tone="verified" icon="check">
              {roadmap.testedOutCount} tested out
            </Badge>
            <span>
              You proved {roadmap.testedOutCount} module
              {roadmap.testedOutCount === 1 ? "" : "s"} at placement, so {remaining} remain
              {remaining === 1 ? "s" : ""}.
            </span>
          </p>
        )}
      </Card>

      {/* §7: AI output is labelled as AI, carries a reason, and is flaggable. */}
      {roadmap.aiRationale && (
        <Card surface="soft" radius="card" padding="md" className={styles.ai}>
          <span className={styles.aiLabel}>AI</span>
          <p className={styles.aiText}>{roadmap.aiRationale}</p>
          <button type="button" className={styles.aiFlag} disabled title="Not built yet">
            Is this wrong?
          </button>
        </Card>
      )}

      <section className={styles.chart} aria-label="Your roadmap">
        {breakpoint === "sm" ? (
          <RoadmapStacked roadmap={roadmap} nav={nav} />
        ) : (
          <RoadmapChart roadmap={roadmap} nav={nav} />
        )}
      </section>

      <Card surface="white" radius="panel" padding="lg" className={styles.actions}>
        {editing ? (
          <form
            className={styles.hours}
            onSubmit={(e) => {
              e.preventDefault();
              submitHours();
            }}
          >
            <Input
              label="Hours a week you can study"
              type="number"
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              error={invalid ?? saveError?.message ?? undefined}
              inputMode="numeric"
            />
            <div className={styles.hoursActions}>
              <Button variant="ghost" type="button" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="outline" loading={save.isPending} loadingLabel="Saving…">
                Save hours
              </Button>
            </div>
          </form>
        ) : (
          <Button variant="outline" onClick={() => setEditing(true)}>
            Adjust weekly hours
          </Button>
        )}

        <Button variant="primary" icon="arrow-right" onClick={() => void startLearning()}>
          Start learning
        </Button>
      </Card>
    </>
  );
}
