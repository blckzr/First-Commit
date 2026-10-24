import type { Pool, PoolClient } from "pg";

/**
 * Integrity signals (`project-proposal.md` §6, `database-schema.md` §7).
 *
 * ### These are questions, not verdicts
 *
 * A flag means "an admin should look at this", never "this learner cheated".
 * Every one of the signals below has an innocent explanation — somebody who
 * builds offline and pushes once at the end has a single commit and has done
 * nothing wrong. §6 rule 10 is the same principle from the other side: an admin
 * cannot mark a module passed or edit a score, only record a reasoned override.
 *
 * So raising a flag **changes nothing for the learner**. The milestone still
 * passed, the certificate is still issued, and nothing on their screen moves.
 * The alternative — withholding a certificate on suspicion — would punish the
 * majority who are simply working in an unusual order.
 *
 * ### §6 rule 2 names integrity flags explicitly
 *
 * They are admin-only. Nothing in a learner response may reveal that a project
 * was flagged, which is also why detection is kept out of `readMilestones()`
 * and lives here: there is no path from a learner endpoint to this file's
 * output, only to its side effects.
 *
 * ### Raised when the project completes
 *
 * Which is the moment the question matters — a Project Certificate is about to
 * be issued, and §6.7's review exists to decide whether it should stand.
 * Running on every push would flag a project five times for the same thing and
 * give an admin five rows to dismiss.
 */

export type IntegrityType = "single_commit" | "similarity" | "weak_explanation" | "other";

export interface DetectedFlag {
  type: IntegrityType;
  details: Record<string, unknown>;
}

/**
 * How short an explanation has to be before it is worth a second look.
 *
 * §5.14 asks for "a few sentences". Forty characters is below any honest
 * attempt at that and well clear of a terse but real answer — the number is
 * deliberately generous, because a false flag costs an admin's attention and a
 * learner's benefit of the doubt.
 */
const SHORT_ANSWER = 40;

/**
 * Looks at a finished project and records anything an admin should see.
 *
 * Idempotent by `(project, type)`: re-running never adds a second row for the
 * same signal, so the completion read can happen as often as it likes. A flag
 * an admin has already **decided** is never reopened either — that would undo
 * their judgement silently.
 */
export async function flagProject(
  db: Pool | PoolClient,
  projectId: string,
): Promise<DetectedFlag[]> {
  const found: DetectedFlag[] = [];

  found.push(...(await singleCommit(db, projectId)));
  found.push(...(await weakExplanations(db, projectId)));

  for (const flag of found) {
    /**
     * `where not exists` rather than `on conflict`: there is no unique index on
     * `(project_id, type)`, and adding one would stop a second similarity flag
     * against a different project, which is a real thing to want later.
     */
    await db.query(
      /**
       * The enum cast is explicit. PostgreSQL would infer it for a parameter,
       * pg-mem will not — "column type is of type integrity_flag_type but
       * expression is of type text" — and an `insert … select` is where that
       * difference shows up. Being explicit is better SQL either way.
       */
      `insert into integrity_flags (project_id, type, details)
       select $1, $2::integrity_flag_type, $3::jsonb
        where not exists (
          select 1 from integrity_flags
           where project_id = $1 and type = $2::integrity_flag_type
        )`,
      [projectId, flag.type, JSON.stringify(flag.details)],
    );
  }

  return found;
}

/**
 * The whole project arrived in one or two pushes.
 *
 * **The most common innocent case in this whole file.** A learner who builds
 * offline for a week and pushes once has done the work; a learner who pasted
 * somebody's finished repository looks identical from here. That is precisely
 * why this raises a question for a person rather than a decision.
 *
 * Counted against milestones, not against a fixed number: a five-milestone
 * brief built in two commits is odd, a two-milestone one is not.
 */
async function singleCommit(
  db: Pool | PoolClient,
  projectId: string,
): Promise<DetectedFlag[]> {
  const { rows } = await db.query<{ commits: string; milestones: string }>(
    `select
       (select count(*) from project_commits where project_id = $1) as commits,
       (select count(*) from milestones m
          join capstone_projects p on p.brief_version_id = m.brief_version_id
         where p.id = $1) as milestones`,
    [projectId],
  );

  const commits = Number(rows[0]?.commits ?? 0);
  const milestones = Number(rows[0]?.milestones ?? 0);

  // Fewer pushes than half the milestones, and at least three milestones — so a
  // short brief is never flagged for being short.
  if (milestones < 3 || commits === 0 || commits > Math.floor(milestones / 2)) return [];

  return [{ type: "single_commit", details: { commits, milestones } }];
}

/**
 * An explanation answer that does not answer.
 *
 * §5.14: the answer "is saved for admin review if the project is flagged" — it
 * is **not graded**, and nothing here changes a milestone. A learner who writes
 * two words is not failed for it; an admin is given the answer and the question
 * side by side and decides what it means.
 */
async function weakExplanations(
  db: Pool | PoolClient,
  projectId: string,
): Promise<DetectedFlag[]> {
  const { rows } = await db.query<{
    milestone_id: string;
    title: string;
    explanation_answer: string | null;
  }>(
    `select a.milestone_id, m.title, a.explanation_answer
       from milestone_attempts a
       join milestones m on m.id = a.milestone_id
      where a.project_id = $1
        and a.status = 'complete'
        and m.explanation_question is not null`,
    [projectId],
  );

  /**
   * **An unanswered question is not a weak answer.**
   *
   * Nothing requires an answer — the checks decide a milestone, and §5.14's
   * question is asked beside them rather than gating them. So a null would
   * flag very nearly every project, and a signal that fires on everyone tells
   * an admin nothing. Only an answer somebody actually wrote is judged.
   */
  const weak = rows.filter((row) => {
    const answer = (row.explanation_answer ?? "").trim();
    return answer.length > 0 && answer.length < SHORT_ANSWER;
  });
  if (weak.length === 0) return [];

  return [
    {
      type: "weak_explanation",
      details: {
        milestones: weak.map((row) => ({
          milestoneId: row.milestone_id,
          title: row.title,
          /**
           * The length, not the text. An admin reads the answer on the review
           * screen from the row it lives in; copying it here would duplicate a
           * learner's words into a second place that has to be kept in step.
           */
          answerLength: (row.explanation_answer ?? "").trim().length,
        })),
      },
    },
  ];
}
