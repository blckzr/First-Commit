-- =============================================================================
-- 0003 — Claiming code submissions
--
-- `database-schema.md` §1: "the local worker claims AI jobs **and code
-- submissions**". `claim_next_ai_job()` existed from the first migration;
-- nothing ever claimed a submission, so `POST /exercises/:id/submissions`
-- wrote a `queued` row that no process would ever look at.
--
-- Same shape as `claim_next_ai_job()` on purpose: one row at a time,
-- `for update skip locked` so two workers cannot take the same submission, and
-- oldest first so a queue is a queue.
-- =============================================================================

create or replace function claim_next_code_submission()
returns setof code_submissions
language plpgsql as $$
begin
  return query
  update code_submissions s
     set status = 'running'
   where s.id = (
     select id from code_submissions
      where status = 'queued'
      order by submitted_at
      for update skip locked
      limit 1
   )
  returning s.*;
end;
$$;

-- The queue read on every poll. Partial, so it stays small however many
-- submissions accumulate — the same reason `ai_jobs_queue` is partial.
create index if not exists code_submissions_queue
  on code_submissions (submitted_at) where status = 'queued';

-- A submission stuck `running` is one a worker was holding when it stopped.
-- `requeueStranded()` in the worker looks for these at startup, and it can
-- only find them if it can ask by status.
create index if not exists code_submissions_running
  on code_submissions (status) where status = 'running';
