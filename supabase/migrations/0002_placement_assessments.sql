-- =============================================================================
-- 0002 — Placement assessments
--
-- design.md §5.4: placement asks a learner what they already know, then checks
-- it. A rating on its own can never remove a module — a skipped module writes
-- no evidence, and every module on the Junior Web Developer path is required
-- for the certificate, so skipping one would make the certificate unreachable.
--
-- So placement's check produces real evidence: passing a skill's placement
-- quiz writes `module_completions` rows with `method = 'tested_out'`, exactly
-- as testing out of a single module does. Same table, same meaning, same
-- weight on the certificate.
--
-- **Why a skill-level assessment rather than one per module.** Batching every
-- module's own quiz at onboarding is 51 questions before the roadmap opens.
-- One quiz per skill, sized to the modules it covers, is ~25 — short enough to
-- sit before a learner has seen anything, long enough that a pass means
-- something.
-- =============================================================================

-- An assessment now belongs to EITHER a module version or a skill, never both
-- and never neither. Module quizzes keep the column they have always had; a
-- placement quiz sets `skill_id` instead.
alter table assessments alter column module_version_id drop not null;

alter table assessments
  add column skill_id uuid references skills (id) on delete restrict;

alter table assessments
  add constraint assessments_belong_to_one_owner
  check ((module_version_id is null) <> (skill_id is null));

-- A skill has at most one placement quiz. There is no versioning here on
-- purpose: a module's content is versioned because progress points at the
-- exact version taken (§6 rule 6), and a placement result points at the
-- modules it cleared rather than at the questions that cleared them.
create unique index assessments_one_placement_per_skill
  on assessments (skill_id) where skill_id is not null;

-- Which modules a pass clears is decided when it is graded, from the learner's
-- own roadmap — not stored here. The same Git placement quiz clears different
-- modules on different career paths, and a path that adds a Git module later
-- should not need its placement quiz reissued.

comment on column assessments.skill_id is
  'Set on a placement assessment; null on a module quiz. Exactly one of this and module_version_id is set.';
