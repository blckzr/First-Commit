import { milestoneStatus, moduleStatus } from "./status";
import {
  assertNever,
  isDone,
  type DecisionStep,
  type RoadmapSelection,
  type SkillStep,
} from "./types";

/**
 * What a screen reader announces for a node.
 *
 * design.md §12 gives the shape: "JavaScript basics, module 1 of 2 in
 * JavaScript, current module". The position matters — a chart says where you
 * are by where the node sits, and a list has to say it in words.
 *
 * The status text comes from `status.ts`, so the announcement and the visible
 * badge can never drift apart.
 */

export function skillProgress(step: SkillStep): { done: number; total: number } {
  return {
    done: step.modules.filter((m) => isDone(m.status)).length,
    total: step.modules.length,
  };
}

function decisionLabel(step: DecisionStep): string {
  const names = step.options.map((o) => o.name).join(" or ");
  if (step.chosenOptionId) {
    const chosen = step.options.find((o) => o.id === step.chosenOptionId);
    return `${step.title}, decision between ${names}, you chose ${chosen?.name ?? "an option"}`;
  }
  return `${step.title}, decision between ${names}, not chosen yet`;
}

export function nodeLabel(selection: RoadmapSelection): string {
  if (selection.kind === "module") {
    const { module, skill } = selection;
    const position = skill.modules.indexOf(module) + 1;
    return [
      module.title,
      `module ${position} of ${skill.modules.length} in ${skill.title}`,
      moduleStatus(module).text,
    ].join(", ");
  }

  const step = selection.step;
  switch (step.type) {
    case "skill": {
      const { done, total } = skillProgress(step);
      return `${step.title}, skill, ${done} of ${total} modules passed`;
    }
    case "decision":
      return decisionLabel(step);
    case "certificate":
    case "capstone":
    case "project_certificate":
      return `${step.title}, milestone, ${milestoneStatus(step).text}`;
    default:
      return assertNever(step);
  }
}
