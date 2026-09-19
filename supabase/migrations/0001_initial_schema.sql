-- =============================================================================
-- First Commit: Database Schema
-- PostgreSQL 15+ (hosted on Supabase; any PostgreSQL host works)
--
-- The database is reached ONLY by the Express backend and the local AI worker.
-- No browser connects to it directly, so every permission check lives in the
-- backend (see Section 11 and database-schema.md).
--
-- Run with your migration tool, or paste into the Supabase SQL Editor.
--
-- Sections
--   1. Extensions, enums, helpers
--   2. Accounts, sessions, and learner profiles
--   3. Curriculum (career paths, skills, tracks, technologies, modules)
--   4. Assessments
--   5. Roadmaps and progress
--   6. AI jobs and feedback
--   7. Capstone projects and GitHub
--   8. Certificates and resumes
--   9. Notifications, settings, activity log
--  10. Functions (job queue, housekeeping)
--  11. Database roles and grants
-- =============================================================================


-- =============================================================================
-- 1. Extensions, enums, helpers
-- =============================================================================

-- gen_random_uuid() is built into PostgreSQL 13+, so no extension is required.

create type app_role           as enum ('learner', 'admin');
create type account_status     as enum ('active', 'suspended');
create type content_status     as enum ('draft', 'published', 'archived');
create type version_status     as enum ('draft', 'published', 'superseded', 'archived');
create type skill_layer        as enum ('core', 'concept');
create type module_kind        as enum ('core', 'concept', 'technology', 'reinforcement', 'challenge');
create type assessment_type    as enum ('quiz', 'code');
create type code_runtime       as enum ('javascript', 'python', 'react', 'vue');
create type roadmap_status     as enum ('active', 'completed', 'archived');
create type roadmap_item_source as enum ('generated', 'learner_added', 'reinforcement', 'challenge');
create type roadmap_item_status as enum ('active', 'removed');
create type completion_method  as enum ('passed', 'tested_out', 'override');
create type submission_status  as enum ('queued', 'running', 'completed', 'error');
create type ai_job_type        as enum ('roadmap_generation', 'roadmap_adaptation', 'technology_recommendation',
                                        'code_feedback', 'milestone_review', 'resume_generation');
create type job_status         as enum ('queued', 'running', 'completed', 'failed');
create type flag_status        as enum ('open', 'confirmed_wrong', 'confirmed_correct');
create type check_type         as enum ('file_exists', 'workflow_test', 'deployment_url');
create type project_status     as enum ('connecting', 'in_progress', 'completed', 'rejected');
create type attempt_status     as enum ('checking', 'failed', 'complete');
create type integrity_flag_type as enum ('single_commit', 'similarity', 'weak_explanation', 'other');
create type integrity_status   as enum ('open', 'cleared', 'explanation_requested', 'redo_requested', 'rejected');
create type certificate_type   as enum ('completion', 'project');
create type certificate_status as enum ('valid', 'revoked', 'reissued');

-- Keeps updated_at current on every update.
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;


-- =============================================================================
-- 2. Accounts, sessions, and learner profiles
--
-- Authentication is handled by the Express backend. If you use an auth library
-- (for example Better Auth), it generates equivalent tables; in that case drop
-- users, sessions, email_verification_tokens and password_reset_tokens below and
-- point the rest of the schema at the library's user table instead.
-- =============================================================================

create table users (
  id                uuid primary key default gen_random_uuid(),
  email             text not null,                   -- Unique case-insensitively (index below)
  password_hash     text not null,                  -- argon2id or bcrypt; never plain text
  full_name         text not null,                  -- Used on certificates
  role              app_role not null default 'learner',
  status            account_status not null default 'active',
  email_verified_at timestamptz,
  last_login_at     timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Sessions live in the database, not in memory, so they survive restarts
-- (Render free services restart often) and work with more than one instance.
-- Emails differing only by case are the same account.
create unique index users_email_unique on users (lower(email));

create table sessions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users (id) on delete cascade,
  token_hash   text not null unique,                -- Store a hash, never the cookie value
  user_agent   text,
  ip_address   inet,
  expires_at   timestamptz not null,
  created_at   timestamptz not null default now()
);
create index sessions_user on sessions (user_id);
create index sessions_expiry on sessions (expires_at);

create table email_verification_tokens (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users (id) on delete cascade,
  token_hash  text not null unique,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);

create table password_reset_tokens (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users (id) on delete cascade,
  token_hash  text not null unique,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index password_reset_tokens_user on password_reset_tokens (user_id);

-- Counts failed logins and password reset requests, so the backend can slow
-- down or lock an account under attack.
create table auth_attempts (
  id           bigint generated always as identity primary key,
  email        text,
  ip_address   inet,
  kind         text not null,                       -- 'login', 'reset_request'
  succeeded    boolean not null,
  created_at   timestamptz not null default now()
);
create index auth_attempts_recent on auth_attempts (lower(email), created_at desc);

create table learner_profiles (
  user_id                 uuid primary key references users (id) on delete cascade,
  experience_level        text,                    -- e.g., 'none', 'some', 'comfortable'
  goal                    text,                    -- e.g., 'company_job', 'freelance'
  weekly_hours            smallint check (weekly_hours between 1 and 40),
  survey_answers          jsonb not null default '{}',
  onboarding_step         text not null default 'about',   -- about, target, placement, generating, done
  onboarding_completed_at timestamptz,
  updated_at              timestamptz not null default now()
);

-- Personal details used only on the resume.
create table resume_details (
  user_id     uuid primary key references users (id) on delete cascade,
  email       text,
  phone       text,
  city        text,
  links       jsonb not null default '[]',         -- [{label, url}]
  education   jsonb not null default '[]',         -- [{school, degree, start, end}]
  updated_at  timestamptz not null default now()
);

create table github_connections (
  user_id          uuid primary key references users (id) on delete cascade,
  github_user_id   bigint not null unique,
  github_username  text not null,
  installation_id  bigint not null,                -- GitHub App installation
  connected_at     timestamptz not null default now()
);


-- =============================================================================
-- 3. Curriculum
-- =============================================================================

create table career_paths (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique,
  title        text not null,
  description  text not null default '',
  status       content_status not null default 'draft',
  published_at timestamptz,
  created_by   uuid references users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table skills (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique,
  name         text not null,
  description  text not null default '',
  created_at   timestamptz not null default now()
);

-- Global list of technologies, reused across tracks (React is in Frontend and Full-stack).
create table technologies (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique,               -- 'react', 'vue', 'express', 'django'
  name         text not null,
  description  text not null default '',
  created_at   timestamptz not null default now()
);

create table technology_prerequisites (
  technology_id          uuid not null references technologies (id) on delete cascade,
  requires_technology_id uuid not null references technologies (id) on delete cascade,
  primary key (technology_id, requires_technology_id),
  check (technology_id <> requires_technology_id)
);

create table tracks (
  id             uuid primary key default gen_random_uuid(),
  career_path_id uuid not null references career_paths (id) on delete cascade,
  title          text not null,                    -- 'Frontend'
  description    text not null default '',
  audience       text not null default '',         -- Who it is for; read by the Roadmap AI
  status         content_status not null default 'draft',
  sort_order     smallint not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (career_path_id, title)
);

-- A decision point in a track. Full-stack has two: frontend and backend.
create table technology_decisions (
  id          uuid primary key default gen_random_uuid(),
  track_id    uuid not null references tracks (id) on delete cascade,
  title       text not null,                       -- 'Choose your framework'
  sort_order  smallint not null default 0
);

create table decision_options (
  decision_id    uuid not null references technology_decisions (id) on delete cascade,
  technology_id  uuid not null references technologies (id) on delete restrict,
  comparison     jsonb not null default '{}',      -- Learning curve, use cases, job demand
  status         content_status not null default 'draft',
  primary key (decision_id, technology_id)
);

-- Places a skill in a career path. track_id null = core skill.
create table path_skills (
  id             uuid primary key default gen_random_uuid(),
  career_path_id uuid not null references career_paths (id) on delete cascade,
  track_id       uuid references tracks (id) on delete cascade,
  skill_id       uuid not null references skills (id) on delete restrict,
  layer          skill_layer not null,
  sort_order     smallint not null default 0,
  unique nulls not distinct (career_path_id, track_id, skill_id),   -- PostgreSQL 15+
  check ((layer = 'core' and track_id is null) or (layer = 'concept' and track_id is not null))
);

create table modules (
  id                 uuid primary key default gen_random_uuid(),
  skill_id           uuid not null references skills (id) on delete restrict,
  kind               module_kind not null,
  technology_id      uuid references technologies (id) on delete restrict,
  slug               text not null unique,
  status             content_status not null default 'draft',
  created_by         uuid references users (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check ((kind = 'technology') = (technology_id is not null))
);

create table module_versions (
  id               uuid primary key default gen_random_uuid(),
  module_id        uuid not null references modules (id) on delete cascade,
  version_no       integer not null check (version_no > 0),
  title            text not null,
  description      text not null default '',
  estimated_hours  numeric(4,1) not null default 1,
  status           version_status not null default 'draft',
  change_summary   text not null default '',         -- "What's new" shown to learners
  published_at     timestamptz,
  published_by     uuid references users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (module_id, version_no)
);
-- At most one published version per module.
create unique index module_versions_one_published
  on module_versions (module_id) where status = 'published';

create table lessons (
  id                uuid primary key default gen_random_uuid(),
  module_version_id uuid not null references module_versions (id) on delete cascade,
  sort_order        smallint not null,
  title             text not null,
  content           jsonb not null default '{}',     -- Rich text document
  unique (module_version_id, sort_order)
);

create table module_prerequisites (
  module_id          uuid not null references modules (id) on delete cascade,
  requires_module_id uuid not null references modules (id) on delete cascade,
  primary key (module_id, requires_module_id),
  check (module_id <> requires_module_id)
);

-- Attaches modules to a skill within a career path.
create table path_skill_modules (
  path_skill_id               uuid not null references path_skills (id) on delete cascade,
  module_id                   uuid not null references modules (id) on delete restrict,
  sort_order                  smallint not null default 0,
  required_for_certificate    boolean not null default true,
  primary key (path_skill_id, module_id)
);


-- =============================================================================
-- 4. Assessments
-- =============================================================================

create table assessments (
  id                uuid primary key default gen_random_uuid(),
  module_version_id uuid not null references module_versions (id) on delete cascade,
  type              assessment_type not null,
  title             text not null,
  instructions      text not null default '',
  passing_score     numeric(5,2) not null default 70 check (passing_score between 0 and 100),
  runtime           code_runtime,                   -- Required for code assessments
  starter_files     jsonb not null default '[]',    -- [{path, content}]
  sort_order        smallint not null default 0,
  check ((type = 'code') = (runtime is not null))
);

create table quiz_questions (
  id               uuid primary key default gen_random_uuid(),
  assessment_id    uuid not null references assessments (id) on delete cascade,
  sort_order       smallint not null,
  prompt           text not null,
  explanation      text not null default '',
  linked_lesson_id uuid references lessons (id) on delete set null,
  unique (assessment_id, sort_order)
);

create table quiz_options (
  id          uuid primary key default gen_random_uuid(),
  question_id uuid not null references quiz_questions (id) on delete cascade,
  sort_order  smallint not null,
  text        text not null,
  unique (question_id, sort_order)
);

-- Kept in its own table so learners can never read correct answers.
create table quiz_answer_keys (
  question_id       uuid primary key references quiz_questions (id) on delete cascade,
  correct_option_id uuid not null references quiz_options (id) on delete cascade
);

create table test_cases (
  id            uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references assessments (id) on delete cascade,
  sort_order    smallint not null,
  name          text not null,                      -- 'Includes the first item'
  test_code     text not null,
  is_visible    boolean not null default true,      -- Hidden cases are not readable by learners
  unique (assessment_id, sort_order)
);

create table reference_solutions (
  assessment_id uuid primary key references assessments (id) on delete cascade,
  files         jsonb not null,
  last_verified_at timestamptz                      -- Set when all test cases pass
);

create table rubrics (
  assessment_id uuid primary key references assessments (id) on delete cascade,
  criteria      jsonb not null default '[]'         -- [{name, description}]
);


-- =============================================================================
-- 5. Roadmaps and progress
-- =============================================================================

create table roadmaps (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references users (id) on delete cascade,
  career_path_id uuid not null references career_paths (id) on delete restrict,
  track_id       uuid references tracks (id) on delete restrict,
  status         roadmap_status not null default 'active',
  weekly_hours   smallint check (weekly_hours between 1 and 40),
  ai_rationale   text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  completed_at   timestamptz
);
create index roadmaps_user on roadmaps (user_id);

create table placement_results (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references users (id) on delete cascade,
  career_path_id uuid not null references career_paths (id) on delete cascade,
  results        jsonb not null,                    -- Per-skill scores
  taken_at       timestamptz not null default now()
);

create table roadmap_technology_choices (
  roadmap_id                uuid not null references roadmaps (id) on delete cascade,
  decision_id               uuid not null references technology_decisions (id) on delete restrict,
  technology_id             uuid references technologies (id) on delete restrict,   -- Null until chosen
  recommended_technology_id uuid references technologies (id) on delete set null,
  recommendation_reason     text,
  chosen_at                 timestamptz,
  primary key (roadmap_id, decision_id),
  -- The chosen technology must be an option of this decision.
  foreign key (decision_id, technology_id) references decision_options (decision_id, technology_id)
);

create table roadmap_items (
  id           uuid primary key default gen_random_uuid(),
  roadmap_id   uuid not null references roadmaps (id) on delete cascade,
  module_id    uuid not null references modules (id) on delete restrict,
  sort_order   integer not null,
  source       roadmap_item_source not null default 'generated',
  added_reason text,                                -- 'Added after two quiz attempts'
  status       roadmap_item_status not null default 'active',
  created_at   timestamptz not null default now(),
  unique (roadmap_id, module_id)
);

-- Which version of a module a learner is taking.
create table module_enrollments (
  user_id           uuid not null references users (id) on delete cascade,
  module_id         uuid not null references modules (id) on delete cascade,
  module_version_id uuid not null references module_versions (id) on delete restrict,
  current_lesson_id uuid references lessons (id) on delete set null,
  started_at        timestamptz not null default now(),
  primary key (user_id, module_id)
);

create table lesson_progress (
  user_id      uuid not null references users (id) on delete cascade,
  lesson_id    uuid not null references lessons (id) on delete cascade,
  completed_at timestamptz not null default now(),
  primary key (user_id, lesson_id)
);

create table assessment_attempts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users (id) on delete cascade,
  assessment_id uuid not null references assessments (id) on delete restrict,
  attempt_no    integer not null,
  answers       jsonb not null default '{}',        -- {question_id: option_id}
  score         numeric(5,2) not null,
  passed        boolean not null,
  is_test_out   boolean not null default false,
  submitted_at  timestamptz not null default now(),
  unique (user_id, assessment_id, attempt_no)
);

create table code_submissions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users (id) on delete cascade,
  assessment_id uuid not null references assessments (id) on delete restrict,
  files         jsonb not null,
  status        submission_status not null default 'queued',
  test_results  jsonb,                              -- [{test_case_id, name, passed, expected, actual}]
  lint_results  jsonb,
  passed        boolean,
  submitted_at  timestamptz not null default now(),
  completed_at  timestamptz
);
create index code_submissions_user on code_submissions (user_id, assessment_id);

-- Verified evidence. One row per learner per module, shared across all roadmaps.
-- Written only by server-side code (grading function, worker, admin override).
create table module_completions (
  user_id           uuid not null references users (id) on delete cascade,
  module_id         uuid not null references modules (id) on delete restrict,
  module_version_id uuid not null references module_versions (id) on delete restrict,
  method            completion_method not null,
  score             numeric(5,2),
  completed_at      timestamptz not null default now(),
  override_reason   text,
  primary key (user_id, module_id),
  check ((method = 'override') = (override_reason is not null))
);


-- =============================================================================
-- 6. AI jobs and feedback
-- =============================================================================

-- Queue read by the local AI worker (Ollama). See claim_next_ai_job().
create table ai_jobs (
  id            uuid primary key default gen_random_uuid(),
  type          ai_job_type not null,
  status        job_status not null default 'queued',
  user_id       uuid references users (id) on delete cascade,
  source_id     uuid,                               -- code_submission, milestone_attempt, roadmap, or resume id
  payload       jsonb not null,
  result        jsonb,
  error         text,
  attempts      smallint not null default 0,
  model         text,                               -- 'qwen3.5:9b'
  prompt_version integer,
  created_at    timestamptz not null default now(),
  started_at    timestamptz,
  completed_at  timestamptz
);
create index ai_jobs_queue on ai_jobs (created_at) where status = 'queued';

-- AI output shown to learners, one row per piece of feedback or explanation.
create table ai_outputs (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid references ai_jobs (id) on delete set null,
  user_id     uuid not null references users (id) on delete cascade,
  source_type ai_job_type not null,
  source_id   uuid not null,
  content     jsonb not null,
  created_at  timestamptz not null default now()
);
create index ai_outputs_source on ai_outputs (source_type, source_id);

create table ai_feedback_flags (
  id           uuid primary key default gen_random_uuid(),
  ai_output_id uuid not null references ai_outputs (id) on delete cascade,
  user_id      uuid not null references users (id) on delete cascade,
  reason       text not null,
  status       flag_status not null default 'open',
  reviewed_by  uuid references users (id) on delete set null,
  reviewed_at  timestamptz,
  admin_notes  text,
  created_at   timestamptz not null default now(),
  unique (ai_output_id, user_id)
);

create table ai_prompts (
  id          uuid primary key default gen_random_uuid(),
  component   ai_job_type not null,
  version_no  integer not null,
  content     text not null,
  is_active   boolean not null default false,
  created_by  uuid references users (id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (component, version_no)
);
create unique index ai_prompts_one_active on ai_prompts (component) where is_active;


-- =============================================================================
-- 7. Capstone projects and GitHub
-- =============================================================================

create table capstone_briefs (
  id          uuid primary key default gen_random_uuid(),
  track_id    uuid not null references tracks (id) on delete restrict,
  slug        text not null unique,
  status      content_status not null default 'draft',
  created_at  timestamptz not null default now()
);

create table capstone_brief_versions (
  id              uuid primary key default gen_random_uuid(),
  brief_id        uuid not null references capstone_briefs (id) on delete cascade,
  version_no      integer not null check (version_no > 0),
  title           text not null,
  description     text not null default '',
  goals           text not null default '',
  estimated_weeks smallint not null default 3,
  status          version_status not null default 'draft',
  published_at    timestamptz,
  created_at      timestamptz not null default now(),
  unique (brief_id, version_no)
);
create unique index brief_versions_one_published
  on capstone_brief_versions (brief_id) where status = 'published';

create table starter_templates (
  id               uuid primary key default gen_random_uuid(),
  brief_version_id uuid not null references capstone_brief_versions (id) on delete cascade,
  technology_id    uuid not null references technologies (id) on delete restrict,
  repo_full_name   text not null,                   -- 'first-commit/task-tracker-react'
  unique (brief_version_id, technology_id)
);

create table milestones (
  id                   uuid primary key default gen_random_uuid(),
  brief_version_id     uuid not null references capstone_brief_versions (id) on delete cascade,
  sort_order           smallint not null,
  title                text not null,
  acceptance_criteria  jsonb not null default '[]',
  review_checklist     jsonb not null default '[]',   -- Read by the Code Review AI
  explanation_question text,
  unique (brief_version_id, sort_order)
);

create table milestone_modules (
  milestone_id uuid not null references milestones (id) on delete cascade,
  module_id    uuid not null references modules (id) on delete cascade,
  primary key (milestone_id, module_id)
);

create table milestone_checks (
  id           uuid primary key default gen_random_uuid(),
  milestone_id uuid not null references milestones (id) on delete cascade,
  type         check_type not null,
  name         text not null,                       -- 'Test: rejects empty input'
  config       jsonb not null default '{}',         -- {path} | {workflow, test_name} | {}
  sort_order   smallint not null default 0
);

create table capstone_projects (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references users (id) on delete cascade,
  roadmap_id       uuid not null references roadmaps (id) on delete restrict,
  brief_version_id uuid not null references capstone_brief_versions (id) on delete restrict,
  technology_id    uuid not null references technologies (id) on delete restrict,
  repo_github_id   bigint unique,
  repo_full_name   text,                            -- 'learner/task-tracker'
  demo_url         text,
  status           project_status not null default 'connecting',
  started_at       timestamptz not null default now(),
  completed_at     timestamptz,
  unique (roadmap_id)
);

create table project_commits (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references capstone_projects (id) on delete cascade,
  sha          text not null,
  message      text not null default '',
  author_login text,
  additions    integer,
  deletions    integer,
  pushed_at    timestamptz not null,
  unique (project_id, sha)
);

create table milestone_attempts (
  id                 uuid primary key default gen_random_uuid(),
  project_id         uuid not null references capstone_projects (id) on delete cascade,
  milestone_id       uuid not null references milestones (id) on delete restrict,
  commit_sha         text not null,
  status             attempt_status not null default 'checking',
  check_results      jsonb not null default '[]',    -- [{check_id, name, passed, detail}]
  explanation_answer text,
  created_at         timestamptz not null default now(),
  completed_at       timestamptz
);
-- A milestone can be completed only once per project.
create unique index milestone_attempts_one_complete
  on milestone_attempts (project_id, milestone_id) where status = 'complete';

create table check_overrides (
  id                  uuid primary key default gen_random_uuid(),
  milestone_attempt_id uuid not null references milestone_attempts (id) on delete cascade,
  milestone_check_id  uuid not null references milestone_checks (id) on delete cascade,
  admin_id            uuid not null references users (id) on delete restrict,
  reason              text not null,
  created_at          timestamptz not null default now()
);

create table integrity_flags (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references capstone_projects (id) on delete cascade,
  type            integrity_flag_type not null,
  details         jsonb not null default '{}',      -- e.g., {similar_project_id, similarity: 0.94}
  status          integrity_status not null default 'open',
  decided_by      uuid references users (id) on delete set null,
  decided_at      timestamptz,
  decision_reason text,
  created_at      timestamptz not null default now(),
  check (status = 'open' or decision_reason is not null)
);

-- Raw GitHub webhook deliveries, stored for idempotency and debugging.
create table github_events (
  id           uuid primary key default gen_random_uuid(),
  delivery_id  text not null unique,                -- X-GitHub-Delivery header
  event_type   text not null,
  payload      jsonb not null,
  received_at  timestamptz not null default now(),
  processed_at timestamptz,
  error        text
);


-- =============================================================================
-- 8. Certificates and resumes
-- =============================================================================

create table certificate_templates (
  id          uuid primary key default gen_random_uuid(),
  type        certificate_type not null,
  layout      jsonb not null,
  is_active   boolean not null default false,
  updated_at  timestamptz not null default now()
);
create unique index certificate_templates_one_active
  on certificate_templates (type) where is_active;

create table certificates (
  id              uuid primary key default gen_random_uuid(),
  public_code     text not null unique,             -- 'FC-7K2M-94QX'
  user_id         uuid not null references users (id) on delete cascade,
  type            certificate_type not null,
  roadmap_id      uuid not null references roadmaps (id) on delete restrict,
  project_id      uuid references capstone_projects (id) on delete restrict,
  recipient_name  text not null,                    -- Snapshot of full_name at issue
  title           text not null,                    -- 'Junior Web Developer, Frontend track with React'
  details         jsonb not null default '{}',      -- {skills: [...], project_title, repo_full_name}
  status          certificate_status not null default 'valid',
  issued_at       timestamptz not null default now(),
  revoked_at      timestamptz,
  revoked_reason  text,
  replaced_by_id  uuid references certificates (id) on delete set null,
  check ((type = 'project') = (project_id is not null)),
  check ((status = 'revoked') = (revoked_reason is not null))
);
-- One valid certificate of each type per roadmap.
create unique index certificates_one_valid
  on certificates (roadmap_id, type) where status = 'valid';

create table resumes (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references users (id) on delete cascade,
  career_path_id    uuid references career_paths (id) on delete set null,
  selected_evidence jsonb not null default '{}',    -- {module_ids, certificate_ids, project_ids}
  content           jsonb not null default '{}',    -- Rendered sections
  ai_fields         text[] not null default '{}',   -- Fields written by AI and not yet edited
  generated_at      timestamptz,
  updated_at        timestamptz not null default now()
);
create index resumes_user on resumes (user_id);


-- =============================================================================
-- 9. Notifications, settings, activity log
-- =============================================================================

create table notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users (id) on delete cascade,
  type        text not null,                        -- 'module_updated', 'certificate_earned', ...
  title       text not null,
  body        text not null default '',
  link        text,
  data        jsonb not null default '{}',
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index notifications_user_unread on notifications (user_id, created_at desc) where read_at is null;

create table platform_settings (
  key         text primary key,                     -- 'passing_score_default', 'reinforcement_after_attempts'
  value       jsonb not null,
  updated_by  uuid references users (id) on delete set null,
  updated_at  timestamptz not null default now()
);

create table admin_activity_log (
  id          bigint generated always as identity primary key,
  admin_id    uuid references users (id) on delete set null,
  action      text not null,                        -- 'module_version.published', 'certificate.revoked'
  target_type text not null,
  target_id   uuid,
  reason      text,
  details     jsonb not null default '{}',
  created_at  timestamptz not null default now()
);
create index admin_activity_log_created on admin_activity_log (created_at desc);

-- The activity log is append-only.
create or replace function prevent_log_changes()
returns trigger language plpgsql as $$
begin
  raise exception 'admin_activity_log is append-only';
end;
$$;
create trigger admin_activity_log_no_update before update or delete on admin_activity_log
  for each row execute function prevent_log_changes();

-- updated_at triggers
create trigger users_updated_at            before update on users            for each row execute function set_updated_at();
create trigger learner_profiles_updated_at before update on learner_profiles for each row execute function set_updated_at();
create trigger resume_details_updated_at   before update on resume_details   for each row execute function set_updated_at();
create trigger career_paths_updated_at     before update on career_paths     for each row execute function set_updated_at();
create trigger tracks_updated_at           before update on tracks           for each row execute function set_updated_at();
create trigger modules_updated_at          before update on modules          for each row execute function set_updated_at();
create trigger module_versions_updated_at  before update on module_versions  for each row execute function set_updated_at();
create trigger roadmaps_updated_at         before update on roadmaps         for each row execute function set_updated_at();
create trigger resumes_updated_at          before update on resumes          for each row execute function set_updated_at();


-- =============================================================================
-- 10. Functions
--
-- With an Express backend, most logic lives in the backend, where it can be
-- read, tested and explained. Only work that must be atomic in the database
-- stays here.
-- =============================================================================

-- Called by the local AI worker to take the next job safely, even if two worker
-- processes run at once.
create or replace function claim_next_ai_job(p_types ai_job_type[] default null)
returns setof ai_jobs
language plpgsql as $$
begin
  return query
  update ai_jobs j
     set status = 'running', started_at = now(), attempts = j.attempts + 1
   where j.id = (
     select id from ai_jobs
      where status = 'queued' and (p_types is null or type = any (p_types))
      order by created_at
      for update skip locked
      limit 1
   )
  returning j.*;
end;
$$;

-- Housekeeping the backend can run on a schedule (for example a daily cron job).
create or replace function purge_expired_auth_rows()
returns void language sql as $$
  delete from sessions where expires_at < now();
  delete from email_verification_tokens where expires_at < now();
  delete from password_reset_tokens where expires_at < now();
  delete from auth_attempts where created_at < now() - interval '30 days';
$$;

-- Removes stored webhook payloads after they have been processed, so the
-- github_events table does not grow without limit.
create or replace function purge_processed_github_events(p_older_than interval default interval '14 days')
returns void language sql as $$
  update github_events
     set payload = '{}'::jsonb
   where processed_at is not null and processed_at < now() - p_older_than
     and payload <> '{}'::jsonb;
$$;


-- =============================================================================
-- 11. Database roles and grants
--
-- Only two clients connect: the Express backend and the local AI worker.
-- Row Level Security is not used, because the database cannot tell which
-- learner a request belongs to. EVERY permission check must therefore happen
-- in the backend, before it runs a query. The checklist in
-- database-schema.md, Section 6, lists what each endpoint must verify.
--
-- Rules the backend must enforce (they were RLS policies before):
--   * Learner-owned rows are always filtered by the session's user id.
--   * Learners never receive quiz_answer_keys, reference_solutions, rubrics,
--     hidden test_cases, ai_prompts, integrity_flags or github_events.
--   * Only server code writes module_completions, assessment_attempts,
--     milestone_attempts and certificates. No endpoint accepts these from the
--     browser.
--   * Admin-only endpoints check users.role = 'admin' and status = 'active'.
--   * Every admin action that changes learner outcomes also inserts a row in
--     admin_activity_log with a reason.
-- =============================================================================

-- Optional: a least-privilege login for the backend, instead of the owner role.
-- Supabase projects can simply use the connection string they provide.
--
-- create role first_commit_app login password 'set-a-strong-password';
-- grant connect on database postgres to first_commit_app;
-- grant usage on schema public to first_commit_app;
-- grant select, insert, update, delete on all tables in schema public to first_commit_app;
-- grant usage, select on all sequences in schema public to first_commit_app;
-- grant execute on all functions in schema public to first_commit_app;
-- alter default privileges in schema public
--   grant select, insert, update, delete on tables to first_commit_app;
