import type { Pool } from "pg";

/**
 * The catalogue a learner can browse (design.md §5.13).
 *
 * **Only published content leaves here.** Every query filters
 * `modules.status = 'published'` *and* `module_versions.status = 'published'`:
 * a draft module is an admin's unfinished work, and a published module's draft
 * *version* is content nobody has signed off. §6 rule 2 is about secrets, but
 * the same instinct applies — this endpoint answers "what can I take", and a
 * draft is not an answer to that.
 *
 * **Four queries, assembled in TypeScript, not one with subqueries.** The row
 * needs path badges and prerequisite names, both many-per-module, and pg-mem
 * cannot evaluate a correlated subquery against an outer alias (it is on
 * `packages/test-db`'s list). The joined form would be untestable, and this
 * form keeps the page query flat enough to page over.
 */

export type ProgressStatus = "passed" | "in_progress" | "not_started";

export interface ExploreModule {
  id: string;
  title: string;
  description: string;
  kind: string;
  estimatedHours: number;
  skill: { id: string; name: string };
  /** Null for everything but a `technology` module — §5.13's badge "(if any)". */
  technology: { id: string; name: string } | null;
  /** §5.13's path badges, and §2.1's "Also in: Data". */
  paths: string[];
  progress: ProgressStatus;
  /**
   * Null unless the module is complete — `score` and `method` come from the
   * same row, so there is no state where one is present without the other.
   */
  method: string | null;
  score: number | null;
  /**
   * Modules that must be passed first, by title, and empty once they are.
   *
   * This is what makes §8's "Needs JS basics" sayable, and §9's "Pass
   * JavaScript basics to unlock this module." The platform does **not** refuse
   * to put a locked module on a roadmap — §5.13 offers "any published module",
   * and §5.9's module page is where the lock is enforced. Hiding it here would
   * mean a learner adds a module and only then discovers they cannot open it.
   */
  locked: string[];
  /** Already on one of the learner's active roadmaps. */
  onRoadmap: boolean;
}

export interface ExploreFilters {
  q?: string;
  skillId?: string;
  technologyId?: string;
  careerPathId?: string;
  status?: ProgressStatus;
}

export interface ExplorePage {
  modules: ExploreModule[];
  total: number;
  page: number;
  pageSize: number;
}

export const PAGE_SIZE = 20;

interface Row {
  id: string;
  title: string;
  description: string;
  kind: string;
  estimated_hours: string | number;
  skill_id: string;
  skill_name: string;
  technology_id: string | null;
  technology_name: string | null;
  method: string | null;
  score: string | number | null;
  enrolled: string | null;
}

/**
 * The page query's `from` and `where`, built once and used twice — for the rows
 * and for the count. Keeping them literally the same string is the point: a
 * count that disagrees with the rows gives a learner a page of nothing and a
 * paginator that says there is more.
 *
 * The clause is assembled from the filters that were *given*, rather than
 * written as `($1 is null or col = $1)`. That shape throws "lookups on joins"
 * in pg-mem, and it cannot use an index in PostgreSQL either.
 */
function scope(userId: string, filters: ExploreFilters, pathModuleIds: string[] | null) {
  const params: unknown[] = [userId];
  const conditions = ["m.status = 'published'"];

  const where = (sql: string, value: unknown) => {
    params.push(value);
    conditions.push(sql.replace("$?", `$${params.length}`));
  };

  if (filters.q) {
    // One parameter, three columns: a learner searching "react" should find a
    // module whose *skill* is React even if the title does not say so.
    params.push(filters.q);
    const n = `$${params.length}`;
    conditions.push(
      `(mv.title ilike '%' || ${n} || '%'` +
        ` or mv.description ilike '%' || ${n} || '%'` +
        ` or s.name ilike '%' || ${n} || '%')`,
    );
  }
  if (filters.skillId) where("m.skill_id = $?::uuid", filters.skillId);
  if (filters.technologyId) where("m.technology_id = $?::uuid", filters.technologyId);

  /**
   * A career path filter is a question about the *skill*, not the module:
   * `path_skill_modules` attaches a module to a skill within a path.
   *
   * **The ids are resolved in their own query first** (`modulesOnPath` below)
   * and arrive here as a list. The natural form — `exists (select 1 ... where
   * psm.module_id = m.id and ...)` — throws `column "m.id" does not exist` in
   * pg-mem, which cannot correlate a subquery against an outer alias. A join
   * into the outer `from` is not the alternative either: a module can sit on
   * two paths, and the join would return it twice and inflate the count.
   */
  if (pathModuleIds) {
    const list = pathModuleIds.map((id) => {
      params.push(id);
      return `$${params.length}`;
    });
    conditions.push(`m.id in (${list.join(", ")})`);
  }

  /**
   * Status is filtered in SQL rather than in TypeScript so that a page of 20 is
   * 20 matching rows. Filtering after the fact would hand the screen a short
   * page and a total that disagreed with it.
   *
   * **"Locked" is not one of the options**, although §8 uses "Needs JS basics"
   * as a status example. A locked module is still *not started* — the lock is a
   * reason, not a stage — so it is reported on the row and the three filters
   * stay mutually exclusive and exhaustive.
   */
  if (filters.status === "passed") conditions.push("c.module_id is not null");
  if (filters.status === "in_progress") {
    conditions.push("c.module_id is null", "e.module_id is not null");
  }
  if (filters.status === "not_started") {
    conditions.push("c.module_id is null", "e.module_id is null");
  }

  const from = `
      from modules m
      join module_versions mv on mv.module_id = m.id and mv.status = 'published'
      join skills s on s.id = m.skill_id
      left join technologies t on t.id = m.technology_id
      left join module_completions c on c.user_id = $1 and c.module_id = m.id
      left join module_enrollments e on e.user_id = $1 and e.module_id = m.id`;

  return { from, where: `where ${conditions.join(" and ")}`, params };
}

export async function buildExplore(
  pool: Pool,
  userId: string,
  filters: ExploreFilters,
  page: number,
): Promise<ExplorePage> {
  const empty = { modules: [], total: 0, page, pageSize: PAGE_SIZE };

  let pathModuleIds: string[] | null = null;
  if (filters.careerPathId) {
    pathModuleIds = await modulesOnPath(pool, filters.careerPathId);
    // A path with nothing on it filters everything out. Returning here also
    // keeps `in ()` — which is not valid SQL — from ever being built.
    if (pathModuleIds.length === 0) return empty;
  }

  const { from, where, params } = scope(userId, filters, pathModuleIds);

  const counted = await pool.query<{ total: string }>(
    `select count(*) as total ${from} ${where}`,
    params,
  );
  const total = Number(counted.rows[0]?.total ?? 0);

  const offset = (page - 1) * PAGE_SIZE;
  const rows = await pool.query<Row>(
    `select m.id, mv.title, mv.description, m.kind, mv.estimated_hours,
            s.id as skill_id, s.name as skill_name,
            t.id as technology_id, t.name as technology_name,
            c.method, c.score,
            e.module_id as enrolled
       ${from}
       ${where}
      order by s.name, mv.title
      limit ${PAGE_SIZE} offset ${offset}`,
    params,
  );

  if (rows.rows.length === 0) return { ...empty, total };

  const ids = rows.rows.map((row) => row.id);
  const [paths, prerequisites, onRoadmap] = await Promise.all([
    pathBadges(pool, ids),
    unmetPrerequisites(pool, userId, ids),
    alreadyOnARoadmap(pool, userId, ids),
  ]);

  return {
    modules: rows.rows.map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description,
      kind: row.kind,
      estimatedHours: Number(row.estimated_hours),
      skill: { id: row.skill_id, name: row.skill_name },
      technology:
        row.technology_id && row.technology_name
          ? { id: row.technology_id, name: row.technology_name }
          : null,
      paths: paths.get(row.id) ?? [],
      progress: row.method ? "passed" : row.enrolled ? "in_progress" : "not_started",
      method: row.method,
      /**
       * **No `row.method &&` guard here, deliberately.** It was written, and
       * mutation testing showed no test could tell the difference: `method` is
       * `not null` on `module_completions` and both columns come from the same
       * left-joined row, so `method` is non-null exactly when a completion
       * exists — and when it does not, `score` is null anyway. The guard could
       * never change the answer. A branch no test can reach looks like care and
       * proves nothing.
       */
      score: row.score !== null ? Number(row.score) : null,
      locked: prerequisites.get(row.id) ?? [],
      onRoadmap: onRoadmap.has(row.id),
    })),
    total,
    page,
    pageSize: PAGE_SIZE,
  };
}

/**
 * Every module attached to a career path, through the skills on it.
 *
 * `distinct` because a module reachable on two of a path's tracks is still one
 * module.
 */
async function modulesOnPath(pool: Pool, careerPathId: string): Promise<string[]> {
  const { rows } = await pool.query<{ module_id: string }>(
    `select distinct psm.module_id
       from path_skill_modules psm
       join path_skills ps on ps.id = psm.path_skill_id
      where ps.career_path_id = $1`,
    [careerPathId],
  );
  return rows.map((row) => row.module_id);
}

/**
 * Which of these modules are already on one of the learner's active roadmaps.
 *
 * Its own query rather than a scalar subquery in the page's select list, which
 * pg-mem cannot evaluate ("column m.id does not exist") — the same reason the
 * two below are separate.
 *
 * Both statuses matter: an *archived* roadmap does not count, so a learner who
 * put a plan away can add the module to the one they are using; and an item
 * with `status = 'removed'` does not count either, because §5.8 removes the
 * other technologies' modules that way and a learner must be able to put one
 * back.
 */
async function alreadyOnARoadmap(
  pool: Pool,
  userId: string,
  ids: string[],
): Promise<Set<string>> {
  const list = ids.map((_, i) => `$${i + 2}`).join(", ");
  const { rows } = await pool.query<{ module_id: string }>(
    `select distinct ri.module_id
       from roadmap_items ri
       join roadmaps r on r.id = ri.roadmap_id
      where r.user_id = $1 and r.status = 'active' and ri.status = 'active'
        and ri.module_id in (${list})`,
    [userId, ...ids],
  );
  return new Set(rows.map((row) => row.module_id));
}

/**
 * The paths each module appears on, by title.
 *
 * Ids are expanded into `in ($2, $3, …)` rather than passed as an array:
 * `= any($1::uuid[])` returns an **empty result** in pg-mem instead of erroring,
 * which is the worst kind of divergence — every badge would simply be missing
 * and nothing would look broken.
 */
async function pathBadges(pool: Pool, ids: string[]): Promise<Map<string, string[]>> {
  const list = ids.map((_, i) => `$${i + 1}`).join(", ");
  const { rows } = await pool.query<{ module_id: string; title: string }>(
    `select distinct psm.module_id, cp.title
       from path_skill_modules psm
       join path_skills ps on ps.id = psm.path_skill_id
       join career_paths cp on cp.id = ps.career_path_id
      where psm.module_id in (${list}) and cp.status = 'published'
      order by cp.title`,
    ids,
  );

  const out = new Map<string, string[]>();
  for (const row of rows) {
    out.set(row.module_id, [...(out.get(row.module_id) ?? []), row.title]);
  }
  return out;
}

/**
 * Prerequisites the learner has **not** passed yet, by title.
 *
 * A prerequisite they already hold is not worth saying, so the list is empty
 * for an unlocked module and the screen needs no second flag to read.
 * `module_completions` is the one source (§6 rule 7: passing Git once counts
 * everywhere), so this is true across every roadmap rather than per roadmap.
 */
async function unmetPrerequisites(
  pool: Pool,
  userId: string,
  ids: string[],
): Promise<Map<string, string[]>> {
  const list = ids.map((_, i) => `$${i + 2}`).join(", ");
  const { rows } = await pool.query<{ module_id: string; title: string }>(
    `select mp.module_id, mv.title
       from module_prerequisites mp
       join modules rm on rm.id = mp.requires_module_id
       join module_versions mv on mv.module_id = rm.id and mv.status = 'published'
       left join module_completions c on c.user_id = $1 and c.module_id = mp.requires_module_id
      where mp.module_id in (${list}) and c.module_id is null
      order by mv.title`,
    [userId, ...ids],
  );

  const out = new Map<string, string[]>();
  for (const row of rows) {
    out.set(row.module_id, [...(out.get(row.module_id) ?? []), row.title]);
  }
  return out;
}

/**
 * The filter options that actually exist in the published catalogue.
 *
 * Read from the content rather than hard-coded, like `/admin/log/filters`: a
 * technology nobody has a module for is a dead option, and a learner who picks
 * it gets an empty list and no idea why.
 */
export async function buildFilterOptions(pool: Pool) {
  const [skills, technologies, paths] = await Promise.all([
    pool.query<{ id: string; name: string }>(
      `select distinct s.id, s.name
         from skills s
         join modules m on m.skill_id = s.id and m.status = 'published'
         join module_versions mv on mv.module_id = m.id and mv.status = 'published'
        order by s.name`,
    ),
    pool.query<{ id: string; name: string }>(
      `select distinct t.id, t.name
         from technologies t
         join modules m on m.technology_id = t.id and m.status = 'published'
         join module_versions mv on mv.module_id = m.id and mv.status = 'published'
        order by t.name`,
    ),
    pool.query<{ id: string; title: string }>(
      `select distinct cp.id, cp.title
         from career_paths cp
         join path_skills ps on ps.career_path_id = cp.id
         join path_skill_modules psm on psm.path_skill_id = ps.id
         join modules m on m.id = psm.module_id and m.status = 'published'
        where cp.status = 'published'
        order by cp.title`,
    ),
  ]);

  return {
    skills: skills.rows,
    technologies: technologies.rows,
    careerPaths: paths.rows.map((row) => ({ id: row.id, name: row.title })),
  };
}
