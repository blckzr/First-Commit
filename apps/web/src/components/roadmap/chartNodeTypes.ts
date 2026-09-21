import {
  DecisionChartNode,
  MilestoneChartNode,
  ModuleChartNode,
  SkillChartNode,
} from "./ChartNodes";
import type { PositionedNode } from "../../features/roadmap/layout";
import { assertNever, type RoadmapStep } from "../../features/roadmap/types";

/** The four node components the chart draws (design.md §2.1). */
export const nodeTypes = {
  module: ModuleChartNode,
  skill: SkillChartNode,
  decision: DecisionChartNode,
  milestone: MilestoneChartNode,
};

/**
 * Picks the component for a node. The `switch` is exhaustive on
 * `RoadmapStep["type"]`, so §13.3's promise holds: add a step type without a
 * node for it and this stops compiling.
 */
export function chartNodeType(node: PositionedNode): keyof typeof nodeTypes {
  if (node.module) return "module";
  return stepNodeType(node.step);
}

function stepNodeType(step: RoadmapStep): keyof typeof nodeTypes {
  switch (step.type) {
    case "skill":
      return "skill";
    case "decision":
      return "decision";
    case "certificate":
    case "capstone":
    case "project_certificate":
      return "milestone";
    default:
      return assertNever(step);
  }
}
