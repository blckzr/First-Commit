import type { Pool } from "pg";

/**
 * Assembles the `Roadmap` object design.md §13.3 defines, which drives both the
 * chart and the stacked list in the browser.
 *
 * Every query here **selects its columns explicitly** and is filtered by the
 * caller's own id (docs/database-schema.md §6.1). Ownership of the roadmap is
 * checked by the route before this runs.
 *
 * Statuses are computed here, from `module_completions` and
 * `module_enrollments` — never read from anything the browser sent, and never
 * written back. This function only reads.
 */

export type ModuleStatus =
  | "passed"
  | "tested_out"
  | "current"
  | "available"
  | "locked"
  | "archived";

export interface RoadmapModuleNode {
  id: string;
  moduleId: string;
  versionNo: number;
  title: string;
  kind: string;
  technologyOptionId?: string;
  status: ModuleStatus;
  score?: number;
  requires: string[];
  sharedWithPaths: string[];
  addedReason?: string;
  hasUpdate: boolean;
  estimatedHours: number;
}

export type RoadmapStep =
  | {
      type: "skill";
      id: string;
      skillId: string;
      title: string;
      layer: "core" | "concept";
      modules: RoadmapModuleNode[];
    }
  | {
      type: "decision";
      id: string;
      title: string;
      options: { id: string; name: string; requires: string[] }[];
      chosenOptionId?: string;
      recommendedOptionId?: string;
    }
  | {
      type: "certificate" | "capstone" | "project_certificate";
      id: string;
      title: string;
      status: "locked" | "in_progress" | "earned";
      certificateId?: string;
      completedMilestones?: number;
      totalMilestones?: number;
    };

export interface Roadmap {
  id: string;
  careerPathId: string;
  careerPathTitle: string;
  trackId: string | null;
  trackTitle: string;
  pathColor: "path-1" | "path-2" | "path-3" | "path-4";
  steps: RoadmapStep[];
  passedCount: number;
  /** Of `passedCount`, the ones cleared without working through the module. */
  testedOutCount: number;
  totalCount: number;
  /**
   * §5.5's AI panel. Written by the Roadmap AI when it planned this roadmap,
   * and labelled as AI wherever it is shown (AGENT.md §7).
   */
  aiRationale: string | null;
  /**
   * The `ai_outputs` row `aiRationale` came from, so §5.5's "Is this wrong?"
   * has something to point at. Null on a roadmap made before the output was
   * recorded, and the control is then not offered rather than offered broken.
   */
  aiOutputId: string | null;
  /** Whether this learner has already flagged that output. */
  aiFlagged: boolean;
  weeklyHours: number | null;
  /**
   * §5.5: "16 modules, about 14 weeks at 6 hours a week". Arithmetic over the
   * modules still to do, so it falls as the learner passes them. Null when
   * they have not said how many hours they have.
   */
  estimatedWeeks: number | null;
}

/**
 * design.md §13.3 has `pathColor`, and `career_paths` has no colour column.
 *
 * Derived from the id so the same path is always the same colour, rather than
 * inventing a column or letting the browser pick — a roadmap that changes
 * colour between visits reads as a different roadmap. Recorded in
 * docs/task-tracker.md: either §13.3 drops it or the schema gains it.
 */
function pathColor(careerPathId: string): Roadmap["pathColor"] {
  let hash = 0;
  for (const ch of careerPathId) hash = (hash * 31 + ch.charCodeAt(0)) % 4;
  return (["path-1", "path-2", "path-3", "path-4"] as const)[hash];
}

interface ItemRow {
  module_id: string;
  sort_order: number;
  source: string;
  added_reason: string | null;
  kind: string;
  technology_id: string | null;
  skill_id: string;
  skill_name: string;
  layer: "core" | "concept";
  skill_sort: number;
  published_version_id: string;
  published_version_no: number;
  title: string;
  estimated_hours: string;
}

export async function buildRoadmap(
  pool: Pool,
  roadmapId: string,
  userId: string,
): Promise<Roadmap | null> {
  const head = await pool.query<{
    id: string;
    career_path_id: string;
    career_path_title: string;
    track_id: string | null;
    track_title: string | null;
    ai_rationale: string | null;
    weekly_hours: number | null;
  }>(
    `select r.id,
            r.career_path_id,
            cp.title  as career_path_title,
            r.track_id,
            t.title   as track_title,
            r.ai_rationale,
            r.weekly_hours
       from roadmaps r
       join career_paths cp on cp.id = r.career_path_id
       left join tracks t   on t.id = r.track_id
      where r.id = $1 and r.user_id = $2`,
    [roadmapId, userId],
  );
  if (!head.rows[0]) return null;
  const roadmap = head.rows[0];

  /**
   * Written by the worker when it planned this roadmap. Kept as its own query
   * rather than a join on the head: pg-mem does not run correlated subqueries
   * against an outer alias, and the tests build their database from the real
   * migration.
   */
  const aiOutput = await pool.query<{ id: string; flagged: boolean }>(
    `select o.id, (f.id is not null) as flagged
       from ai_outputs o
       left join ai_feedback_flags f
              on f.ai_output_id = o.id and f.user_id = $1
      where o.user_id = $1
        and o.source_type = 'roadmap_generation'
        and o.source_id = $2
      order by o.created_at desc
      limit 1`,
    [userId, roadmapId],
  );

  const items = await pool.query<ItemRow>(
    `select i.module_id,
            i.sort_order,
            i.source,
            i.added_reason,
            m.kind,
            m.technology_id,
            s.id    as skill_id,
            s.name  as skill_name,
            ps.layer,
            ps.sort_order as skill_sort,
            v.id          as published_version_id,
            v.version_no  as published_version_no,
            v.title,
            v.estimated_hours
       from roadmap_items i
       join modules m         on m.id = i.module_id
       join skills s          on s.id = m.skill_id
       join module_versions v on v.module_id = m.id and v.status = 'published'
       join path_skills ps    on ps.skill_id = s.id and ps.career_path_id = $2
      where i.roadmap_id = $1 and i.status = 'active'
      order by ps.layer, ps.sort_order, i.sort_order`,
    [roadmapId, roadmap.career_path_id],
  );

  /**
   * The lookups below all join back to `roadmap_items` rather than passing the
   * module ids back in as an array. One round trip fewer, and it keeps the
   * "which modules" definition in one place instead of repeating it per query.
   */
  const prerequisites = await pool.query<{ module_id: string; requires_module_id: string }>(
    `select mp.module_id, mp.requires_module_id
       from module_prerequisites mp
       join roadmap_items i on i.module_id = mp.module_id
      where i.roadmap_id = $1 and i.status = 'active'`,
    [roadmapId],
  );

  // §6 rule 7: one row per learner per module, read by every roadmap.
  const completions = await pool.query<{
    module_id: string;
    method: string;
    score: string | null;
  }>(
    `select module_id, method, score from module_completions where user_id = $1`,
    [userId],
  );

  const enrollments = await pool.query<{ module_id: string; module_version_id: string }>(
    `select module_id, module_version_id from module_enrollments where user_id = $1`,
    [userId],
  );

  const versionNumbers = await pool.query<{ id: string; version_no: number }>(
    `select v.id, v.version_no
       from module_versions v
       join roadmap_items i on i.module_id = v.module_id
      where i.roadmap_id = $1 and i.status = 'active'`,
    [roadmapId],
  );

  // "Also in" — every other career path that teaches the same module.
  const shared = await pool.query<{ module_id: string; career_path_id: string }>(
    `select psm.module_id, ps.career_path_id
       from path_skill_modules psm
       join path_skills ps     on ps.id = psm.path_skill_id
       join roadmap_items i    on i.module_id = psm.module_id
      where i.roadmap_id = $1 and i.status = 'active'
        and ps.career_path_id <> $2`,
    [roadmapId, roadmap.career_path_id],
  );

  const archived = await pool.query<{ id: string }>(
    `select m.id
       from modules m
       join roadmap_items i on i.module_id = m.id
      where i.roadmap_id = $1 and i.status = 'active' and m.status = 'archived'`,
    [roadmapId],
  );

  // --- Index everything --------------------------------------------------
  const requires = new Map<string, string[]>();
  for (const row of prerequisites.rows) {
    requires.set(row.module_id, [...(requires.get(row.module_id) ?? []), row.requires_module_id]);
  }
  const completedBy = new Map(completions.rows.map((r) => [r.module_id, r]));
  const enrolledIn = new Map(enrollments.rows.map((r) => [r.module_id, r.module_version_id]));
  const versionNoOf = new Map(versionNumbers.rows.map((r) => [r.id, r.version_no]));
  const sharedWith = new Map<string, string[]>();
  for (const row of shared.rows) {
    sharedWith.set(row.module_id, [...(sharedWith.get(row.module_id) ?? []), row.career_path_id]);
  }
  const isArchived = new Set(archived.rows.map((r) => r.id));

  /**
   * "You are here" is the module the learner has started and not finished. If
   * they have started nothing, it is the first one they could start — which is
   * what §5.6's Home screen and §8's "You are here" both point at.
   */
  const startedUnfinished = items.rows.find(
    (r) => enrolledIn.has(r.module_id) && !completedBy.has(r.module_id),
  );

  const unlocked = (moduleId: string): boolean =>
    (requires.get(moduleId) ?? []).every((req) => completedBy.has(req));

  const firstAvailable = startedUnfinished
    ? null
    : items.rows.find((r) => !completedBy.has(r.module_id) && unlocked(r.module_id));

  const currentModuleId = startedUnfinished?.module_id ?? firstAvailable?.module_id ?? null;

  function statusOf(row: ItemRow): ModuleStatus {
    if (isArchived.has(row.module_id)) return "archived";
    const done = completedBy.get(row.module_id);
    if (done) return done.method === "tested_out" ? "tested_out" : "passed";
    if (row.module_id === currentModuleId) return "current";
    return unlocked(row.module_id) ? "available" : "locked";
  }

  function toNode(row: ItemRow): RoadmapModuleNode {
    const enrolledVersionId = enrolledIn.get(row.module_id);
    const versionNo = enrolledVersionId
      ? (versionNoOf.get(enrolledVersionId) ?? row.published_version_no)
      : row.published_version_no;
    const done = completedBy.get(row.module_id);

    return {
      id: `m-${row.module_id}`,
      moduleId: row.module_id,
      versionNo,
      title: row.title,
      kind: row.kind,
      ...(row.technology_id ? { technologyOptionId: row.technology_id } : {}),
      status: statusOf(row),
      ...(done?.score != null ? { score: Number(done.score) } : {}),
      requires: requires.get(row.module_id) ?? [],
      sharedWithPaths: sharedWith.get(row.module_id) ?? [],
      ...(row.added_reason ? { addedReason: row.added_reason } : {}),
      // §6 rule 6: the learner keeps the version they took. A newer published
      // version is a notice, never a repointing.
      hasUpdate: enrolledVersionId !== undefined && enrolledVersionId !== row.published_version_id,
      estimatedHours: Number(row.estimated_hours),
    };
  }

  // --- Skill steps, in main-path order -----------------------------------
  const skillSteps: Extract<RoadmapStep, { type: "skill" }>[] = [];
  for (const row of items.rows) {
    let step = skillSteps.find((s) => s.skillId === row.skill_id);
    if (!step) {
      step = {
        type: "skill",
        id: `s-${row.skill_id}`,
        skillId: row.skill_id,
        title: row.skill_name,
        layer: row.layer,
        modules: [],
      };
      skillSteps.push(step);
    }
    step.modules.push(toNode(row));
  }

  // --- The technology decision -------------------------------------------
  const decisions = await pool.query<{
    decision_id: string;
    title: string;
    technology_id: string;
    technology_name: string;
    chosen_id: string | null;
    recommended_id: string | null;
  }>(
    `select d.id            as decision_id,
            d.title,
            o.technology_id,
            tech.name       as technology_name,
            c.technology_id             as chosen_id,
            c.recommended_technology_id as recommended_id
       from roadmap_technology_choices c
       join technology_decisions d on d.id = c.decision_id
       join decision_options o     on o.decision_id = d.id and o.status = 'published'
       join technologies tech      on tech.id = o.technology_id
      where c.roadmap_id = $1
      order by d.sort_order, d.title`,
    [roadmapId],
  );

  const decisionSteps: Extract<RoadmapStep, { type: "decision" }>[] = [];
  for (const row of decisions.rows) {
    let step = decisionSteps.find((d) => d.id === row.decision_id);
    if (!step) {
      step = {
        type: "decision",
        id: row.decision_id,
        title: row.title,
        options: [],
        ...(row.chosen_id ? { chosenOptionId: row.chosen_id } : {}),
        ...(row.recommended_id ? { recommendedOptionId: row.recommended_id } : {}),
      };
      decisionSteps.push(step);
    }
    step.options.push({ id: row.technology_id, name: row.technology_name, requires: [] });
  }

  // --- Milestones ---------------------------------------------------------
  const certificates = await pool.query<{ id: string; type: string }>(
    `select id, type from certificates
      where roadmap_id = $1 and user_id = $2 and status = 'valid'`,
    [roadmapId, userId],
  );
  const completionCertificate = certificates.rows.find((c) => c.type === "completion");
  const projectCertificate = certificates.rows.find((c) => c.type === "project");

  const allModules = skillSteps.flatMap((s) => s.modules);
  const passedCount = allModules.filter(
    (m) => m.status === "passed" || m.status === "tested_out",
  ).length;
  const everythingPassed = allModules.length > 0 && passedCount === allModules.length;

  const milestones: RoadmapStep[] = [
    {
      type: "certificate",
      id: `cert-${roadmapId}`,
      title: "Certificate of Completion",
      status: completionCertificate ? "earned" : everythingPassed ? "in_progress" : "locked",
      ...(completionCertificate ? { certificateId: completionCertificate.id } : {}),
    },
    {
      type: "capstone",
      id: `capstone-${roadmapId}`,
      title: "Capstone project",
      status: completionCertificate ? "in_progress" : "locked",
    },
    {
      type: "project_certificate",
      id: `project-cert-${roadmapId}`,
      title: "Project Certificate",
      status: projectCertificate ? "earned" : "locked",
      ...(projectCertificate ? { certificateId: projectCertificate.id } : {}),
    },
  ];

  /**
   * Main-path order, matching §2.1: core skills, the technology decision, then
   * the track's concept skills, then the milestones. The decision sits between
   * them because everything after it depends on the choice.
   */
  const core = skillSteps.filter((s) => s.layer === "core");
  const concept = skillSteps.filter((s) => s.layer === "concept");

  /**
   * The hours still to do, over the hours a week the learner said they have.
   * Rounded up — half a week of study is a week of calendar.
   */
  const remainingHours = allModules
    .filter((m) => m.status !== "passed" && m.status !== "tested_out")
    .reduce((n, m) => n + m.estimatedHours, 0);
  const weeklyHours = roadmap.weekly_hours;
  const estimatedWeeks =
    weeklyHours && weeklyHours > 0 ? Math.max(1, Math.ceil(remainingHours / weeklyHours)) : null;

  return {
    id: roadmap.id,
    careerPathId: roadmap.career_path_id,
    careerPathTitle: roadmap.career_path_title,
    trackId: roadmap.track_id,
    trackTitle: roadmap.track_title ?? "",
    pathColor: pathColor(roadmap.career_path_id),
    steps: [...core, ...decisionSteps, ...concept, ...milestones],
    passedCount,
    testedOutCount: allModules.filter((m) => m.status === "tested_out").length,
    totalCount: allModules.length,
    aiRationale: roadmap.ai_rationale,
    aiOutputId: aiOutput.rows[0]?.id ?? null,
    aiFlagged: aiOutput.rows[0]?.flagged ?? false,
    weeklyHours,
    estimatedWeeks,
  };
}
