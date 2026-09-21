import type { Roadmap } from "../../features/roadmap/types";
import type { RoadmapNav as Nav } from "../../features/roadmap/useRoadmapNav";
import { RoadmapNav } from "./RoadmapNav";
import styles from "./RoadmapStacked.module.css";

/**
 * The `sm` view (design.md §11.3): "the same data reflows into a single column:
 * skill nodes stay on the main path, and each skill's modules stack beneath it
 * as indented nodes."
 *
 * It is the same nested list the chart carries for assistive technology, shown
 * rather than clipped — which is why the two views cannot disagree. Nothing is
 * duplicated and nothing is switched by the user: `useBreakpoint` picks it
 * because the *structure* differs, never because of a setting or a user agent
 * (§13.5).
 */
export interface RoadmapStackedProps {
  roadmap: Roadmap;
  nav: Nav;
}

export function RoadmapStacked({ roadmap, nav }: RoadmapStackedProps) {
  return (
    <div className={styles.column}>
      <RoadmapNav roadmap={roadmap} nav={nav} variant="stacked" />
    </div>
  );
}
