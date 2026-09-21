import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import type { Roadmap, RoadmapSelection } from "./types";
import { findSelection } from "./types";

/**
 * Keyboard navigation and selection for the roadmap, shared by both views.
 *
 * design.md §12: "Arrow keys move between nodes; Enter opens the side panel",
 * and "focus moves into side panels and returns to the triggering node when
 * closed". §13.5: "state survives a breakpoint change" — so the selected node
 * lives in the URL, not in a component that unmounts when the chart becomes the
 * stacked list. It also makes a node linkable, which the panel's actions need.
 *
 * Focus is tracked separately from selection: walking the roadmap with the
 * arrow keys should not keep reopening the panel.
 */

export interface RoadmapNavItem {
  id: string;
  /** Reading order: a skill, then its modules, then the next step. */
  parentId: string | null;
  childIds: string[];
}

/** Flattens the roadmap into the order the arrow keys walk. */
function flatten(roadmap: Roadmap): RoadmapNavItem[] {
  const items: RoadmapNavItem[] = [];
  for (const step of roadmap.steps) {
    const childIds = step.type === "skill" ? step.modules.map((m) => m.id) : [];
    items.push({ id: step.id, parentId: null, childIds });
    for (const id of childIds) items.push({ id, parentId: step.id, childIds: [] });
  }
  return items;
}

/**
 * A request to move DOM focus. The nonce makes a repeat request to the same
 * node a new event — closing the panel twice on the same node must both work.
 */
export interface FocusRequest {
  id: string;
  nonce: number;
}

export interface RoadmapNav {
  order: RoadmapNavItem[];
  focusedId: string;
  selectedId: string | null;
  selection: RoadmapSelection | null;
  focusRequest: FocusRequest | null;
  /** Records where focus went; the DOM told us, so nothing to move. */
  focus: (id: string) => void;
  /** Asks the rendered list to move DOM focus to this node. */
  requestFocus: (id: string) => void;
  select: (id: string) => void;
  /** Closes the panel and hands focus back to the node that opened it. */
  close: () => void;
  handleKey: (event: React.KeyboardEvent, id: string) => void;
}

export function useRoadmapNav(roadmap: Roadmap): RoadmapNav {
  const [params, setParams] = useSearchParams();
  const order = useMemo(() => flatten(roadmap), [roadmap]);

  const selectedId = params.get("node");
  const [focusedId, setFocusedId] = useState(() => selectedId ?? order[0]?.id ?? "");
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);

  const selection = useMemo(
    () => (selectedId ? findSelection(roadmap, selectedId) : null),
    [roadmap, selectedId],
  );

  const requestFocus = useCallback((id: string) => {
    setFocusedId(id);
    setFocusRequest((prev) => ({ id, nonce: (prev?.nonce ?? 0) + 1 }));
  }, []);

  const setNode = useCallback(
    (id: string | null) =>
      // `replace` so walking the roadmap does not fill the Back button with
      // every node the learner looked at.
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (id) next.set("node", id);
          else next.delete("node");
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );

  const select = useCallback(
    (id: string) => {
      setFocusedId(id);
      setNode(id);
    },
    [setNode],
  );

  const close = useCallback(() => {
    setNode(null);
    // §12: focus returns to the node that opened the panel.
    if (selectedId) requestFocus(selectedId);
  }, [selectedId, setNode, requestFocus]);

  const handleKey = useCallback(
    (event: React.KeyboardEvent, id: string) => {
      const index = order.findIndex((item) => item.id === id);
      if (index < 0) return;
      const item = order[index];

      const move = (to: number) => {
        const target = order[to];
        if (!target) return;
        event.preventDefault();
        requestFocus(target.id);
      };

      switch (event.key) {
        case "ArrowDown":
          return move(index + 1);
        case "ArrowUp":
          return move(index - 1);
        case "ArrowRight":
          // Out from the main path into that skill's first module.
          return item.childIds.length > 0 ? move(index + 1) : undefined;
        case "ArrowLeft":
          // Back to the skill this module hangs off.
          return item.parentId
            ? move(order.findIndex((o) => o.id === item.parentId))
            : undefined;
        case "Home":
          return move(0);
        case "End":
          return move(order.length - 1);
        case "Enter":
        case " ":
          event.preventDefault();
          select(id);
          return;
        default:
          return;
      }
    },
    [order, requestFocus, select],
  );

  return {
    order,
    focusedId,
    selectedId,
    selection,
    focusRequest,
    focus: setFocusedId,
    requestFocus,
    select,
    close,
    handleKey,
  };
}
