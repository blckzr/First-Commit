import { useEffect, useRef, type CSSProperties } from "react";
import { Icon } from "../core/Icon";
import { nodeLabel } from "../../features/roadmap/labels";
import { milestoneStatus, moduleStatus, KIND_LABEL } from "../../features/roadmap/status";
import {
  assertNever,
  isDone,
  type Roadmap,
  type RoadmapModuleNode,
  type RoadmapStep,
} from "../../features/roadmap/types";
import type { RoadmapNav as Nav } from "../../features/roadmap/useRoadmapNav";
import styles from "./RoadmapNav.module.css";

/**
 * **The roadmap chart**, as First Commit v2.dc.html draws it: a spine of steps
 * down the middle, each skill's modules branching left and right of it, joined
 * by short rules, with the milestones in ink at the foot.
 *
 * It replaced a React Flow canvas that panned and zoomed. That canvas was
 * `aria-hidden` decoration over a clipped copy of this list, so there were two
 * renderings of one roadmap to keep in step. Now the list *is* the chart: a
 * nested list of skills containing modules (design.md §12), laid out by CSS.
 * What a mouse user clicks is what a keyboard user focuses and what a screen
 * reader reads.
 *
 * On `sm` the same list reflows into one column — the spine, and each skill's
 * modules indented beneath it (§11.3) — with a media query, not a second view.
 *
 * Only one node is in the tab order at a time (roving tabindex), so Tab leaves
 * the roadmap instead of walking 25 nodes.
 */
export interface RoadmapNavProps {
  roadmap: Roadmap;
  nav: Nav;
}

export function RoadmapNav({ roadmap, nav }: RoadmapNavProps) {
  const refs = useRef(new Map<string, HTMLButtonElement>());

  /**
   * The hook decides where focus should go — arrow keys, or the panel handing
   * it back on close — and this moves it.
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
      className={styles.chart}
      aria-label={`${roadmap.careerPathTitle} roadmap, ${roadmap.passedCount} of ${roadmap.totalCount} modules passed`}
    >
      {roadmap.steps.map((step) => {
        const modules = step.type === "skill" ? step.modules : [];
        /*
         * Modules alternate left and right of the spine, so a skill with n of
         * them takes ceil(n / 2) rows, and the spine node spans all of them.
         * A count, not a colour, so it can be an inline custom property.
         */
        const rows = { "--rows": Math.max(1, Math.ceil(modules.length / 2)) } as CSSProperties;

        return (
          <li key={step.id} className={styles.step} style={rows}>
            <button
              {...nodeProps(step.id)}
              className={[styles.spine, spineClass(step, styles)].join(" ")}
              aria-label={nodeLabel({ kind: "step", step })}
            >
              <SpineFace step={step} />
            </button>

            {step.type === "skill" && modules.length > 0 && (
              <ul className={styles.modules} aria-label={`Modules in ${step.title}`}>
                {modules.map((module) => (
                  <li key={module.id} className={styles.moduleItem}>
                    <button
                      {...nodeProps(module.id)}
                      className={[styles.module, moduleClass(module, styles)].join(" ")}
                      aria-label={nodeLabel({ kind: "module", module, skill: step })}
                    >
                      <ModuleFace module={module} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * A branch node: the status icon and the title, then the status in words.
 * The button's label above carries all of it for a screen reader, so the
 * visible face is `aria-hidden` rather than read twice.
 */
function ModuleFace({ module }: { module: RoadmapModuleNode }) {
  const status = moduleStatus(module);
  const notes = [
    status.text,
    KIND_LABEL[module.kind],
    module.hasUpdate ? "Updated" : null,
    module.sharedWithPaths.length > 0 ? "Also in another path" : null,
  ].filter(Boolean);

  return (
    <span className={styles.face} aria-hidden="true">
      <span className={styles.moduleTitle}>
        <Icon name={status.icon} size={15} className={styles.statusIcon} />
        {module.title}
      </span>
      {/* §8: icon + text + colour. */}
      <span className={styles.moduleMeta}>{notes.join(" · ")}</span>
    </span>
  );
}

/** A main-path node: the title, and a line under it only where v2 draws one. */
function SpineFace({ step }: { step: RoadmapStep }) {
  let sub: string | null;
  switch (step.type) {
    case "skill":
      sub = step.layer === "concept" ? "Concept" : null;
      break;
    case "decision": {
      const chosen = step.options.find((o) => o.id === step.chosenOptionId);
      sub = chosen ? `You chose ${chosen.name}` : step.options.map((o) => o.name).join(" or ");
      break;
    }
    case "certificate":
    case "capstone":
    case "project_certificate": {
      const milestones =
        step.type === "capstone" && step.totalMilestones
          ? `${step.completedMilestones ?? 0} of ${step.totalMilestones} milestones`
          : null;
      // Locked is the default a learner expects at the foot of the roadmap;
      // saying anything else is news, so only that is shown.
      const status = step.status === "locked" ? null : milestoneStatus(step).text;
      sub = [status, milestones].filter(Boolean).join(" · ") || null;
      break;
    }
    default:
      return assertNever(step);
  }

  return (
    <span className={styles.face} aria-hidden="true">
      <span className={styles.spineTitle}>{step.title}</span>
      {sub && <span className={styles.spineSub}>{sub}</span>}
    </span>
  );
}

function spineClass(step: RoadmapStep, css: Record<string, string>): string {
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

/**
 * v2 fills a node by its status. An AI-added module (reinforcement, challenge)
 * takes the violet fill v2 gives "Practice" until it is done — then it is a
 * pass like any other.
 */
function moduleClass(module: RoadmapModuleNode, css: Record<string, string>): string {
  const added = KIND_LABEL[module.kind] !== null && !isDone(module.status);
  return [css[module.status], added ? css.added : ""].filter(Boolean).join(" ");
}
