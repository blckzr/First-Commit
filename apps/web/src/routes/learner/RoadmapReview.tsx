import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Badge } from "../../components/core/Badge";
import { Button } from "../../components/core/Button";
import { Card } from "../../components/core/Card";
import { Input } from "../../components/forms/Input";
import { LinkButton } from "../../components/core/LinkButton";
import { AiPanel } from "../../components/learning/AiPanel";
import { useRoadmap, roadmapKey } from "../../features/roadmap/useRoadmap";
import { roadmapsApi } from "../../api/roadmaps";
import { ApiError } from "../../api/client";
import { sessionKey } from "../../features/auth/useSession";
import { isDone } from "../../features/roadmap/types";
import type { Roadmap, RoadmapModuleNode } from "../../features/roadmap/types";
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
 *
 * **Drawn from First Commit v2.dc.html**: a violet hero naming the plan, with
 * the ink "First up" card inside it — the same composition as Home — then the
 * AI panel, then one bar of actions. The chart is not on this page; "See the
 * chart" opens it, which is the prototype's answer to a review that used to be
 * a second copy of the roadmap screen.
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
  const firstUp = firstUpModule(roadmap);
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
      <section className={styles.hero} aria-labelledby="review-heading">
        <div className={styles.heroText}>
          <span className={styles.eyebrow}>Your roadmap</span>
          <h1 id="review-heading" className={styles.title}>
            {roadmap.trackTitle ? (
              <>
                {roadmap.careerPathTitle},<br />
                {/* §3.1: on this light wash the accent phrase is violet. */}
                <span className={styles.accent}>{roadmap.trackTitle}</span>
              </>
            ) : (
              roadmap.careerPathTitle
            )}
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
              <Badge tone="lime" icon="check">
                {roadmap.testedOutCount} tested out
              </Badge>
              <span>
                You proved {roadmap.testedOutCount} module
                {roadmap.testedOutCount === 1 ? "" : "s"} at placement, so {remaining} remain
                {remaining === 1 ? "s" : ""}.
              </span>
            </p>
          )}
        </div>

        {/* The one ink surface on the page goes to the thing to be worked on. */}
        {firstUp && (
          <Card surface="dark" padding="md" className={styles.firstUp}>
            <span className={styles.firstUpLabel}>First up</span>
            <span className={styles.firstUpTitle}>{firstUp.module.title}</span>
            <span className={styles.firstUpMeta}>
              {firstUp.skillTitle} · about {firstUp.module.estimatedHours} hour
              {firstUp.module.estimatedHours === 1 ? "" : "s"}
            </span>
          </Card>
        )}
      </section>

      {/* §7: AI output is labelled as AI, carries a reason, and is flaggable. */}
      {roadmap.aiRationale && (
        <AiPanel
          aiOutputId={roadmap.aiOutputId}
          flagged={roadmap.aiFlagged}
          className={styles.ai}
        >
          <p>{roadmap.aiRationale}</p>
        </AiPanel>
      )}

      <Card surface="white" radius="panel" padding="none" className={styles.actions}>
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

        <div className={styles.go}>
          <LinkButton variant="ghost" to={`/app/roadmap/${roadmap.id}`}>
            See the chart
          </LinkButton>
          <Button variant="primary" icon="arrow-right" onClick={() => void startLearning()}>
            Start learning
          </Button>
        </div>
      </Card>
    </>
  );
}

/**
 * The module the learner will open first: the one they are on, else the first
 * they can start. Placement may already have cleared the opening modules, which
 * is exactly why this is worth showing — "First up" is often not the first row.
 */
function firstUpModule(
  roadmap: Roadmap,
): { module: RoadmapModuleNode; skillTitle: string } | null {
  const candidates = roadmap.steps.flatMap((step) =>
    step.type === "skill" ? step.modules.map((module) => ({ module, skillTitle: step.title })) : [],
  );
  return (
    candidates.find((c) => c.module.status === "current") ??
    candidates.find((c) => c.module.status === "available") ??
    candidates.find((c) => !isDone(c.module.status) && c.module.status !== "archived") ??
    null
  );
}
