import type { Catalogue, CatalogueModule } from "./catalogue.js";
import type { RoadmapPlan } from "../schemas.js";

/**
 * The checks AGENT.md §7 names: "Roadmap output is validated against real
 * module IDs, prerequisite order, and full core coverage before anything is
 * saved. Invalid output is rejected and regenerated."
 *
 * Pure on purpose. The model is the part that cannot be tested deterministically,
 * so the part that decides whether to trust it must be — every rule here is
 * covered by a test that builds a plan violating it.
 *
 * It returns **one message at a time**, the most important first, because the
 * message is fed back to the model as the next turn. A list of six complaints
 * is a worse prompt than one clear instruction.
 */
export interface ValidationContext {
  catalogue: Catalogue;
  /** What a roadmap on the chosen track is allowed to contain. */
  eligible: CatalogueModule[];
}

export function validateRoadmapPlan(
  plan: RoadmapPlan,
  { catalogue, eligible }: ValidationContext,
): string | null {
  // --- The track --------------------------------------------------------
  const track = catalogue.tracks.find((t) => t.id === plan.recommendedTrackId);
  if (!track) {
    return `recommendedTrackId "${plan.recommendedTrackId}" is not one of the available tracks. Choose one of: ${catalogue.tracks
      .map((t) => `${t.id} (${t.title})`)
      .join(", ")}.`;
  }

  const eligibleById = new Map(eligible.map((m) => [m.id, m]));
  const allById = new Map(catalogue.modules.map((m) => [m.id, m]));

  // --- Real module ids --------------------------------------------------
  for (const id of plan.orderedModuleIds) {
    if (eligibleById.has(id)) continue;
    const known = allById.get(id);
    if (known?.kind === "technology") {
      return `Module "${id}" (${known.title}) is a technology module. Those are added when the learner chooses their technology, so leave them out of orderedModuleIds.`;
    }
    if (known) {
      return `Module "${id}" (${known.title}) belongs to a different track. Only include core modules and modules from the ${track.title} track.`;
    }
    return `Module id "${id}" does not exist. Use only the ids listed in the catalogue.`;
  }

  // --- No duplicates ----------------------------------------------------
  const seen = new Set<string>();
  for (const id of plan.orderedModuleIds) {
    if (seen.has(id)) {
      return `Module "${allById.get(id)?.title ?? id}" appears twice in orderedModuleIds. List each module once.`;
    }
    seen.add(id);
  }

  // --- Skipping ---------------------------------------------------------
  const skipped = new Set(plan.skipModuleIds);
  for (const id of skipped) {
    const module = allById.get(id);
    if (!module) {
      return `skipModuleIds contains "${id}", which is not a module id.`;
    }
    if (seen.has(id)) {
      return `Module "${module.title}" is both skipped and in orderedModuleIds. Choose one.`;
    }
    /**
     * A skipped module is one the learner never takes — and skipping is **not**
     * a pass. No `module_completions` row is written from a model's opinion
     * (AGENT.md §6 rule 1); a learner who wants the credit tests out of it.
     *
     * So a module required for the certificate can never be skipped: doing so
     * would quietly put the certificate out of reach.
     */
    if (module.requiredForCertificate) {
      return `Module "${module.title}" is required for the certificate, so it cannot be skipped. Remove it from skipModuleIds and place it in orderedModuleIds.`;
    }
  }

  // --- Full core coverage -----------------------------------------------
  const done = new Set(catalogue.learner.completedModuleIds);
  for (const module of eligible) {
    if (module.layer !== "core") continue;
    if (seen.has(module.id) || skipped.has(module.id) || done.has(module.id)) continue;
    return `Core module "${module.title}" is missing. Every core module of this career path must be on the roadmap unless the learner has already passed it.`;
  }

  // The track's own concept modules are equally required — a roadmap that
  // stops before the track teaches anything is not a roadmap for that track.
  for (const module of eligible) {
    if (module.layer !== "concept") continue;
    if (seen.has(module.id) || skipped.has(module.id) || done.has(module.id)) continue;
    return `Module "${module.title}" belongs to the ${track.title} track and is missing from the roadmap.`;
  }

  // --- Prerequisite order -----------------------------------------------
  const position = new Map(plan.orderedModuleIds.map((id, i) => [id, i]));
  for (const [i, id] of plan.orderedModuleIds.entries()) {
    const module = eligibleById.get(id)!;
    for (const req of module.requires) {
      const prerequisite = allById.get(req);
      if (!prerequisite) continue; // Not in this path; nothing to order against.

      const at = position.get(req);
      if (at !== undefined) {
        if (at > i) {
          return `"${module.title}" comes before "${prerequisite.title}", which it requires. Every module must appear after everything it requires.`;
        }
        continue;
      }

      /**
       * Not on the roadmap at all. **Only a real completion satisfies this** —
       * not a skip. Skipping writes no `module_completions` row (§6 rule 1), so
       * a module whose prerequisite was skipped never unlocks, and the learner
       * is left looking at a roadmap with a dead end in it.
       *
       * Between this and the certificate rule above, a module can only be
       * skipped if it is optional *and* nothing else needs it. That is the
       * honest size of the door: placement can suggest what a learner already
       * knows, but the only thing that actually skips a module is testing out
       * of it, which produces evidence.
       */
      if (!done.has(req)) {
        const why = skipped.has(req)
          ? `was skipped, and skipping is not passing — "${module.title}" would never unlock`
          : `is not on the roadmap and has not been passed`;
        return `"${module.title}" requires "${prerequisite.title}", which ${why}. Add "${prerequisite.title}" before "${module.title}".`;
      }
    }
  }

  // --- The explanation --------------------------------------------------
  if (plan.explanation.trim().length < 40) {
    return "The explanation is too short. Write two or three sentences the learner will read on their roadmap review page.";
  }

  return null;
}

/**
 * design.md §5.5: "16 modules, about 14 weeks at 6 hours a week."
 *
 * The platform computes this. It is arithmetic over `estimated_hours`, and a
 * model asked to do arithmetic will sometimes get it wrong in a way nobody
 * notices (AGENT.md §7).
 */
export function estimateWeeks(
  moduleIds: string[],
  catalogue: Catalogue,
  weeklyHours: number | null,
): number | null {
  if (!weeklyHours || weeklyHours <= 0) return null;
  const byId = new Map(catalogue.modules.map((m) => [m.id, m]));
  const hours = moduleIds.reduce((total, id) => total + (byId.get(id)?.estimatedHours ?? 0), 0);
  return Math.max(1, Math.ceil(hours / weeklyHours));
}
