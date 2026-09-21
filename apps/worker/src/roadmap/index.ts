import type { Pool } from "pg";
import { chatJson } from "../ollama.js";
import { RoadmapPlan } from "../schemas.js";
import { buildRoadmapMessages, PROMPT_VERSION } from "../prompts/roadmap.js";
import { eligibleModules, loadCatalogue, type CatalogueModule } from "./catalogue.js";
import { estimateWeeks, validateRoadmapPlan } from "./validate.js";
import { applyRoadmapPlan } from "./apply.js";

/**
 * The `roadmap_generation` handler.
 *
 * The shape of every AI feature here (AGENT.md §7): read the real content and
 * the real learner from the database, ask the model, **check what it said
 * against the content**, and only then write. The model chooses a track, what
 * to skip and the order; it never decides what exists or what the learner has
 * proved.
 */
export interface RoadmapJob {
  id: string;
  user_id: string | null;
  /** The roadmap row the API created when the learner finished placement. */
  source_id: string | null;
  payload: unknown;
}

export interface RoadmapJobResult {
  result: unknown;
  output: unknown;
  promptVersion: number;
}

export async function runRoadmapGeneration(pool: Pool, job: RoadmapJob): Promise<RoadmapJobResult> {
  const payload = job.payload as { careerPathId?: string } | null;
  if (!job.user_id) throw new Error("roadmap_generation needs a user_id");
  if (!job.source_id) throw new Error("roadmap_generation needs the roadmap id as source_id");
  if (!payload?.careerPathId) throw new Error("roadmap_generation payload needs a careerPathId");

  const catalogue = await loadCatalogue(pool, payload.careerPathId, job.user_id);

  // Worked out once, for the prompt and for the validator, so the model is
  // judged against exactly what it was shown.
  const eligibleByTrack = new Map<string, CatalogueModule[]>(
    catalogue.tracks.map((t) => [t.id, eligibleModules(catalogue, t.id)]),
  );

  const response = await chatJson({
    schema: RoadmapPlan,
    messages: buildRoadmapMessages({ catalogue, eligibleByTrack }),
    // The catalogue is long. Lower temperature than code feedback, because
    // there is a right answer here and creativity only costs retries.
    temperature: 0.1,
    validate: (plan) => {
      // The track has to be real before "what may this track contain" means
      // anything, so an unknown track reports itself rather than crashing.
      const eligible = eligibleByTrack.get(plan.recommendedTrackId) ?? [];
      return validateRoadmapPlan(plan, { catalogue, eligible });
    },
  });

  const plan = response.data;
  const estimatedWeeks = estimateWeeks(
    plan.orderedModuleIds,
    catalogue,
    catalogue.learner.weeklyHours,
  );

  const applied = await applyRoadmapPlan(pool, {
    roadmapId: job.source_id,
    userId: job.user_id,
    catalogue,
    plan,
    estimatedWeeks,
  });

  const track = catalogue.tracks.find((t) => t.id === plan.recommendedTrackId);

  return {
    result: {
      attempts: response.attempts,
      durationMs: response.durationMs,
      trackId: applied.trackId,
      moduleCount: applied.moduleCount,
      skipped: plan.skipModuleIds.length,
      estimatedWeeks,
    },
    /**
     * What the learner sees, labelled as AI and flaggable (§7). The counts come
     * from the platform, not the model — §5.5's "16 modules, about 14 weeks" is
     * arithmetic, and a model doing arithmetic is a number nobody checked.
     */
    output: {
      explanation: plan.explanation,
      trackId: applied.trackId,
      trackTitle: track?.title ?? null,
      moduleCount: applied.moduleCount,
      estimatedWeeks,
    },
    promptVersion: PROMPT_VERSION,
  };
}
