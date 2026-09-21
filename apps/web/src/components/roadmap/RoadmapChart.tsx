import { useMemo } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { layoutRoadmap } from "../../features/roadmap/layout";
import type { Roadmap } from "../../features/roadmap/types";
import type { RoadmapNav as Nav } from "../../features/roadmap/useRoadmapNav";
import { RoadmapNav } from "./RoadmapNav";
import type { ChartNodeData } from "./ChartNodes";
import { chartNodeType, nodeTypes } from "./chartNodeTypes";
import styles from "./RoadmapChart.module.css";

/**
 * The chart view (design.md §2.1, §11.3) — `md` and `lg`.
 *
 * Two things share this region: the canvas, which is what a sighted mouse user
 * sees, and the nested list, which is what the accessibility tree contains. The
 * canvas is `aria-hidden` so the roadmap is announced once, and both read the
 * same `Roadmap` object and the same nav state, so they cannot disagree about
 * what is selected or where focus is.
 *
 * §12: "the roadmap canvas pans within its own region on `md` and `lg`" — the
 * page itself never scrolls sideways.
 */
export interface RoadmapChartProps {
  roadmap: Roadmap;
  nav: Nav;
}

export function RoadmapChart({ roadmap, nav }: RoadmapChartProps) {
  const layout = useMemo(() => layoutRoadmap(roadmap), [roadmap]);

  const nodes: Node[] = useMemo(
    () =>
      layout.nodes.map((node) => ({
        id: node.id,
        type: chartNodeType(node),
        position: { x: node.x, y: node.y },
        // Positions come from our own layout, so React Flow must not move them.
        draggable: false,
        connectable: false,
        selectable: false,
        // Focus lives on the list; a second tab stop per node would double the
        // tab order and put focus on something with no accessible name.
        focusable: false,
        style: { width: node.width, height: node.height },
        data: {
          node,
          selected: nav.selectedId === node.id,
          focused: nav.focusedId === node.id,
        } satisfies ChartNodeData,
      })),
    [layout, nav.selectedId, nav.focusedId],
  );

  const edges: Edge[] = useMemo(
    () =>
      layout.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.side ? (edge.side === "left" ? "sl" : "sr") : null,
        targetHandle: edge.side ? (edge.side === "left" ? "tr" : "tl") : null,
        type: "smoothstep",
        focusable: false,
        selectable: false,
        className: edge.variant === "branch" ? styles.branchEdge : styles.pathEdge,
      })),
    [layout],
  );

  return (
    <div className={styles.region}>
      {/*
        The accessible copy. It carries the labels, the arrow keys and the tab
        stop; the canvas below is decoration driven by the same state.
      */}
      <RoadmapNav roadmap={roadmap} nav={nav} variant="assistive" />

      <div className={styles.canvas} aria-hidden="true">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          // One click handler for the whole canvas. Putting one on each node
          // would make a div interactive without a role, inside a region that
          // is aria-hidden — a control no keyboard could ever reach.
          onNodeClick={(_, node) => nav.select(node.id)}
          fitView
          minZoom={0.3}
          maxZoom={1.5}
          proOptions={{ hideAttribution: false }}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          // The canvas is not in the tab order: the list is.
          disableKeyboardA11y
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </div>
  );
}
