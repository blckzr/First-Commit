import type { Pool, PoolClient } from "pg";

/**
 * What a learner has actually proved (design.md §5.16, AGENT.md §7).
 *
 * **This file is the resume's honesty.** §5.16: "The evidence panel lists only
 * verified items; learners choose which to include but cannot add unverified
 * skills." Everything the Resume AI is shown, and everything a resume may
 * contain, comes from here — so nothing else needs to police it, and nothing
 * else gets the chance to let something through.
 *
 * The stakes are higher than the other two AI components. A roadmap that picks
 * a wrong module wastes a week; a hint that leaks a solution spoils one
 * exercise. **A resume goes to an employer**, and a skill nobody earned is a
 * claim made on a real person's behalf to someone deciding whether to hire
 * them. §7 states the rule twice for that reason: unsupported skills are
 * removed, and "module completion is a *skill*, never *experience*".
 */

export interface VerifiedSkill {
  skillId: string;
  name: string;
  /** How many modules in this skill are complete, for ordering and copy. */
  moduleCount: number;
  /**
   * `passed` if any module was worked through, otherwise `tested_out`. A skill
   * proved only by placement is still verified — §6 rule 7 — and saying which
   * is honest without being self-defeating.
   */
  method: "passed" | "tested_out";
}

export interface VerifiedCertificate {
  publicCode: string;
  title: string;
  issuedAt: Date;
}

export interface VerifiedProject {
  id: string;
  title: string;
  repoFullName: string | null;
  demoUrl: string | null;
  technology: string | null;
  completedAt: Date;
}

export interface Evidence {
  skills: VerifiedSkill[];
  certificates: VerifiedCertificate[];
  /**
   * Completed capstones only. §7: "No capstone means no Projects section", so
   * this being empty is the normal state until Phase 4 exists — not a gap to
   * paper over with module work, which would turn a skill into experience.
   */
  projects: VerifiedProject[];
}

export async function readEvidence(db: Pool | PoolClient, userId: string): Promise<Evidence> {
  /**
   * A skill is verified when a module in it is complete. `modules.skill_id` is
   * the link, and `module_completions` is the proof — the same rows the
   * certificate check reads, so the resume and the certificate can never
   * disagree about what someone knows.
   */
  const skills = await db.query<{
    skill_id: string;
    name: string;
    module_count: string;
    worked: boolean;
  }>(
    `select s.id as skill_id,
            s.name,
            count(*) as module_count,
            bool_or(mc.method <> 'tested_out') as worked
       from module_completions mc
       join modules m on m.id = mc.module_id
       join skills s on s.id = m.skill_id
      where mc.user_id = $1
      group by s.id, s.name
      order by count(*) desc, s.name`,
    [userId],
  );

  const certificates = await db.query<{
    public_code: string;
    title: string;
    issued_at: Date;
  }>(
    `select public_code, title, issued_at
       from certificates
      where user_id = $1 and status = 'valid'
      order by issued_at desc`,
    [userId],
  );

  /**
   * Only a finished capstone counts. A project in progress is not experience,
   * and `completed_at is not null` is the whole test — there is no partial
   * credit on a portfolio piece.
   */
  const projects = await db.query<{
    id: string;
    title: string;
    repo_full_name: string | null;
    demo_url: string | null;
    technology: string | null;
    completed_at: Date;
  }>(
    `select p.id,
            bv.title,
            p.repo_full_name,
            p.demo_url,
            t.name as technology,
            p.completed_at
       from capstone_projects p
       join capstone_brief_versions bv on bv.id = p.brief_version_id
       left join technologies t on t.id = p.technology_id
      where p.user_id = $1 and p.completed_at is not null
      order by p.completed_at desc`,
    [userId],
  );

  return {
    skills: skills.rows.map((r) => ({
      skillId: r.skill_id,
      name: r.name,
      moduleCount: Number(r.module_count),
      method: r.worked ? "passed" : "tested_out",
    })),
    certificates: certificates.rows.map((r) => ({
      publicCode: r.public_code,
      title: r.title,
      issuedAt: r.issued_at,
    })),
    projects: projects.rows.map((r) => ({
      id: r.id,
      title: r.title,
      repoFullName: r.repo_full_name,
      demoUrl: r.demo_url,
      technology: r.technology,
      completedAt: r.completed_at,
    })),
  };
}

/*
 * **Grounding lives in the worker**, beside the prompt: `groundSkills` and
 * `groundProjects` in `apps/worker/src/resume/index.ts`. They filter model
 * output, which is the worker's half of §7 — the same place `noSolutionLeak`
 * sits. This file's job is to say what is true; the worker's is to make sure the
 * model did not say anything else.
 */
