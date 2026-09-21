import type { Roadmap, RoadmapModuleNode, RoadmapStep, SkillStep } from "./types";

/**
 * Node positions for the chart (design.md §2.1): a vertical main path with
 * modules branching left and right, solid connectors along the path and dashed
 * ones out to the branches.
 *
 * **Written rather than delegated to elkjs or dagre.** §13.1 offers those and
 * closes with "alternatives with the same capabilities are acceptable". The
 * layout here is not a general graph — it is a fixed spine with a known number
 * of children per step — so a general solver would add a large async dependency
 * to compute something 40 lines decide exactly. It is also synchronous, which
 * means the chart has no frame where nodes sit at the origin, and pure, which
 * means it is testable without a DOM. The admin editor's free-form prerequisite
 * graph is a different problem and may still want a solver.
 */

export const SPINE_WIDTH = 190;
export const SPINE_HEIGHT = 64;
export const BRANCH_WIDTH = 224;
export const BRANCH_HEIGHT = 84;

const COLUMN_GAP = 64;
const ROW_GAP = 14;
const STEP_GAP = 48;

export interface PositionedNode {
  id: string;
  /** `spine` sits on the main path; `branch` hangs off a skill node. */
  place: "spine" | "branch";
  x: number;
  y: number;
  width: number;
  height: number;
  step: RoadmapStep;
  /** Present on branch nodes. */
  module?: RoadmapModuleNode;
}

export interface PositionedEdge {
  id: string;
  source: string;
  target: string;
  /** §2.1: solid along the main path, dashed out to branches. */
  variant: "path" | "branch";
  /** Which side a branch edge leaves the spine on. */
  side?: "left" | "right";
}

export interface RoadmapLayout {
  nodes: PositionedNode[];
  edges: PositionedEdge[];
  width: number;
  height: number;
}

/** Modules alternate right, left, right… starting on the right. */
function branchSide(index: number): "right" | "left" {
  return index % 2 === 0 ? "right" : "left";
}

function rowsFor(step: RoadmapStep): number {
  return step.type === "skill" ? Math.ceil(step.modules.length / 2) : 0;
}

function blockHeight(step: RoadmapStep): number {
  const rows = rowsFor(step);
  if (rows === 0) return SPINE_HEIGHT;
  return Math.max(SPINE_HEIGHT, rows * BRANCH_HEIGHT + (rows - 1) * ROW_GAP);
}

function placeBranches(
  step: SkillStep,
  top: number,
  spineLeft: number,
  nodes: PositionedNode[],
  edges: PositionedEdge[],
): void {
  step.modules.forEach((module, i) => {
    const row = Math.floor(i / 2);
    const side = branchSide(i);
    nodes.push({
      id: module.id,
      place: "branch",
      x:
        side === "right"
          ? spineLeft + SPINE_WIDTH + COLUMN_GAP
          : spineLeft - COLUMN_GAP - BRANCH_WIDTH,
      y: top + row * (BRANCH_HEIGHT + ROW_GAP),
      width: BRANCH_WIDTH,
      height: BRANCH_HEIGHT,
      step,
      module,
    });
    edges.push({
      id: `${step.id}--${module.id}`,
      source: step.id,
      target: module.id,
      variant: "branch",
      side,
    });
  });
}

/**
 * Lays the roadmap out top to bottom. Pure: same roadmap, same coordinates,
 * every time — which is what lets the tests assert on positions at all.
 */
export function layoutRoadmap(roadmap: Roadmap): RoadmapLayout {
  const nodes: PositionedNode[] = [];
  const edges: PositionedEdge[] = [];

  // The spine is centred on x = 0 while laying out; everything shifts positive
  // at the end, so the caller never deals with negative coordinates.
  const spineLeft = -SPINE_WIDTH / 2;
  let y = 0;

  roadmap.steps.forEach((step, i) => {
    const height = blockHeight(step);
    const spineY = y + (height - SPINE_HEIGHT) / 2;

    nodes.push({
      id: step.id,
      place: "spine",
      x: spineLeft,
      y: spineY,
      width: SPINE_WIDTH,
      height: SPINE_HEIGHT,
      step,
    });

    if (step.type === "skill") placeBranches(step, y, spineLeft, nodes, edges);

    const next = roadmap.steps[i + 1];
    if (next) {
      edges.push({
        id: `${step.id}--${next.id}`,
        source: step.id,
        target: next.id,
        variant: "path",
      });
    }

    y += height + STEP_GAP;
  });

  const minX = Math.min(...nodes.map((n) => n.x));
  const maxX = Math.max(...nodes.map((n) => n.x + n.width));
  for (const node of nodes) node.x -= minX;

  return {
    nodes,
    edges,
    width: maxX - minX,
    height: Math.max(0, y - STEP_GAP),
  };
}
