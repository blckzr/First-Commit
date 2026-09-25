import type { Pool, PoolClient } from "pg";
import { randomBytes } from "node:crypto";

/**
 * Issuing a Certificate of Completion (design.md §5.15, proposal §3).
 *
 * **The backend checks the requirements itself** — AGENT.md §6 rule 1, and the
 * sharpest case of it. `certificates` is the last of the four evidence tables to
 * be written, and the only one where a browser could plausibly ask nicely: there
 * is **no endpoint that issues a certificate**. Nothing takes a roadmap id and
 * grants anything. This function reads completions the platform wrote and
 * decides for itself.
 *
 * ### What earns one
 *
 * Proposal §3: "Completing the roadmap (core, track, and technology modules)".
 * In schema terms, every **active** item on the roadmap whose module is
 * `required_for_certificate` must have a `module_completions` row for that
 * learner. `method` does not matter — §6 rule 7 means testing out counts, and
 * placement writes `tested_out` rows that are real evidence.
 *
 * Two things that look like completion and are not:
 *
 * - **A roadmap with no items.** "Every one of zero modules is complete" is
 *   vacuously true, and would hand a certificate to a roadmap that was never
 *   generated. There is such a roadmap in the development database already.
 * - **An unchosen technology.** §3 counts technology modules, and those only
 *   join the roadmap once the learner picks a framework. A roadmap with an open
 *   `roadmap_technology_choices` row is incomplete by construction, however many
 *   of its current items are done.
 *
 * Reinforcement and challenge modules are excluded by `required_for_certificate`
 * rather than by their source, because that is the column the schema gives for
 * saying "this one is extra".
 */

export type CertificateType = "completion" | "project";

export interface IssuedCertificate {
  id: string;
  publicCode: string;
  type: CertificateType;
  roadmapId: string;
  title: string;
  recipientName: string;
  skills: string[];
  issuedAt: Date;
}

/** Why a roadmap has not earned one, for the screen to explain (§5.15). */
export interface CertificateProgress {
  roadmapId: string;
  title: string;
  required: number;
  completed: number;
  /** Set when the roadmap cannot be finished as it stands. */
  blockedBy: "no-modules" | "technology-not-chosen" | null;
}

/**
 * `FC-7K2M-94QX` (§5.15).
 *
 * Crockford's alphabet without the ambiguous letters, so a code read off a
 * printed certificate or a QR code cannot be mistyped as a different valid one —
 * no `I`/`1`, `O`/`0`, or `U`. `randomBytes` rather than `Math.random`: this is
 * the public handle on somebody's credential, and a guessable one would let
 * anybody enumerate certificates.
 */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function newPublicCode(): string {
  const bytes = randomBytes(8);
  const pick = (i: number) => ALPHABET[bytes[i] % ALPHABET.length];
  const block = (start: number) => [0, 1, 2, 3].map((n) => pick(start + n)).join("");
  return `FC-${block(0)}-${block(4)}`;
}

interface RoadmapRow {
  id: string;
  career_path_title: string;
  track_title: string | null;
}

/**
 * Every active roadmap for a learner, with what it still needs.
 *
 * **Four flat queries merged here rather than one with subqueries.** pg-mem does
 * not run a correlated subquery against an outer alias, and the tests build their
 * schema from the real migration — the first version of this joined
 * `path_skills` on `r.career_path_id` inside a subquery and failed with `column
 * "r.career_path_id" does not exist`. `buildRoadmap` and the roadmap list solve
 * it the same way.
 */
async function roadmapStates(
  db: Pool | PoolClient,
  userId: string,
): Promise<CertificateProgress[]> {
  const heads = await db.query<RoadmapRow>(
    `select r.id, cp.title as career_path_title, t.title as track_title
       from roadmaps r
       join career_paths cp on cp.id = r.career_path_id
       left join tracks t on t.id = r.track_id
      where r.user_id = $1 and r.status <> 'archived'`,
    [userId],
  );
  if (heads.rows.length === 0) return [];

  /**
   * The modules that count. `required_for_certificate` is the column that says
   * "this one is extra", which is how reinforcement and challenge modules stay
   * optional without a separate rule about their source.
   */
  const required = await db.query<{ roadmap_id: string; module_id: string }>(
    `select i.roadmap_id, i.module_id
       from roadmap_items i
       join roadmaps r on r.id = i.roadmap_id
       join path_skills ps on ps.career_path_id = r.career_path_id
       join path_skill_modules psm
         on psm.module_id = i.module_id and psm.path_skill_id = ps.id
      where r.user_id = $1 and i.status = 'active' and psm.required_for_certificate`,
    [userId],
  );

  const completed = await db.query<{ module_id: string }>(
    `select module_id from module_completions where user_id = $1`,
    [userId],
  );
  const done = new Set(completed.rows.map((r) => r.module_id));

  /** An unanswered decision, and the name of an answered one for the title. */
  const choices = await db.query<{
    roadmap_id: string;
    technology_id: string | null;
    name: string | null;
  }>(
    `select c.roadmap_id, c.technology_id, tech.name
       from roadmap_technology_choices c
       join roadmaps r on r.id = c.roadmap_id
       left join technologies tech on tech.id = c.technology_id
      where r.user_id = $1`,
    [userId],
  );

  return heads.rows.map((head) => {
    /** Distinct, because a module can sit under more than one path skill. */
    const modules = new Set(
      required.rows.filter((r) => r.roadmap_id === head.id).map((r) => r.module_id),
    );
    const mine = choices.rows.filter((c) => c.roadmap_id === head.id);
    const technology = mine.find((c) => c.name)?.name ?? null;

    return progressOf({
      id: head.id,
      title: titleOf(head, technology),
      required: modules.size,
      completed: [...modules].filter((m) => done.has(m)).length,
      openChoices: mine.filter((c) => c.technology_id === null).length,
    });
  });
}

/** §5.15's heading: "Junior Web Developer, Frontend track with React". */
function titleOf(row: RoadmapRow, technology: string | null): string {
  const parts = [row.career_path_title];
  if (row.track_title) parts.push(`${row.track_title} track`);
  const head = parts.join(", ");
  return technology ? `${head} with ${technology}` : head;
}

function progressOf(input: {
  id: string;
  title: string;
  required: number;
  completed: number;
  openChoices: number;
}): CertificateProgress {
  return {
    roadmapId: input.id,
    title: input.title,
    required: input.required,
    completed: input.completed,
    /**
     * Two things that look like completion and are not — see the note at the top
     * of this file. Order matters only for the message: a roadmap with no modules
     * is reported as empty rather than as waiting on a technology.
     */
    blockedBy:
      input.required === 0
        ? "no-modules"
        : input.openChoices > 0
          ? "technology-not-chosen"
          : null,
  };
}

const earned = (p: CertificateProgress) =>
  p.blockedBy === null && p.required > 0 && p.completed >= p.required;

/**
 * Issues any Certificate of Completion the learner has earned and does not yet
 * hold, and reports where every roadmap stands.
 *
 * **Idempotent, and safe to call on a read.** The three places that write
 * completions are quiz grading, placement, and the worker's exercise run — and
 * the worker is a different process, so it cannot call this. Rather than have
 * two processes racing to issue, this runs whenever the learner's certificates
 * are read, which is the same backstop shape §8.4 uses for missed SSE notices: a
 * certificate may be recorded a moment after it was earned, never missed.
 *
 * `skills` is a snapshot, like `recipient_name`. A certificate has to keep saying
 * what it said the day it was issued, even if the career path is edited later.
 */
export async function syncCertificates(
  db: Pool | PoolClient,
  userId: string,
): Promise<{ issued: IssuedCertificate[]; progress: CertificateProgress[] }> {
  const states = await roadmapStates(db, userId);

  const held = await db.query<{ roadmap_id: string }>(
    `select roadmap_id from certificates
      where user_id = $1 and type = 'completion' and status <> 'revoked'`,
    [userId],
  );
  const alreadyHas = new Set(held.rows.map((r) => r.roadmap_id));

  const issued: IssuedCertificate[] = [];

  for (const state of states) {
    if (!earned(state) || alreadyHas.has(state.roadmapId)) continue;

    const name = await db.query<{ full_name: string }>(
      `select full_name from users where id = $1`,
      [userId],
    );
    if (!name.rows[0]) break;

    /**
     * The verified skills, as they stand now. Only skills the learner actually
     * completed a module in — §7's resume rule applied here too: nothing on a
     * certificate that no evidence supports.
     */
    const skills = await db.query<{ name: string }>(
      `select distinct s.name
         from roadmap_items i
         join modules m on m.id = i.module_id
         join skills s on s.id = m.skill_id
         join module_completions mc on mc.module_id = i.module_id and mc.user_id = $2
        where i.roadmap_id = $1 and i.status = 'active'
        order by s.name`,
      [state.roadmapId, userId],
    );

    const row = await insertWithUniqueCode(db, {
      userId,
      roadmapId: state.roadmapId,
      recipientName: name.rows[0].full_name,
      title: state.title,
      skills: skills.rows.map((s) => s.name),
    });
    if (row) issued.push(row);
  }

  return { issued, progress: states };
}

/**
 * `public_code` is unique, so a collision is possible however unlikely.
 *
 * Retried rather than assumed: `on conflict (public_code) do nothing` would
 * silently issue nothing, and a learner who finished their roadmap would see no
 * certificate and no reason. Three attempts over a 32^8 space is ample.
 */
async function insertWithUniqueCode(
  db: Pool | PoolClient,
  input: {
    userId: string;
    roadmapId: string;
    recipientName: string;
    title: string;
    skills: string[];
  },
): Promise<IssuedCertificate | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = newPublicCode();
    const inserted = await db.query<{ id: string; issued_at: Date }>(
      `insert into certificates
         (public_code, user_id, type, roadmap_id, recipient_name, title, details)
       values ($1, $2, 'completion', $3, $4, $5, $6)
       on conflict (public_code) do nothing
       returning id, issued_at`,
      [
        code,
        input.userId,
        input.roadmapId,
        input.recipientName,
        input.title,
        JSON.stringify({ skills: input.skills }),
      ],
    );

    if (inserted.rows[0]) {
      return {
        id: inserted.rows[0].id,
        publicCode: code,
        type: "completion",
        roadmapId: input.roadmapId,
        title: input.title,
        recipientName: input.recipientName,
        skills: input.skills,
        issuedAt: inserted.rows[0].issued_at,
      };
    }
  }
  return null;
}
