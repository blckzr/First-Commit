import { Badge } from "../../components/core/Badge";
import { ProgressBar } from "../../components/learning/ProgressBar";
import { RoadmapChart } from "../../components/roadmap/RoadmapChart";
import { RoadmapPanel } from "../../components/roadmap/RoadmapPanel";
import { RoadmapStacked } from "../../components/roadmap/RoadmapStacked";
import { useBreakpoint } from "../../hooks/useBreakpoint";
import { mockRoadmap } from "../../features/roadmap/mock";
import { useRoadmapNav } from "../../features/roadmap/useRoadmapNav";
import styles from "./Roadmap.module.css";

/**
 * design.md §5.7 — the roadmap chart.
 *
 * **The roadmap is mock data.** `roadmap_generation` is a worker stub
 * (AGENT.md §7), so there is no roadmap to fetch yet. The screen is built
 * against the `Roadmap` type the API will return, so wiring it later is one
 * query, not a rewrite.
 *
 * `useBreakpoint` appears here and nowhere else on this screen: the chart and
 * the stacked list are different *structures*, which §13.5 names as the one
 * case a media query cannot cover. Everything else about the layout is CSS.
 */
export function Roadmap() {
  const roadmap = mockRoadmap;
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
            <p className={styles.track}>{roadmap.trackTitle} track</p>
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
