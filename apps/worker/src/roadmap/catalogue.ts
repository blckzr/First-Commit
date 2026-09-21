import type { Pool } from "pg";

/**
 * What the Roadmap AI is allowed to choose from, and what it knows about the
 * learner.
 *
 * **Read from the database, never from the job payload.** The payload says
 * which career path; everything else — the learner's answers, their placement
 * result, what they have already passed — is loaded here. A payload is a
 * snapshot someone else wrote; this is the current truth, and the worker is
 * server code, so it is entitled to read it (AGENT.md §2, the seam).
 *
 * Only **published** content is offered. A draft module is not an admin's
 * decision yet, and putting one on a learner's roadmap would show them
 * something no one approved.
 */

export interface CatalogueModule {
  id: string;
  slug: string;
  title: string;
  description: string;
  kind: "core" | "concept" | "technology" | "reinforcement" | "challenge";
  /** Null for core and concept modules. */
  technologyId: string | null;
  technologyName: string | null;
  skillId: string;
  skillName: string;
  /** "core", or the id of the track this concept module belongs to. */
  layer: "core" | "concept";
  trackId: string | null;
  estimatedHours: number;
  requiredForCertificate: boolean;
  sortOrder: number;
  /** Module ids this one requires. */
  requires: string[];
}

export interface CatalogueTrack {
  id: string;
  title: string;
  description: string;
  audience: string;
  decisions: { id: string; title: string; technologyIds: string[] }[];
}

export interface Learner {
  userId: string;
  experienceLevel: string | null;
  goal: string | null;
  weeklyHours: number | null;
  /** Free-form, per-skill. Empty until placement questions exist. */
  placement: Record<string, unknown>;
  /** Modules already passed or tested out — on any roadmap (§6 rule 7). */
  completedModuleIds: string[];
}

export interface Catalogue {
  careerPathId: string;
  careerPathTitle: string;
  tracks: CatalogueTrack[];
  modules: CatalogueModule[];
  learner: Learner;
}

interface ModuleRow {
  id: string;
  slug: string;
  title: string;
  description: string;
  kind: CatalogueModule["kind"];
  technology_id: string | null;
  technology_name: string | null;
  skill_id: string;
  skill_name: string;
  layer: "core" | "concept";
  track_id: string | null;
  estimated_hours: string;
  required_for_certificate: boolean;
  sort_order: number;
}

export async function loadCatalogue(
  pool: Pool,
  careerPathId: string,
  userId: string,
): Promise<Catalogue> {
  const path = await pool.query<{ title: string }>(
    `select title from career_paths where id = $1 and status = 'published'`,
    [careerPathId],
  );
  if (!path.rows[0]) {
    throw new Error(`Career path ${careerPathId} is not a published path`);
  }

  const tracks = await pool.query<{ id: string; title: string; description: string; audience: string }>(
    `select id, title, description, audience
       from tracks
      where career_path_id = $1 and status = 'published'
      order by sort_order, title`,
    [careerPathId],
  );
  if (tracks.rowCount === 0) {
    throw new Error(`Career path ${careerPathId} has no published track to recommend`);
  }

  const decisions = await pool.query<{
    id: string;
    track_id: string;
    title: string;
    technology_id: string;
  }>(
    `select d.id, d.track_id, d.title, o.technology_id
       from technology_decisions d
       join decision_options o on o.decision_id = d.id and o.status = 'published'
       join tracks t on t.id = d.track_id
      where t.career_path_id = $1
      order by d.sort_order, d.title`,
    [careerPathId],
  );

  /**
   * Every published module placed in this path, with the version that is
   * currently published. `module_versions_one_published` guarantees at most one,
   * so this join cannot multiply rows.
   */
  const modules = await pool.query<ModuleRow>(
    `select m.id,
            m.slug,
            v.title,
            v.description,
            m.kind,
            m.technology_id,
            tech.name        as technology_name,
            s.id             as skill_id,
            s.name           as skill_name,
            ps.layer,
            ps.track_id,
            v.estimated_hours,
            psm.required_for_certificate,
            psm.sort_order
       from path_skill_modules psm
       join path_skills ps     on ps.id = psm.path_skill_id
       join modules m          on m.id = psm.module_id
       join skills s           on s.id = m.skill_id
       join module_versions v  on v.module_id = m.id and v.status = 'published'
       left join technologies tech on tech.id = m.technology_id
      where ps.career_path_id = $1
        and m.status = 'published'
      order by ps.layer, ps.sort_order, psm.sort_order`,
    [careerPathId],
  );

  const prerequisites = await pool.query<{ module_id: string; requires_module_id: string }>(
    `select mp.module_id, mp.requires_module_id
       from module_prerequisites mp
      where mp.module_id = any($1::uuid[])`,
    [modules.rows.map((m) => m.id)],
  );
  const requiredBy = new Map<string, string[]>();
  for (const row of prerequisites.rows) {
    const list = requiredBy.get(row.module_id) ?? [];
    list.push(row.requires_module_id);
    requiredBy.set(row.module_id, list);
  }

  const profile = await pool.query<{
    experience_level: string | null;
    goal: string | null;
    weekly_hours: number | null;
  }>(
    `select experience_level, goal, weekly_hours from learner_profiles where user_id = $1`,
    [userId],
  );

  const placement = await pool.query<{ results: Record<string, unknown> }>(
    `select results from placement_results
      where user_id = $1 and career_path_id = $2
      order by taken_at desc limit 1`,
    [userId, careerPathId],
  );

  // §6 rule 7: progress belongs to the learner, not the roadmap. Anything
  // already passed anywhere is already passed here.
  const completed = await pool.query<{ module_id: string }>(
    `select module_id from module_completions where user_id = $1`,
    [userId],
  );

  return {
    careerPathId,
    careerPathTitle: path.rows[0].title,
    tracks: tracks.rows.map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      audience: t.audience,
      decisions: [
        ...new Map(
          decisions.rows
            .filter((d) => d.track_id === t.id)
            .map((d) => [
              d.id,
              {
                id: d.id,
                title: d.title,
                technologyIds: decisions.rows
                  .filter((o) => o.id === d.id)
                  .map((o) => o.technology_id),
              },
            ]),
        ).values(),
      ],
    })),
    modules: modules.rows.map((m) => ({
      id: m.id,
      slug: m.slug,
      title: m.title,
      description: m.description,
      kind: m.kind,
      technologyId: m.technology_id,
      technologyName: m.technology_name,
      skillId: m.skill_id,
      skillName: m.skill_name,
      layer: m.layer,
      trackId: m.track_id,
      estimatedHours: Number(m.estimated_hours),
      requiredForCertificate: m.required_for_certificate,
      sortOrder: m.sort_order,
      requires: requiredBy.get(m.id) ?? [],
    })),
    learner: {
      userId,
      experienceLevel: profile.rows[0]?.experience_level ?? null,
      goal: profile.rows[0]?.goal ?? null,
      weeklyHours: profile.rows[0]?.weekly_hours ?? null,
      placement: placement.rows[0]?.results ?? {},
      completedModuleIds: completed.rows.map((r) => r.module_id),
    },
  };
}

/**
 * The modules a roadmap on `trackId` may contain, in an order that already
 * satisfies every prerequisite.
 *
 * Two jobs. It is the **allowed set** the validator checks against, and it is
 * the order the prompt presents the catalogue in — so a model that changes
 * nothing still returns something valid, and a model that reorders has to work
 * to get it wrong. Handing the model well-organised input is not doing its job
 * for it; the choice of track, of what to skip, and of how to sequence within
 * the constraints is still entirely its own.
 *
 * **Technology modules are excluded.** design.md §2.1: nodes after a decision
 * stay locked until the learner chooses, so a framework's modules join the
 * roadmap with the choice, not before it.
 */
export function eligibleModules(catalogue: Catalogue, trackId: string): CatalogueModule[] {
  const eligible = catalogue.modules.filter(
    (m) =>
      m.kind !== "technology" &&
      (m.layer === "core" || m.trackId === trackId),
  );

  const byId = new Map(eligible.map((m) => [m.id, m]));
  const ordered: CatalogueModule[] = [];
  const state = new Map<string, "open" | "done">();

  const visit = (module: CatalogueModule): void => {
    if (state.get(module.id) === "done") return;
    // A cycle cannot happen — the seed loader rejects one — but a database
    // edited by hand could hold one, and silently looping forever is worse
    // than an incomplete order the validator will then reject.
    if (state.get(module.id) === "open") return;
    state.set(module.id, "open");
    for (const req of module.requires) {
      const prerequisite = byId.get(req);
      if (prerequisite) visit(prerequisite);
    }
    state.set(module.id, "done");
    ordered.push(module);
  };

  // Core first, then the track's concepts, each in the admin's sort order.
  const sorted = [...eligible].sort((a, b) => {
    if (a.layer !== b.layer) return a.layer === "core" ? -1 : 1;
    return a.sortOrder - b.sortOrder;
  });
  for (const module of sorted) visit(module);

  return ordered;
}
