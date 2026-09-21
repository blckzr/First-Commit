import type { BadgeTone } from "../../components/core/Badge";
import type { IconName } from "../../components/core/Icon";
import type { ModuleStatus, RoadmapModuleNode, MilestoneStep } from "./types";

/**
 * design.md §8: **status is never colour alone.** Every status is icon + text +
 * colour, and this is the one place that decides all three — so a node, a list
 * row, the side panel and a screen reader all say the same thing.
 *
 * The words are §9's words. "Tested out", not "assessment bypass".
 */

export interface StatusLabel {
  icon: IconName;
  /** What a learner reads, and what a screen reader announces. */
  text: string;
  tone: BadgeTone;
}

const MODULE: Record<ModuleStatus, StatusLabel> = {
  passed: { icon: "check", text: "Passed", tone: "verified" },
  tested_out: { icon: "check", text: "Tested out", tone: "verified" },
  current: { icon: "circle-dot", text: "You are here", tone: "here" },
  available: { icon: "circle", text: "Available", tone: "neutral" },
  locked: { icon: "lock", text: "Locked", tone: "neutral" },
  archived: { icon: "info", text: "No longer offered", tone: "neutral" },
};

/**
 * A score is part of the status, not a decoration: §8's own example is
 * "Passed, 88%". It comes from server-side grading — the browser has never
 * computed one (AGENT.md §6 rule 1).
 */
export function moduleStatus(module: RoadmapModuleNode): StatusLabel {
  const base = MODULE[module.status];
  if (module.status === "passed" && module.score !== undefined) {
    return { ...base, text: `Passed, ${module.score}%` };
  }
  return base;
}

const MILESTONE: Record<MilestoneStep["status"], StatusLabel> = {
  locked: { icon: "lock", text: "Locked", tone: "neutral" },
  in_progress: { icon: "circle-dot", text: "In progress", tone: "here" },
  earned: { icon: "award", text: "Earned", tone: "verified" },
};

export function milestoneStatus(step: MilestoneStep): StatusLabel {
  return MILESTONE[step.status];
}

/**
 * §9: never "Locked" on its own — say what opens it. The requirement is a
 * module id, so the caller supplies the title it belongs to.
 */
export function lockedReason(requiredTitles: string[]): string {
  if (requiredTitles.length === 0) return "Locked until an earlier step is finished.";
  if (requiredTitles.length === 1) return `Pass ${requiredTitles[0]} to unlock this module.`;
  const last = requiredTitles[requiredTitles.length - 1];
  return `Pass ${requiredTitles.slice(0, -1).join(", ")} and ${last} to unlock this module.`;
}

/** The small word on a branch node saying why the Roadmap AI added it. */
export const KIND_LABEL: Record<RoadmapModuleNode["kind"], string | null> = {
  core: null,
  concept: null,
  technology: null,
  reinforcement: "Extra practice",
  challenge: "Challenge",
};
