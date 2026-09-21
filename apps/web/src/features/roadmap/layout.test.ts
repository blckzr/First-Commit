import { describe, expect, it } from "vitest";
import { layoutRoadmap, SPINE_WIDTH } from "./layout";
import { mockRoadmap } from "./mock";
import { allModules } from "./types";

/**
 * The layout is pure, so it can be checked exactly rather than eyeballed in a
 * screenshot. These assert the shape design.md §2.1 describes: one vertical
 * main path, branches either side, solid connectors along the path and dashed
 * ones out to the branches.
 */

const layout = layoutRoadmap(mockRoadmap);
const spine = layout.nodes.filter((n) => n.place === "spine");
const branches = layout.nodes.filter((n) => n.place === "branch");

describe("layoutRoadmap", () => {
  it("places every step and every module exactly once", () => {
    expect(spine).toHaveLength(mockRoadmap.steps.length);
    expect(branches).toHaveLength(allModules(mockRoadmap).length);

    const ids = layout.nodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("runs the main path top to bottom in step order", () => {
    expect(spine.map((n) => n.id)).toEqual(mockRoadmap.steps.map((s) => s.id));
    for (let i = 1; i < spine.length; i++) {
      expect(spine[i].y).toBeGreaterThan(spine[i - 1].y);
    }
  });

  it("keeps the whole main path in one column", () => {
    const xs = new Set(spine.map((n) => n.x));
    expect(xs.size).toBe(1);
  });

  /** §2.1: "related subtopics branching to the left and right". */
  it("branches alternately right then left of the spine", () => {
    const spineX = spine[0].x;
    for (const step of mockRoadmap.steps) {
      if (step.type !== "skill") continue;
      step.modules.forEach((module, i) => {
        const node = branches.find((n) => n.id === module.id)!;
        if (i % 2 === 0) expect(node.x).toBeGreaterThan(spineX + SPINE_WIDTH);
        else expect(node.x + node.width).toBeLessThan(spineX);
      });
    }
  });

  it("never overlaps two branches of the same skill", () => {
    for (const step of mockRoadmap.steps) {
      if (step.type !== "skill") continue;
      const nodes = step.modules.map((m) => branches.find((n) => n.id === m.id)!);
      for (const a of nodes) {
        for (const b of nodes) {
          if (a === b) continue;
          const apart =
            a.x + a.width <= b.x || b.x + b.width <= a.x ||
            a.y + a.height <= b.y || b.y + b.height <= a.y;
          expect(apart, `${a.id} overlaps ${b.id}`).toBe(true);
        }
      }
    }
  });

  /** §2.1: solid connectors on the main path, dashed out to the branches. */
  it("draws solid edges along the path and dashed edges to branches", () => {
    const path = layout.edges.filter((e) => e.variant === "path");
    expect(path).toHaveLength(mockRoadmap.steps.length - 1);
    for (const edge of path) {
      expect(spine.some((n) => n.id === edge.source)).toBe(true);
      expect(spine.some((n) => n.id === edge.target)).toBe(true);
    }

    const branchEdges = layout.edges.filter((e) => e.variant === "branch");
    expect(branchEdges).toHaveLength(branches.length);
    for (const edge of branchEdges) {
      expect(branches.some((n) => n.id === edge.target)).toBe(true);
    }
  });

  it("puts every node at a non-negative position inside the reported bounds", () => {
    for (const node of layout.nodes) {
      expect(node.x).toBeGreaterThanOrEqual(0);
      expect(node.y).toBeGreaterThanOrEqual(0);
      expect(node.x + node.width).toBeLessThanOrEqual(layout.width);
      expect(node.y + node.height).toBeLessThanOrEqual(layout.height);
    }
  });

  it("is deterministic", () => {
    expect(layoutRoadmap(mockRoadmap)).toEqual(layout);
  });
});
