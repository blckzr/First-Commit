import type { Pool } from "pg";
import { buildRoadmap, type Roadmap } from "../roadmaps/build.js";

/**
 * Home (design.md §5.6) answers one question: what do I do next?
 *
 * **It reuses `buildRoadmap` rather than recomputing.** "You are here" is
 * decided in one place, so Home and the roadmap chart can never disagree about
 * which module the learner is on — which is exactly the drift that makes a
 * dashboard untrustworthy. It costs a few more queries than a bespoke one;
 * Home is not a hot path, and agreeing is worth more than the milliseconds.
 */

export interface ContinuePanel {
  /**
   * Only `module` today. §5.6: "During the capstone, the Continue panel shows
   * the current milestone instead of a lesson" — a `milestone` variant joins
   * this union in Phase 4, and the exhaustive switch in the browser will refuse
   * to compile until it is rendered.
   */
  kind: "module";
  moduleId: string;
  moduleTitle: string;
  skillTitle: string;
  estimatedHours: number;
  /** 1-based, for "lesson 2 of 4". Null when the module has no lessons yet. */
  lessonNumber: number | null;
  lessonCount: number;
  lessonId: string | null;
  /** True once the learner has started; false means this is the next thing to pick up. */
  started: boolean;
}

export interface HomeUpdate {
  id: string;
  kind: "ai_added" | "module_updated";
  text: string;
  moduleId: string;
  /** design.md §7: AI output is always labelled as AI. */
  fromAi: boolean;
}

export interface HomeSummary {
  roadmap: {
    id: string;
    careerPathTitle: string;
    trackTitle: string;
    passedCount: number;
    totalCount: number;
  } | null;
  continue: ContinuePanel | null;
  updates: HomeUpdate[];
}

/** The module the roadmap says the learner is on. */
function currentModuleId(roadmap: Roadmap): string | null {
  for (const step of roadmap.steps) {
    if (step.type !== "skill") continue;
    const current = step.modules.find((m) => m.status === "current");
    if (current) return current.moduleId;
  }
  return null;
}

export async function buildHome(pool: Pool, userId: string): Promise<HomeSummary> {
  /**
   * The most recent active roadmap. §5.12 lets a learner keep several; Home
   * shows the one they are working on, and the roadmaps screen is where they
   * switch.
   */
  const active = await pool.query<{ id: string }>(
    `select id from roadmaps
      where user_id = $1 and status = 'active'
      order by created_at desc limit 1`,
    [userId],
  );

  if (!active.rows[0]) {
    // §5.6's empty state: "Choose a target job to build your first roadmap."
    return { roadmap: null, continue: null, updates: [] };
  }

  const roadmap = await buildRoadmap(pool, active.rows[0].id, userId);
  if (!roadmap) return { roadmap: null, continue: null, updates: [] };

  const summary: HomeSummary["roadmap"] = {
    id: roadmap.id,
    careerPathTitle: roadmap.careerPathTitle,
    trackTitle: roadmap.trackTitle,
    passedCount: roadmap.passedCount,
    totalCount: roadmap.totalCount,
  };

  const moduleId = currentModuleId(roadmap);
  const next = moduleId ? await continuePanel(pool, moduleId, userId) : null;
  const updates = await buildUpdates(pool, roadmap, userId);

  return { roadmap: summary, continue: next, updates };
}

async function continuePanel(
  pool: Pool,
  moduleId: string,
  userId: string,
): Promise<ContinuePanel | null> {
  /**
   * The learner's own version if they have started, otherwise the published
   * one — the same rule as the module page (§6 rule 6).
   */
  const head = await pool.query<{
    version_id: string;
    title: string;
    estimated_hours: string;
    skill_title: string;
    enrolled: string | null;
    current_lesson_id: string | null;
  }>(
    `select coalesce(e.module_version_id, pub.id)             as version_id,
            coalesce(ev.title, pub.title)                     as title,
            coalesce(ev.estimated_hours, pub.estimated_hours) as estimated_hours,
            s.name                                            as skill_title,
            e.module_version_id                               as enrolled,
            e.current_lesson_id
       from modules m
       join skills s on s.id = m.skill_id
       left join module_versions pub  on pub.module_id = m.id and pub.status = 'published'
       left join module_enrollments e on e.module_id = m.id and e.user_id = $2
       left join module_versions ev   on ev.id = e.module_version_id
      where m.id = $1`,
    [moduleId, userId],
  );
  if (!head.rows[0]?.version_id) return null;
  const row = head.rows[0];

  const lessons = await pool.query<{ id: string; sort_order: number }>(
    `select id, sort_order from lessons where module_version_id = $1 order by sort_order`,
    [row.version_id],
  );

  const at = row.current_lesson_id
    ? lessons.rows.findIndex((l) => l.id === row.current_lesson_id)
    : -1;
  // Not started, or the bookmark points at a lesson this version no longer has:
  // either way the first lesson is where to go.
  const index = at >= 0 ? at : 0;

  return {
    kind: "module",
    moduleId,
    moduleTitle: row.title,
    skillTitle: row.skill_title,
    estimatedHours: Number(row.estimated_hours),
    lessonNumber: lessons.rows.length > 0 ? index + 1 : null,
    lessonCount: lessons.rows.length,
    lessonId: lessons.rows[index]?.id ?? null,
    started: row.enrolled !== null,
  };
}

/**
 * §5.6's Updates panel.
 *
 * **Derived, not read from `notifications`.** These are statements about the
 * roadmap as it stands right now — "the AI added this", "a module you passed
 * moved on" — which stay true until the learner acts on them. `notifications`
 * is an event log, and §5.17's screen is where a history belongs; reading it
 * here would show an event that has since been dealt with.
 */
async function buildUpdates(
  pool: Pool,
  roadmap: Roadmap,
  userId: string,
): Promise<HomeUpdate[]> {
  const updates: HomeUpdate[] = [];

  // Reinforcement and challenge modules the Roadmap AI added, with its reason.
  // §5.6's own example is exactly this.
  const added = await pool.query<{
    module_id: string;
    added_reason: string;
    title: string;
    source: string;
  }>(
    `select i.module_id, i.added_reason, v.title, i.source
       from roadmap_items i
       join module_versions v on v.module_id = i.module_id and v.status = 'published'
      where i.roadmap_id = $1
        and i.status = 'active'
        and i.source in ('reinforcement', 'challenge')
        and i.added_reason is not null
      order by i.created_at desc`,
    [roadmap.id],
  );

  for (const row of added.rows) {
    updates.push({
      id: `added-${row.module_id}`,
      kind: "ai_added",
      text:
        row.source === "challenge"
          ? `${row.title} was added to your roadmap as a challenge. ${row.added_reason}`
          : `${row.title} was added to your roadmap for extra practice. ${row.added_reason}`,
      moduleId: row.module_id,
      // §7: AI output is labelled as AI, and carries a short reason.
      fromAi: true,
    });
  }

  /**
   * A module the learner completed whose published version has since moved on.
   * §5.9: their credit stays — this is a notice, never a repointing
   * (§6 rule 6).
   */
  const updated = await pool.query<{ module_id: string; title: string }>(
    `select c.module_id, v.title
       from module_completions c
       join module_versions taken on taken.id = c.module_version_id
       join module_versions v     on v.module_id = c.module_id and v.status = 'published'
       join roadmap_items i       on i.module_id = c.module_id and i.roadmap_id = $2
      where c.user_id = $1 and v.id <> c.module_version_id`,
    [userId, roadmap.id],
  );

  for (const row of updated.rows) {
    updates.push({
      id: `updated-${row.module_id}`,
      kind: "module_updated",
      text: `${row.title} was updated after you passed it. Your credit stays — see what changed.`,
      moduleId: row.module_id,
      fromAi: false,
    });
  }

  return updates;
}
