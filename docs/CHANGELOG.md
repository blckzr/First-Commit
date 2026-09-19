# Changelog

Task log for First Commit. Every task adds an entry here before it is considered done
(see [`AGENT.md`](../AGENT.md) §10).

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). This project
does **not** follow semantic versioning yet — it is pre-release thesis work, so everything
lives under `[Unreleased]` until there is something to version.

---

## [Unreleased]

### 2026-09-19 — Task tracker, and docs gathered in one place

#### Added

- `docs/task-tracker.md` — what is planned and what is done, from the current state to the
  minimum viable version in `project-proposal.md` §2.2. A "Now" queue of unblocked work, a
  "Decide" list holding the four open questions with the task each one blocks, then phases
  0–5 (foundation, backend, learner core, AI components, capstone and certificates, resume
  and admin) and a parallel content track. Evaluation and defense work (proposal §9) are
  deliberately out of scope for now.

#### Changed

- Moved `CHANGELOG.md` to `docs/CHANGELOG.md`, and fixed its own link to `AGENT.md`.
- Updated the four places that pointed at the old path: `AGENT.md` §5 (layout tree) and §10
  (the working agreement, which now also says to tick tasks off in the tracker), and
  `README.md`'s repo map.
- Added the tracker and the changelog to both document indexes — `AGENT.md` §1 and
  `README.md` — so neither is reachable only by knowing it exists.
- `README.md`'s status section now points at the tracker for what comes next.

#### Notes

- The tracker and the changelog split deliberately: the tracker is forward-looking (what is
  planned, with status), the changelog backward-looking (what happened, dated). Both files
  say so, to stop them drifting into duplicates of each other.

### 2026-09-19 — Architecture changed to Node.js + Express

The backend moved from **Supabase-as-backend** (browser → PostgreSQL directly, 57 RLS
policies as the security boundary, Deno Edge Functions for GitHub webhooks) to
**Node.js + Express deployed on Render**, with PostgreSQL on Supabase used purely as a
database. The author rewrote three specification documents; this task adopted them and
realigned everything else in the repo. No application code was written and nothing was
committed.

Why it changed: the Express API has a public HTTPS address, so GitHub webhooks no longer
need a tunnel or an Edge Function; the API and the AI worker share one TypeScript
codebase; and the platform owns its own authentication rather than depending on a hosted
auth provider. The cost is that permission checks move from the database, which fails
closed, to endpoints, which fail open — the new `database-schema.md` §6 is the checklist
that manages that risk, and proposal §9.2 adds security tests for it.

#### Changed

- Replaced `docs/database-schema.md` (566 → 593 lines), `docs/project-proposal.md`
  (683 → 710), and `supabase/migrations/0001_initial_schema.sql` (1063 → 864) with the
  author's rewritten versions, then repointed their `schema.sql` references at the
  migration path.
- Rewrote the two lines in `docs/design.md` that still claimed Row Level Security protects
  the data (§4.3 "The interface is not the protection", §13.6 "Guards are for the
  experience, not for security"). Both now point at the API's session, role, and ownership
  checks. Also corrected `profiles` → `users` in §13.6.
- Rewrote the stale parts of `docs/model-setup-guide.md`: the §1 diagram and bullets, the
  §11 heading and connection steps (`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` →
  `DATABASE_URL`, `API_URL`, `WORKER_SECRET`), the `profiles` → `users` example, and the
  `claim_next_ai_job failed` troubleshooting row. Sections 2–10 were unaffected.
- Rewrote `AGENT.md` for the new architecture: the diagram and data flow (§3), the API
  stack (§4), `apps/api` in the layout (§5), and — the substantive change — §6, where the
  rules survive but their enforcement moves from RLS policies to endpoint checks. Added
  the six-step per-request checklist and the authentication rules, and a note that the API
  fails open where RLS failed closed. Added §11 for open questions.
- Rewrote `README.md`: architecture paragraph, repo map, environment table, status.

#### Added

- `apps/api/.gitkeep` reserving the Express workspace. The root `package.json` already
  globs `apps/*`, so no manifest change was needed.
- `AGENT.md` §10 "Endpoints": never add an endpoint without its ownership check and a test.

#### Decisions

- **SSE trigger:** the worker POSTs to `/internal/events` with a shared `WORKER_SECRET`
  after writing a result, and the API sweeps for unsent rows as a backstop. `LISTEN/NOTIFY`
  was rejected because it does not work through the Supabase connection pooler that the
  API uses. The worker therefore uses a direct connection (5432), the API the pooler (6543).
- **Authentication:** hand-rolled, keeping `users`, `sessions`, `email_verification_tokens`,
  `password_reset_tokens`, and `auth_attempts` as `schema.sql` defines them. The Better Auth
  path in `database-schema.md` §9.4 was declined — it would weaken proposal objective #8.
- **Worker port deferred** to its own task, so this one stayed documentation-only.

#### Known gaps

Recorded in `AGENT.md` §11 rather than silently patched, since these are gaps in the
author's specification:

1. **The SSE trigger is not in the documents.** §8.2 and §8.3 promise server-sent events
   but nothing says how the API learns the worker wrote a row; there is no `pg_notify` in
   the schema. Resolved by the decision above, but §8.2, §8.3, and §9.3's environment list
   should be updated to match.
2. **No email provider.** §8.1 sends a verification email and §6.3 requires expiring reset
   links, but §9.3 step 5's environment variables have no mail configuration.
3. **`sameSite=none` is fragile.** §6.3 derives it from the app and API being on different
   domains, making it a third-party cookie — already blocked by Safari's ITP. Hosting the
   API at `api.<domain>` makes it same-site.
4. **`users.role` is convention-only.** §5 relies on no endpoint updating it; the previous
   schema had a trigger. A trigger would be cheap defense-in-depth.

#### Notes

- **`apps/worker` still uses `@supabase/supabase-js`** (`config.ts:22-25`,
  `worker.ts:7-76`), so code and docs knowingly disagree there. Porting it to `pg` —
  `createClient` → `Pool`, `.rpc("claim_next_ai_job")` → `select * from
  claim_next_ai_job()`, `.from().insert()` → SQL, plus the `/internal/events` call — is the
  next task. `docs/model-setup-guide.md` §11 carries a note saying so.
- Verified against the schema rather than the prose: every rule `database-schema.md` §5
  claims is backed by a real constraint or index (14 check constraints, 7 partial unique
  indexes, 24 `on delete restrict`, and the `prevent_log_changes()` trigger).
- The schema was checked structurally only — 59 `create table`, 5 functions defined. It was
  not executed, because no PostgreSQL instance is available here.

### 2026-09-19 — Repository structure and agent instructions

Turned a folder of planning documents into a working monorepo. No code was written and
nothing was committed; all changes are in the working tree for review.

#### Added

- `AGENT.md` — the working contract for AI agents on this project. Defines the two roles
  (AI engineer for `apps/worker` and the model; fullstack developer for `apps/web` and the
  Supabase surface), the architecture, the rules that must not be broken (evidence is
  server-written only, the service role key never reaches the browser, RLS is the security
  boundary), the AI grounding and VRAM rules, the frontend token/status/responsive
  conventions, and the copy voice — each traced to a section of `docs/`.
- `CLAUDE.md` — a one-line `@AGENT.md` import so Claude Code loads the contract
  automatically without duplicating it.
- `CHANGELOG.md` — this file.
- `README.md` — orientation, repo map, and an index of the documents in `docs/`.
- `package.json` — npm workspaces root (`apps/*`, `packages/*`) with pass-through scripts:
  `npm run worker`, `npm run check`, `npm run try:feedback`, `npm run typecheck`.
- `.gitignore` — ignores `node_modules/`, build output, `.env` files (keeping
  `.env.example`), `*.zip`, logs, and editor/OS files. The Supabase service role key lives
  in `apps/worker/.env`, so keeping env files out of git is the point.
- `packages/.gitkeep` — reserves the workspace folder for shared types later.

#### Changed

- Moved the four planning documents to `docs/`: `project-proposal.md`, `design.md`,
  `database-schema.md`, `model-setup-guide.md`. They reference each other by bare filename
  and remain siblings, so those links still resolve.
- Moved `schema.sql` to `supabase/migrations/0001_initial_schema.sql`, which is what
  `docs/database-schema.md` §9.3 already prescribed.
- Extracted `first-commit-ai-worker.zip` to `apps/worker/` (top-level folder stripped), so
  the worker is a real workspace rather than an archive.
- Renamed the worker package from `first-commit-ai-worker` to `@first-commit/worker` so it
  resolves as a workspace, and pointed its README at `../../docs/model-setup-guide.md`.
- Updated every reference to the old `schema.sql` path — four in
  `docs/database-schema.md` (header table, §3, §9.3 step 2, §9.3 step 8) and three in
  `docs/model-setup-guide.md` (header table, §11 step 1, §13 troubleshooting).
- Rewrote `docs/model-setup-guide.md` §8 step 1: the worker is no longer unzipped next to
  the React app, it already lives at `apps/worker`, and `npm install` at the repo root now
  installs every workspace.

#### Notes

- `first-commit-ai-worker.zip` is still at the repo root and is now gitignored. It can be
  deleted once the extraction in `apps/worker/` has been verified.
- `apps/web` is **not** scaffolded. It is reserved in the workspace globs and documented in
  `AGENT.md` §5, and is the next task.
- `docs/project-proposal.md` §8.2 still lists Backend and Database as "[To be decided]".
  The resolved answer (Supabase + local Node worker) is recorded in `AGENT.md` §1; the
  proposal itself was left unedited so the author decides how to word it.
- No dependencies were installed and no git command that writes was run.
