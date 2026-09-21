import type { Pool } from "pg";
import type { Catalogue } from "./catalogue.js";
import type { RoadmapPlan } from "../schemas.js";

/**
 * Writes an accepted plan to the database.
 *
 * Called **only after** `validateRoadmapPlan` returns null. Everything here is
 * one transaction: a roadmap with half its modules, or a learner moved past
 * onboarding with no roadmap to look at, are both worse than a failed job the
 * generating screen offers to retry.
 *
 * What it does **not** write: `module_completions`. Nothing a model decided
 * becomes evidence (AGENT.md §6 rule 1). A skipped module is absent from the
 * roadmap, not passed — the learner tests out if they want the credit.
 */
export interface ApplyResult {
  roadmapId: string;
  trackId: string;
  moduleCount: number;
  estimatedWeeks: number | null;
}

export async function applyRoadmapPlan(
  pool: Pool,
  {
    roadmapId,
    userId,
    catalogue,
    plan,
    estimatedWeeks,
  }: {
    roadmapId: string;
    userId: string;
    catalogue: Catalogue;
    plan: RoadmapPlan;
    estimatedWeeks: number | null;
  },
): Promise<ApplyResult> {
  const client = await pool.connect();
  try {
    await client.query("begin");

    // The roadmap row is the API's — it was created when the learner finished
    // placement. Confirm it is theirs and still waiting before writing into it.
    const roadmap = await client.query<{ id: string }>(
      `select id from roadmaps
        where id = $1 and user_id = $2 and career_path_id = $3
          for update`,
      [roadmapId, userId, catalogue.careerPathId],
    );
    if (!roadmap.rows[0]) {
      throw new Error(`Roadmap ${roadmapId} does not belong to this learner and career path`);
    }

    await client.query(
      `update roadmaps
          set track_id = $1, ai_rationale = $2, status = 'active', updated_at = now()
        where id = $3`,
      [plan.recommendedTrackId, plan.explanation, roadmapId],
    );

    /**
     * Replace what a previous generation produced, and leave alone anything the
     * learner added themselves. `roadmap_items` is a plan, not evidence — no
     * foreign key points at it, and `module_completions` is untouched — so
     * regenerating loses nothing a learner earned (§6 rule 5 protects content
     * and evidence, which this is neither).
     */
    await client.query(
      `delete from roadmap_items where roadmap_id = $1 and source = 'generated'`,
      [roadmapId],
    );

    for (const [i, moduleId] of plan.orderedModuleIds.entries()) {
      await client.query(
        `insert into roadmap_items (roadmap_id, module_id, sort_order, source)
         values ($1, $2, $3, 'generated')
         on conflict (roadmap_id, module_id) do update set sort_order = excluded.sort_order`,
        [roadmapId, moduleId, i],
      );
    }

    /**
     * One row per decision on the chosen track, with nothing chosen yet.
     * design.md §2.1: the decision node is on the roadmap from the start and
     * everything after it stays locked until the learner picks.
     *
     * `recommended_technology_id` stays null: the recommendation is its own job
     * type (`technology_recommendation`) with its own prompt, and guessing it
     * here would be an unversioned second opinion.
     */
    const track = catalogue.tracks.find((t) => t.id === plan.recommendedTrackId);
    for (const decision of track?.decisions ?? []) {
      await client.query(
        `insert into roadmap_technology_choices (roadmap_id, decision_id)
         values ($1, $2)
         on conflict (roadmap_id, decision_id) do nothing`,
        [roadmapId, decision.id],
      );
    }

    /**
     * Onboarding is over. The worker is the only thing that knows the roadmap
     * exists, and the generating screen is waiting on exactly this — it polls
     * `GET /onboarding` and leaves for the app when the step reads `done`
     * (design.md §5.4).
     */
    await client.query(
      `update learner_profiles
          set onboarding_step = 'done', updated_at = now()
        where user_id = $1 and onboarding_step = 'generating'`,
      [userId],
    );

    await client.query("commit");

    return {
      roadmapId,
      trackId: plan.recommendedTrackId,
      moduleCount: plan.orderedModuleIds.length,
      estimatedWeeks,
    };
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
