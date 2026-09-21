import { useParams } from "react-router";
import { Badge } from "../../components/core/Badge";
import { LinkButton } from "../../components/core/LinkButton";
import { ProgressBar } from "../../components/learning/ProgressBar";
import { RoadmapChart } from "../../components/roadmap/RoadmapChart";
import { RoadmapPanel } from "../../components/roadmap/RoadmapPanel";
import { RoadmapStacked } from "../../components/roadmap/RoadmapStacked";
import { useBreakpoint } from "../../hooks/useBreakpoint";
import { useRoadmap } from "../../features/roadmap/useRoadmap";
import { useRoadmapNav } from "../../features/roadmap/useRoadmapNav";
import { ApiError } from "../../api/client";
import type { Roadmap as RoadmapData } from "../../features/roadmap/types";
import styles from "./Roadmap.module.css";

/**
 * design.md §5.7 — the roadmap chart.
 *
 * `useBreakpoint` appears here and nowhere else on this screen: the chart and
 * the stacked list are different *structures*, which §13.5 names as the one
 * case a media query cannot cover. Everything else about the layout is CSS.
 */
export function Roadmap() {
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
      <div className={styles.empty}>
        <h1 className={styles.title}>
          {notFound ? "We couldn't find that roadmap" : "Your roadmap isn't available right now"}
        </h1>
        <p>
          {notFound
            ? "It may belong to another account, or it may have been archived."
            : "This is usually temporary. Your progress is safe — try again in a moment."}
        </p>
        <div className={styles.emptyActions}>
          <LinkButton to="/app/roadmaps" icon="arrow-right">
            See your roadmaps
          </LinkButton>
        </div>
      </div>
    );
  }

  return <RoadmapView roadmap={data} />;
}

/**
 * Split out so the nav hook is only created once there is a roadmap to walk.
 * Hooks cannot be called conditionally, and a hook over an absent roadmap would
 * need a fake empty one — which is exactly the sort of stand-in that ends up
 * rendering to a learner.
 */
function RoadmapView({ roadmap }: { roadmap: RoadmapData }) {
  const nav = useRoadmapNav(roadmap);
  const breakpoint = useBreakpoint();

  const percent =
    roadmap.totalCount === 0 ? 0 : (roadmap.passedCount / roadmap.totalCount) * 100;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.titleRow}>
          <div>
            <h1 className={styles.title}>{roadmap.careerPathTitle}</h1>
            {roadmap.trackTitle && <p className={styles.track}>{roadmap.trackTitle} track</p>}
          </div>
        </div>

        <ProgressBar
          value={percent}
          label={`${roadmap.passedCount} of ${roadmap.totalCount} passed`}
        />

        {/* §8: the legend spells out what each status looks like, in words. */}
        <ul className={styles.legend} aria-label="What the statuses mean">
          <li><Badge tone="verified" icon="check">Passed</Badge></li>
          <li><Badge tone="here" icon="circle-dot">You are here</Badge></li>
          <li><Badge tone="neutral" icon="circle">Available</Badge></li>
          <li><Badge tone="neutral" icon="lock">Locked</Badge></li>
        </ul>
      </header>

      <div className={styles.body}>
        <section className={styles.canvasArea} aria-label="Roadmap">
          {breakpoint === "sm" ? (
            <RoadmapStacked roadmap={roadmap} nav={nav} />
          ) : (
            <RoadmapChart roadmap={roadmap} nav={nav} />
          )}
        </section>

        {nav.selection && (
          <div className={styles.panelArea}>
            <RoadmapPanel roadmap={roadmap} selection={nav.selection} onClose={nav.close} />
          </div>
        )}
      </div>
    </div>
  );
}
