import { useEffect, useRef } from "react";
import { Badge } from "../core/Badge";
import { Icon } from "../core/Icon";
import { nodeLabel, skillProgress } from "../../features/roadmap/labels";
import { milestoneStatus, moduleStatus, KIND_LABEL } from "../../features/roadmap/status";
import { assertNever, type Roadmap, type RoadmapStep } from "../../features/roadmap/types";
import type { RoadmapNav as Nav } from "../../features/roadmap/useRoadmapNav";
import styles from "./RoadmapNav.module.css";

/**
 * **The roadmap's real structure**: a nested list of skills containing modules
 * (design.md §12), with arrow-key movement and Enter to open the side panel.
 *
 * It is rendered in both views, which is the point. On `sm` it *is* the view —
 * `RoadmapStacked`. On `md` and `lg` it sits inside the chart region, clipped
 * to a pixel rather than hidden, and the chart node matching `focusedId` draws
 * the focus ring. So a keyboard user and a mouse user move through one
 * structure, and there is no second DOM that can fall out of step with the
 * first.
 *
 * Only one node is in the tab order at a time (roving tabindex), so Tab leaves
 * the roadmap instead of walking 25 nodes.
 */
export interface RoadmapNavProps {
  roadmap: Roadmap;
  nav: Nav;
  /** `stacked` is the visible sm view; `assistive` is clipped beside the chart. */
  variant: "stacked" | "assistive";
}

export function RoadmapNav({ roadmap, nav, variant }: RoadmapNavProps) {
  const refs = useRef(new Map<string, HTMLButtonElement>());

  /**
   * The hook decides where focus should go — arrow keys, or the panel handing
   * it back on close — and this moves it. Only the rendered view reacts, so on
   * `md` the assistive list moves and the stacked list is not even mounted.
   */
  const request = nav.focusRequest;
  useEffect(() => {
    if (request) refs.current.get(request.id)?.focus();
  }, [request]);

  function nodeProps(id: string) {
    return {
      ref: (el: HTMLButtonElement | null) => {
        if (el) refs.current.set(id, el);
        else refs.current.delete(id);
      },
      type: "button" as const,
      tabIndex: nav.focusedId === id ? 0 : -1,
      "aria-current": nav.selectedId === id ? ("true" as const) : undefined,
      onKeyDown: (e: React.KeyboardEvent) => nav.handleKey(e, id),
      onFocus: () => nav.focus(id),
      onClick: () => nav.select(id),
    };
  }

  return (
    <ul
      className={variant === "stacked" ? styles.stacked : styles.assistive}
      aria-label={`${roadmap.careerPathTitle} roadmap, ${roadmap.passedCount} of ${roadmap.totalCount} modules passed`}
    >
      {roadmap.steps.map((step) => (
        <li key={step.id} className={styles.stepItem}>
          <button
            {...nodeProps(step.id)}
            className={[styles.node, styles.spine, stepClass(step, styles)]
              .filter(Boolean)
              .join(" ")}
            aria-label={nodeLabel({ kind: "step", step })}
          >
            <StepFace step={step} />
          </button>

          {step.type === "skill" && step.modules.length > 0 && (
            <ul className={styles.moduleList} aria-label={`Modules in ${step.title}`}>
              {step.modules.map((module) => {
                const status = moduleStatus(module);
                const kind = KIND_LABEL[module.kind];
                return (
                  <li key={module.id} className={styles.moduleItem}>
                    <button
                      {...nodeProps(module.id)}
                      className={[styles.node, styles.branch, styles[module.status]].join(" ")}
                      aria-label={nodeLabel({ kind: "module", module, skill: step })}
                    >
                      <span className={styles.title}>{module.title}</span>
                      <span className={styles.meta} aria-hidden="true">
                        <Badge tone={status.tone} icon={status.icon}>
                          {status.text}
                        </Badge>
                        {kind && <Badge tone="ai">{kind}</Badge>}
                        {module.hasUpdate && <Badge tone="notice" icon="info">Updated</Badge>}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}

/** The visible face of a main-path node. The label above carries the words. */
function StepFace({ step }: { step: RoadmapStep }) {
  switch (step.type) {
    case "skill": {
      const { done, total } = skillProgress(step);
      return (
        <>
          <span className={styles.title}>{step.title}</span>
          <span className={styles.meta} aria-hidden="true">
            {done} of {total}
          </span>
        </>
      );
    }
    case "decision":
      return (
        <>
          <span className={styles.title}>{step.title}</span>
          <span className={styles.meta} aria-hidden="true">
            {step.options.map((o) => o.name).join(" or ")}
          </span>
        </>
      );
    case "certificate":
    case "capstone":
    case "project_certificate": {
      const status = milestoneStatus(step);
      return (
        <>
          <span className={styles.title}>
            <Icon name={step.type === "capstone" ? "wrench" : "award"} size={16} />
            {step.title}
          </span>
          <span className={styles.meta} aria-hidden="true">
            {status.text}
            {step.type === "capstone" && step.totalMilestones
              ? `, ${step.completedMilestones ?? 0} of ${step.totalMilestones} milestones`
              : ""}
          </span>
        </>
      );
    }
    default:
      return assertNever(step);
  }
}

function stepClass(step: RoadmapStep, css: Record<string, string>): string {
  switch (step.type) {
    case "skill":
      return css.skill;
    case "decision":
      return css.decision;
    case "certificate":
    case "capstone":
    case "project_certificate":
      return css.milestone;
    default:
      return assertNever(step);
  }
}
