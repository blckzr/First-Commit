import type { RoadmapPlan, RoadmapPlanDraft } from "../schemas.js";
import type { Catalogue } from "./catalogue.js";

/**
 * Turns the model's answer — module slugs and a track title — into the ids the
 * platform stores.
 *
 * ### Why the model is not given ids
 *
 * Three evaluation runs, and **every rejected roadmap attempt was a miscopied
 * module id**. Not one prerequisite violation, not one core-coverage miss: the
 * model understood the task and fumbled the transcription. Two of the bad ids
 * are worth recording, because they show it is transcription and not invention:
 *
 * - `48b67ec1-9336-4067-933b-16ac7f50-a97e-4544-ab19-fbed91c4c966` — two UUIDs
 *   spliced together mid-string.
 * - `c056c754-a1ef-44d6-994a-170dc83b1696` — perfectly well formed, belonging to
 *   nothing.
 *
 * A slug is short, unique, and meaningful, so a mistake in one is far less
 * likely and far more legible when it happens: `js-basic` against `js-basics`
 * tells the retry exactly what went wrong, where one wrong hex digit tells it
 * nothing.
 *
 * ### Ids never leave the server
 *
 * This is the only place a slug becomes an id. The prompt shows slugs, the
 * schema takes slugs, and `validateRoadmapPlan` and `applyRoadmapPlan` keep
 * working in ids exactly as before — so the §7 checks are unchanged by this.
 *
 * ### An unresolved name is a retry, not a crash
 *
 * Returning the message rather than throwing lets `chatJson` feed it back and
 * ask again, which is what already happens for every other kind of invalid
 * output. The message names the unknown slug and, where there is one, the
 * closest real slug — a near miss is the likely case now.
 */
export type Resolution = { plan: RoadmapPlan } | { error: string };

export function resolvePlan(draft: RoadmapPlanDraft, catalogue: Catalogue): Resolution {
  const track = catalogue.tracks.find(
    (t) => t.title.toLowerCase() === draft.recommendedTrack.trim().toLowerCase(),
  );
  if (!track) {
    return {
      error:
        `recommendedTrack "${draft.recommendedTrack}" is not one of the tracks. ` +
        `Use one of these titles exactly: ${catalogue.tracks.map((t) => t.title).join(", ")}.`,
    };
  }

  const bySlug = new Map(catalogue.modules.map((m) => [m.slug.toLowerCase(), m]));

  const ordered = resolveList(draft.orderedModuleSlugs, bySlug, "orderedModuleSlugs");
  if ("error" in ordered) return ordered;

  const skipped = resolveList(draft.skipModuleSlugs, bySlug, "skipModuleSlugs");
  if ("error" in skipped) return skipped;

  return {
    plan: {
      recommendedTrackId: track.id,
      orderedModuleIds: ordered.ids,
      skipModuleIds: skipped.ids,
      explanation: draft.explanation,
    },
  };
}

function resolveList(
  slugs: string[],
  bySlug: Map<string, { id: string }>,
  field: string,
): { ids: string[] } | { error: string } {
  const ids: string[] = [];

  for (const raw of slugs) {
    const slug = raw.trim().toLowerCase();
    const module = bySlug.get(slug);
    if (!module) {
      const near = closest(slug, [...bySlug.keys()]);
      return {
        error:
          `${field} contains "${raw}", which is not a module slug.` +
          (near ? ` Did you mean "${near}"?` : "") +
          ` Use only the slugs listed in the catalogue.`,
      };
    }
    ids.push(module.id);
  }

  return { ids };
}

/**
 * The nearest real slug within one or two edits, so a retry is told what it
 * nearly typed. Nothing further than that — a suggestion that is merely the
 * least bad of the options would send the model somewhere wrong with confidence.
 */
function closest(slug: string, candidates: string[]): string | null {
  let best: string | null = null;
  let bestDistance = 3;

  for (const candidate of candidates) {
    const distance = editDistance(slug, candidate);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return best;
}

function editDistance(a: string, b: string): number {
  // Two rows rather than a full matrix: the catalogue is scanned once per
  // unknown slug and the strings are short.
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
    }
    previous = current;
  }
  return previous[b.length];
}
