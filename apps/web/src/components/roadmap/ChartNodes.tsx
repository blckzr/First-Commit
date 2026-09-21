import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Badge } from "../core/Badge";
import { Icon } from "../core/Icon";
import { skillProgress } from "../../features/roadmap/labels";
import { milestoneStatus, moduleStatus, KIND_LABEL } from "../../features/roadmap/status";
import {
  type MilestoneStep,
  type DecisionStep,
  type RoadmapModuleNode,
  type SkillStep,
} from "../../features/roadmap/types";
import type { PositionedNode } from "../../features/roadmap/layout";
import styles from "./RoadmapChart.module.css";

/**
 * The four node components the chart draws (design.md §2.1).
 *
 * They are **presentation only**. The canvas is `aria-hidden`, because the same
 * roadmap is already in the DOM as the nested list `RoadmapNav` renders, and
 * two copies in the accessibility tree would mean a screen reader reading the
 * roadmap twice. Everything here — selection, focus ring, keyboard — is driven
 * by the state that list owns.
 */

export interface ChartNodeData extends Record<string, unknown> {
  node: PositionedNode;
  selected: boolean;
  focused: boolean;
}

function shellClass(data: ChartNodeData, extra: string): string {
  return [
    styles.node,
    extra,
    data.selected ? styles.isSelected : "",
    data.focused ? styles.isFocused : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * Connector anchors. Hidden visually; React Flow routes edges through them.
 *
 * Both sides carry a source and a target so a branch leaves the spine on the
 * side its module sits on — §2.1 branches left *and* right, and an edge that
 * always left on the right would loop back across the chart.
 */
function Anchors() {
  return (
    <>
      <Handle type="target" position={Position.Top} className={styles.handle} />
      <Handle type="source" position={Position.Bottom} className={styles.handle} />
      <Handle type="target" id="tl" position={Position.Left} className={styles.handle} />
      <Handle type="source" id="sl" position={Position.Left} className={styles.handle} />
      <Handle type="target" id="tr" position={Position.Right} className={styles.handle} />
      <Handle type="source" id="sr" position={Position.Right} className={styles.handle} />
    </>
  );
}

export function ModuleChartNode({ data }: NodeProps) {
  const d = data as ChartNodeData;
  const module = d.node.module as RoadmapModuleNode;
  const status = moduleStatus(module);
  const kind = KIND_LABEL[module.kind];

  return (
    <div
      className={shellClass(d, [styles.branch, styles[module.status]].join(" "))}
    >
      <Anchors />
      <span className={styles.title}>{module.title}</span>
      <span className={styles.meta}>
        <Badge tone={status.tone} icon={status.icon}>{status.text}</Badge>
        {kind && <Badge tone="ai">{kind}</Badge>}
        {module.hasUpdate && <Badge tone="notice" icon="info">Updated</Badge>}
        {module.sharedWithPaths.length > 0 && <Badge tone="neutral">Also in another path</Badge>}
      </span>
    </div>
  );
}

export function SkillChartNode({ data }: NodeProps) {
  const d = data as ChartNodeData;
  const step = d.node.step as SkillStep;
  const { done, total } = skillProgress(step);

  return (
    <div className={shellClass(d, styles.skill)}>
      <Anchors />
      <span className={styles.title}>{step.title}</span>
      <span className={styles.meta}>{done} of {total}</span>
    </div>
  );
}

export function DecisionChartNode({ data }: NodeProps) {
  const d = data as ChartNodeData;
  const step = d.node.step as DecisionStep;

  return (
    <div className={shellClass(d, styles.decision)}>
      <Anchors />
      <span className={styles.title}>{step.title}</span>
      <span className={styles.meta}>{step.options.map((o) => o.name).join(" or ")}</span>
    </div>
  );
}

export function MilestoneChartNode({ data }: NodeProps) {
  const d = data as ChartNodeData;
  const step = d.node.step as MilestoneStep;
  const status = milestoneStatus(step);

  return (
    <div className={shellClass(d, styles.milestone)}>
      <Anchors />
      <span className={styles.title}>
        <Icon name={step.type === "capstone" ? "wrench" : "award"} size={16} />
        {step.title}
      </span>
      <span className={styles.meta}>
        <Badge tone={status.tone} icon={status.icon}>{status.text}</Badge>
      </span>
    </div>
  );
}
