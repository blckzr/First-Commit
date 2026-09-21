import type { Pool, PoolClient } from "pg";

/**
 * The technology decision (design.md §5.8).
 *
 * A decision belongs to a *track*; a learner's answer to it belongs to a
 * *roadmap*, which is why `roadmap_technology_choices` is keyed on both. Every
 * function here takes the roadmap id and the caller's id, so the ownership
 * check is unavoidable rather than remembered.
 */

export interface DecisionOption {
  technologyId: string;
  name: string;
  description: string;
  /** Free-form from `decision_options.comparison`: learning curve, use cases, demand. */
  comparison: Record<string, string>;
  /** How many modules join the roadmap if this option is chosen. */
  moduleCount: number;
  /**
   * How many of this technology's modules the learner has already passed.
   * §5.8's switch dialog needs it: "Your 3 passed React modules stay on your
   * resume."
   */
  passedCount: number;
}

export interface DecisionPage {
  id: string;
  roadmapId: string;
  title: string;
  trackTitle: string;
  careerPathTitle: string;
  chosenTechnologyId: string | null;
  /**
   * From the `technology_recommendation` job, which is not built. Null until it
   * is — §5.8's AI panel is simply absent rather than filled with a guess.
   */
  recommendation: { technologyId: string; reason: string } | null;
  options: DecisionOption[];
}

/** Modules of one technology that belong to this decision's track. */
async function technologyModules(
  db: Pool | PoolClient,
  decisionId: string,
  technologyId: string,
): Promise<{ id: string; sortOrder: number }[]> {
  const { rows } = await db.query<{ id: string; sort_order: number }>(
    `select m.id, psm.sort_order
       from technology_decisions d
       join tracks t            on t.id = d.track_id
       join path_skills ps      on ps.track_id = t.id
       join path_skill_modules psm on psm.path_skill_id = ps.id
       join modules m           on m.id = psm.module_id
       join module_versions v   on v.module_id = m.id and v.status = 'published'
      where d.id = $1
        and m.technology_id = $2
        and m.kind = 'technology'
        and m.status = 'published'
      order by ps.sort_order, psm.sort_order`,
    [decisionId, technologyId],
  );
  return rows.map((r) => ({ id: r.id, sortOrder: r.sort_order }));
}

export async function buildDecision(
  pool: Pool,
  roadmapId: string,
  decisionId: string,
  userId: string,
): Promise<DecisionPage | null> {
  /**
   * One query decides everything: the roadmap must be the caller's, and the
   * decision must be one that roadmap actually has. A decision from another
   * track — or another learner's roadmap — falls out here as null, which the
   * route turns into a 404.
   */
  const head = await pool.query<{
    decision_id: string;
    title: string;
    track_title: string;
    career_path_title: string;
    technology_id: string | null;
    recommended_technology_id: string | null;
    recommendation_reason: string | null;
  }>(
    `select d.id            as decision_id,
            d.title,
            t.title         as track_title,
            cp.title        as career_path_title,
            c.technology_id,
            c.recommended_technology_id,
            c.recommendation_reason
       from roadmap_technology_choices c
       join roadmaps r            on r.id = c.roadmap_id
       join technology_decisions d on d.id = c.decision_id
       join tracks t              on t.id = d.track_id
       join career_paths cp       on cp.id = r.career_path_id
      where c.roadmap_id = $1 and c.decision_id = $2 and r.user_id = $3`,
    [roadmapId, decisionId, userId],
  );
  if (!head.rows[0]) return null;
  const row = head.rows[0];

  const options = await pool.query<{
    technology_id: string;
    name: string;
    description: string;
    comparison: Record<string, string>;
  }>(
    `select o.technology_id, tech.name, tech.description, o.comparison
       from decision_options o
       join technologies tech on tech.id = o.technology_id
      where o.decision_id = $1 and o.status = 'published'
      order by tech.name`,
    [decisionId],
  );

  // §6 rule 7: a completion belongs to the learner, so a module passed under
  // one technology stays passed whatever they choose next.
  const passed = await pool.query<{ technology_id: string; n: string }>(
    `select m.technology_id, count(*) as n
       from module_completions c
       join modules m on m.id = c.module_id
      where c.user_id = $1 and m.technology_id is not null
      group by m.technology_id`,
    [userId],
  );
  const passedBy = new Map(passed.rows.map((r) => [r.technology_id, Number(r.n)]));

  const built: DecisionOption[] = [];
  for (const option of options.rows) {
    const modules = await technologyModules(pool, decisionId, option.technology_id);
    built.push({
      technologyId: option.technology_id,
      name: option.name,
      description: option.description,
      comparison: option.comparison ?? {},
      moduleCount: modules.length,
      passedCount: passedBy.get(option.technology_id) ?? 0,
    });
  }

  return {
    id: row.decision_id,
    roadmapId,
    title: row.title,
    trackTitle: row.track_title,
    careerPathTitle: row.career_path_title,
    chosenTechnologyId: row.technology_id,
    recommendation:
      row.recommended_technology_id && row.recommendation_reason
        ? {
            technologyId: row.recommended_technology_id,
            reason: row.recommendation_reason,
          }
        : null,
    options: built,
  };
}

export interface ChoiceResult {
  technologyId: string;
  /** Modules added to the roadmap by this choice. */
  added: number;
  /** Modules of the previous technology taken off it. */
  removed: number;
  /** True when this replaced an earlier choice (§5.8's switch). */
  switched: boolean;
}

/**
 * Records a choice, and rebuilds the technology part of the roadmap around it.
 *
 * **Nothing here touches `module_completions`.** §5.8: "Your core and concept
 * modules stay passed. Your 3 passed React modules stay on your resume." A
 * switch changes the *plan*, never the evidence (AGENT.md §6 rules 1 and 5) —
 * which is also why the old modules are marked `removed` rather than deleted.
 */
export async function chooseTechnology(
  pool: Pool,
  {
    roadmapId,
    decisionId,
    technologyId,
    userId,
  }: { roadmapId: string; decisionId: string; technologyId: string; userId: string },
): Promise<ChoiceResult | null> {
  const client = await pool.connect();
  try {
    await client.query("begin");

    /**
     * Ownership, and that this decision is on this roadmap, in one check.
     *
     * Plain `for update` rather than `for update of c`: it locks the roadmap
     * row as well, which is the safer lock — two tabs choosing at once, or a
     * choice racing an archive, both serialise here. (pg-mem also cannot parse
     * the `of` form, so the narrower lock could not be tested at all.)
     */
    const choice = await client.query<{ technology_id: string | null }>(
      `select c.technology_id
         from roadmap_technology_choices c
         join roadmaps r on r.id = c.roadmap_id
        where c.roadmap_id = $1 and c.decision_id = $2 and r.user_id = $3
          for update`,
      [roadmapId, decisionId, userId],
    );
    if (!choice.rows[0]) {
      await client.query("rollback");
      return null;
    }
    const previous = choice.rows[0].technology_id;

    // The technology must be a published option of *this* decision. A valid
    // technology id from elsewhere is not an answer to this question.
    const option = await client.query(
      `select 1 from decision_options
        where decision_id = $1 and technology_id = $2 and status = 'published'`,
      [decisionId, technologyId],
    );
    if (!option.rowCount) {
      await client.query("rollback");
      return null;
    }

    await client.query(
      `update roadmap_technology_choices
          set technology_id = $1, chosen_at = now()
        where roadmap_id = $2 and decision_id = $3`,
      [technologyId, roadmapId, decisionId],
    );

    /**
     * Take the other technologies' modules off the roadmap. `status = 'removed'`
     * rather than a delete: a learner who switches back should find their
     * history intact, and `module_completions` points at these modules with
     * `on delete restrict` anyway.
     */
    const removed = await client.query(
      `update roadmap_items
          set status = 'removed'
        where roadmap_id = $1
          and status = 'active'
          and module_id in (
            select m.id from modules m
             where m.kind = 'technology' and m.technology_id <> $2
          )`,
      [roadmapId, technologyId],
    );

    // Append after everything already planned, keeping the admin's order.
    const tail = await client.query<{ max: number | null }>(
      `select max(sort_order) as max from roadmap_items where roadmap_id = $1`,
      [roadmapId],
    );
    const base = Number(tail.rows[0]?.max ?? 0) + 1;

    const modules = await technologyModules(client, decisionId, technologyId);
    for (const [i, module] of modules.entries()) {
      await client.query(
        `insert into roadmap_items (roadmap_id, module_id, sort_order, source, status)
         values ($1, $2, $3, 'generated', 'active')
         on conflict (roadmap_id, module_id) do update
           set status = 'active', sort_order = excluded.sort_order`,
        [roadmapId, module.id, base + i],
      );
    }

    await client.query("commit");

    return {
      technologyId,
      added: modules.length,
      removed: removed.rowCount ?? 0,
      switched: previous !== null && previous !== technologyId,
    };
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
