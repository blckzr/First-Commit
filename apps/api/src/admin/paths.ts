import { Router } from "express";
import { z } from "zod";
import type { Pool } from "pg";
import { HttpError } from "../middleware/errors.js";
import { requireAdmin, requireAuth, sessionUser } from "../middleware/session.js";
import { logAdminAction } from "./log.js";

/**
 * The career path editor (design.md §6.2).
 *
 * **This is the structure the Roadmap AI selects from**, so the two validations
 * §6.2 names are not polish — they are the difference between a roadmap that
 * can be finished and one that cannot:
 *
 * - **A circular prerequisite makes a module unreachable.** "A requires B, B
 *   requires A" is accepted by the schema (the only check is `module_id <>
 *   requires_module_id`, which catches a one-step loop and nothing longer), and
 *   `roadmap/validate.ts` would reject every roadmap the model produced
 *   afterwards — with an error about the model, not about the content.
 * - **A technology option missing a module for a concept skill** leaves a
 *   learner who picked Vue with a gap where the React learner has a lesson, and
 *   nothing else in the platform notices.
 *
 * **Certificate requirements live here too** (§6.2's third tab):
 * `path_skill_modules.required_for_certificate` is what `syncCertificates()`
 * reads, so a module marked optional here stops being required for everybody,
 * including learners already part-way through.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const id = (value: unknown): string => {
  if (typeof value !== "string" || !UUID.test(value)) throw new HttpError(404, "Not found");
  return value;
};

/**
 * Whether adding `module -> requires` closes a loop.
 *
 * Exported because it is the §6.2 rule, and a test on the function is worth
 * more than a test on the endpoint: the interesting cases are the long loops,
 * and building a six-module cycle through HTTP is noise around one question.
 *
 * Walks *up* from each new prerequisite: if `requires` already depends on
 * `module`, however indirectly, then making `module` depend on `requires`
 * closes the circle.
 */
export function findCycle(
  edges: { module: string; requires: string }[],
  module: string,
  requires: string,
): string[] | null {
  if (module === requires) return [module, module];

  const dependsOn = new Map<string, string[]>();
  for (const edge of edges) {
    dependsOn.set(edge.module, [...(dependsOn.get(edge.module) ?? []), edge.requires]);
  }

  /** The path from `requires` back to `module`, if there is one. */
  const seen = new Set<string>();
  const walk = (node: string, trail: string[]): string[] | null => {
    if (node === module) return [...trail, node];
    if (seen.has(node)) return null;
    seen.add(node);

    for (const next of dependsOn.get(node) ?? []) {
      const found = walk(next, [...trail, node]);
      if (found) return found;
    }
    return null;
  };

  const trail = walk(requires, []);
  return trail ? [module, ...trail] : null;
}

const Prerequisites = z.object({
  requires: z.array(z.string().uuid()).max(20),
});

export function adminPathRoutes(pool: Pool): Router {
  const router = Router();

  /** §6.2's entry: the career paths there are. */
  router.get("/admin/paths", requireAuth, requireAdmin, async (_req, res) => {
    /*
     * Three queries, not one with `count(distinct)` over two left joins: pg-mem
     * supports neither that nor a correlated scalar subquery, so a single
     * statement here could not be tested. Counting is cheap at this size — a
     * career path is content, and there are one or two of them.
     */
    const [paths, trackCounts, skillCounts] = await Promise.all([
      pool.query(`select id, slug, title, status from career_paths order by title`),
      pool.query<{ career_path_id: string; n: string }>(
        `select career_path_id, count(*) as n from tracks group by career_path_id`,
      ),
      pool.query<{ career_path_id: string; n: string }>(
        `select career_path_id, count(*) as n from path_skills group by career_path_id`,
      ),
    ]);

    const tracksBy = new Map(trackCounts.rows.map((r) => [r.career_path_id, Number(r.n)]));
    const skillsBy = new Map(skillCounts.rows.map((r) => [r.career_path_id, Number(r.n)]));
    const rows = paths.rows;

    res.json({
      paths: rows.map((row) => ({
        id: row.id,
        slug: row.slug,
        title: row.title,
        status: row.status,
        tracks: tracksBy.get(row.id) ?? 0,
        skills: skillsBy.get(row.id) ?? 0,
      })),
    });
  });

  /**
   * One path, whole: core skills, tracks, concept skills, the modules placed
   * under each, and what §6.2 says to warn about.
   */
  router.get("/admin/paths/:id", requireAuth, requireAdmin, async (req, res) => {
    const pathId = id(req.params.id);

    const path = await pool.query<{ id: string; slug: string; title: string; status: string }>(
      `select id, slug, title, status from career_paths where id = $1`,
      [pathId],
    );
    if (!path.rows[0]) throw new HttpError(404, "Not found");

    const [tracks, placements, prerequisites, options] = await Promise.all([
      pool.query(
        `select id, title, description, audience, status, sort_order
           from tracks where career_path_id = $1 order by sort_order, title`,
        [pathId],
      ),
      pool.query(
        `select ps.id as path_skill_id, ps.track_id, ps.layer, ps.sort_order as skill_order,
                s.id as skill_id, s.slug as skill_slug, s.name as skill_name,
                m.id as module_id, m.slug as module_slug, m.kind, m.technology_id,
                t.name as technology_name,
                psm.required_for_certificate, psm.sort_order as module_order,
                v.title as module_title
           from path_skills ps
           join skills s on s.id = ps.skill_id
           left join path_skill_modules psm on psm.path_skill_id = ps.id
           left join modules m on m.id = psm.module_id
           left join technologies t on t.id = m.technology_id
           left join module_versions v on v.module_id = m.id and v.status = 'published'
          where ps.career_path_id = $1
          order by ps.layer, ps.sort_order, psm.sort_order`,
        [pathId],
      ),
      pool.query(
        `select mp.module_id, mp.requires_module_id from module_prerequisites mp`,
      ),
      pool.query(
        `select td.track_id, t.id as technology_id, t.name
           from technology_decisions td
           join decision_options o on o.decision_id = td.id
           join technologies t on t.id = o.technology_id
          where td.track_id in (select id from tracks where career_path_id = $1)`,
        [pathId],
      ),
    ]);

    /** Skills, each with the modules placed under it. */
    const skills = new Map<string, Record<string, unknown>>();
    for (const row of placements.rows) {
      if (!skills.has(row.path_skill_id)) {
        skills.set(row.path_skill_id, {
          pathSkillId: row.path_skill_id,
          trackId: row.track_id,
          layer: row.layer,
          skillId: row.skill_id,
          slug: row.skill_slug,
          name: row.skill_name,
          modules: [],
        });
      }
      if (row.module_id) {
        (skills.get(row.path_skill_id)!.modules as unknown[]).push({
          id: row.module_id,
          slug: row.module_slug,
          title: row.module_title ?? row.module_slug,
          kind: row.kind,
          technologyId: row.technology_id,
          technologyName: row.technology_name,
          requiredForCertificate: row.required_for_certificate,
          requires: prerequisites.rows
            .filter((p) => p.module_id === row.module_id)
            .map((p) => p.requires_module_id),
        });
      }
    }

    const skillList = [...skills.values()];

    res.json({
      path: path.rows[0],
      tracks: tracks.rows.map((row) => ({
        id: row.id,
        title: row.title,
        description: row.description,
        audience: row.audience,
        status: row.status,
      })),
      skills: skillList,
      warnings: missingTechnologyModules(skillList, options.rows),
    });
  });

  /**
   * Set a module's prerequisites (§6.2's Core and Tracks tabs).
   *
   * **The whole list at once**, and refused outright if any entry would close a
   * loop. Saving a partial set would leave the path in a state the author did
   * not ask for and did not see.
   */
  router.put(
    "/admin/paths/:id/modules/:moduleId/prerequisites",
    requireAuth,
    requireAdmin,
    async (req, res) => {
      const pathId = id(req.params.id);
      const moduleId = id(req.params.moduleId);

      const parsed = Prerequisites.safeParse(req.body);
      if (!parsed.success) {
        throw new HttpError(400, parsed.error.issues[0]?.message ?? "Check the prerequisites.");
      }

      const client = await pool.connect();
      try {
        await client.query("begin");

        const placed = await client.query<{ id: string }>(
          `select m.id from modules m
             join path_skill_modules psm on psm.module_id = m.id
             join path_skills ps on ps.id = psm.path_skill_id
            where m.id = $1 and ps.career_path_id = $2
            limit 1`,
          [moduleId, pathId],
        );
        if (!placed.rows[0]) {
          await client.query("rollback");
          throw new HttpError(404, "Not found");
        }

        /*
         * The graph **without this module's current edges**, so replacing
         * "A requires B" with "A requires C" is judged on what it would become,
         * not on what it is. Otherwise an author could never undo a loop.
         */
        const edges = await client.query<{ module_id: string; requires_module_id: string }>(
          `select module_id, requires_module_id from module_prerequisites where module_id <> $1`,
          [moduleId],
        );
        const graph = edges.rows.map((row) => ({
          module: row.module_id,
          requires: row.requires_module_id,
        }));

        for (const requires of parsed.data.requires) {
          const cycle = findCycle([...graph], moduleId, requires);
          if (cycle) {
            await client.query("rollback");

            /*
             * An expanded `in` list, not `= any($1)`. pg-mem **returns an empty
             * result** for the array form rather than erroring, so the message
             * would silently fall back to raw uuids — which is exactly the
             * sentence an author needs to be readable. See packages/test-db.
             */
            const placeholders = cycle.map((_, i) => `$${i + 1}`).join(", ");
            const names = await pool.query<{ id: string; slug: string }>(
              `select id, slug from modules where id in (${placeholders})`,
              cycle,
            );
            const bySlug = new Map(names.rows.map((row) => [row.id, row.slug]));

            // §9: say what happened, in the author's own terms.
            throw new HttpError(
              400,
              `This connection creates a loop: ${cycle.map((m) => bySlug.get(m) ?? m).join(" → ")}`,
            );
          }
          graph.push({ module: moduleId, requires });
        }

        await client.query(`delete from module_prerequisites where module_id = $1`, [moduleId]);
        for (const requires of parsed.data.requires) {
          await client.query(
            `insert into module_prerequisites (module_id, requires_module_id) values ($1, $2)`,
            [moduleId, requires],
          );
        }

        await client.query("commit");
        res.json({ requires: parsed.data.requires.length });
      } catch (err) {
        await client.query("rollback").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
  );

  /**
   * §6.2's Certificate rules tab.
   *
   * **This changes what a learner has to finish**, so it is logged (§6.1 step
   * 5). Marking a module optional releases everybody, including learners
   * part-way through — which is usually the intent, and is never something to
   * do without a record of who did it.
   */
  router.patch(
    "/admin/paths/:id/skills/:pathSkillId/modules/:moduleId",
    requireAuth,
    requireAdmin,
    async (req, res) => {
      const admin = sessionUser(req);
      const pathId = id(req.params.id);
      const pathSkillId = id(req.params.pathSkillId);
      const moduleId = id(req.params.moduleId);

      const parsed = z
        .object({ requiredForCertificate: z.boolean() })
        .strict()
        .safeParse(req.body);
      if (!parsed.success) throw new HttpError(400, "Say whether it is required.");

      const client = await pool.connect();
      try {
        await client.query("begin");

        /*
         * Checked, then updated — not `update ... from`, which pg-mem cannot
         * parse with an alias on the target. Two statements in one transaction
         * say the same thing and can be tested. See packages/test-db.
         */
        const owned = await client.query<{ module_id: string }>(
          `select psm.module_id
             from path_skill_modules psm
             join path_skills ps on ps.id = psm.path_skill_id
            where psm.path_skill_id = $1 and psm.module_id = $2 and ps.career_path_id = $3`,
          [pathSkillId, moduleId, pathId],
        );

        if (owned.rows[0]) {
          await client.query(
            `update path_skill_modules set required_for_certificate = $3
              where path_skill_id = $1 and module_id = $2`,
            [pathSkillId, moduleId, parsed.data.requiredForCertificate],
          );
        }

        const updated = owned;
        if (!updated.rows[0]) {
          await client.query("rollback");
          throw new HttpError(404, "Not found");
        }

        await logAdminAction(client, {
          adminId: admin.id,
          action: parsed.data.requiredForCertificate
            ? "certificate_requirement.added"
            : "certificate_requirement.removed",
          targetType: "module",
          targetId: moduleId,
          details: { careerPathId: pathId, pathSkillId },
        });

        await client.query("commit");
        res.json({ requiredForCertificate: parsed.data.requiredForCertificate });
      } catch (err) {
        await client.query("rollback").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
  );

  return router;
}

/**
 * §6.2: "warns when a technology option is missing a technology module for any
 * concept skill" — rendered there as "Vue has no module for State."
 *
 * **Nothing else in the platform notices this.** A learner who picked Vue
 * simply has a gap where the React learner has a lesson, and the roadmap is
 * still valid: the module is not missing, it was never there to miss.
 */
export function missingTechnologyModules(
  skills: Record<string, unknown>[],
  options: { track_id: string; technology_id: string; name: string }[],
): { trackId: string; technology: string; skill: string }[] {
  const warnings: { trackId: string; technology: string; skill: string }[] = [];

  for (const skill of skills) {
    if (skill.layer !== "concept" || !skill.trackId) continue;

    const modules = skill.modules as { technologyId: string | null; kind: string }[];
    const technologyModules = modules.filter((m) => m.kind === "technology");

    for (const option of options.filter((o) => o.track_id === skill.trackId)) {
      const covered = technologyModules.some((m) => m.technologyId === option.technology_id);
      if (!covered) {
        warnings.push({
          trackId: skill.trackId as string,
          technology: option.name,
          skill: skill.name as string,
        });
      }
    }
  }

  return warnings;
}
