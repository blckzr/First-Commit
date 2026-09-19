# First Commit: Task Tracker

What is planned and what is done, from an empty repository to a working platform.

| | |
|---|---|
| **Scope** | Build work through the minimum viable version (`project-proposal.md` §2.2). Evaluation and defense work are not tracked here yet. |
| **Companion** | [`CHANGELOG.md`](CHANGELOG.md) records what *happened*, dated. This file records what is *planned*. Finish a task → tick it here, write the entry there. |
| **Status** | `[ ]` not started · `[~]` in progress · `[x]` done · `[!]` blocked |

---

## Now

The immediate queue. Everything here is unblocked and ready to pick up.

- [ ] **Port `apps/worker` to `pg`** — `config.ts:22-25` (`SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` → `DATABASE_URL`), `worker.ts:7-76` (`createClient` → `Pool`, `.rpc("claim_next_ai_job")` → `select * from claim_next_ai_job()`, `.from().insert()`/`.update()` → SQL), swap the dependency, rewrite `.env.example`. Code and docs disagree until this lands.
- [ ] **Scaffold `apps/api`** — Express + TypeScript, `pg` pool on the connection pooler, `/health`, `app.set("trust proxy", 1)`.
- [ ] **Scaffold `apps/web`** — Vite + React + TS strict, the route tree and guards from `design.md` §13.6, `styles/tokens.css` from §13.4, the `src/` structure from §13.2.

## Decide

Open questions from [`../AGENT.md`](../AGENT.md) §11. Each blocks the task named beside it.

- [!] **Email provider** — blocks auth (verification and reset links). `database-schema.md` §9.3 lists no mail config. Resend free tier is 3,000/month; Brevo 300/day.
- [!] **API domain** — blocks deployment. `§6.3`'s `sameSite=none` makes a third-party cookie, already blocked by Safari ITP. Hosting the API at `api.<domain>` alongside the app makes it same-site.
- [ ] **`users.role` trigger** — defense-in-depth for the table controlling the admin surface. §5 currently relies on convention alone.
- [ ] **Document the SSE trigger** — the decision (worker POSTs `/internal/events`, API sweeps as backstop) is not yet written into `database-schema.md` §8.2, §8.3, or the §9.3 environment list.

---

## Phase 0 — Foundation ✓

- [x] Project proposal, UI/UX design, database schema, model setup guide
- [x] `schema.sql` — 59 tables, 14 check constraints, 7 partial unique indexes, 5 functions
- [x] Monorepo: npm workspaces, `docs/`, `supabase/migrations/`, `apps/`, `packages/`
- [x] `AGENT.md` working contract, `CLAUDE.md`, `README.md`, this tracker
- [x] AI worker extracted as a workspace; Code Review AI (`code_feedback`) working against Ollama

## Phase 1 — Backend foundation

Nothing in the learner app can be built until an account can log in.

- [ ] Worker on `pg` *(see Now)*
- [ ] `apps/api` scaffold *(see Now)*
- [ ] **Sign up** — argon2id hash, insert `users` + `learner_profiles`, create session, send verification email
- [ ] **Log in / log out** — session cookie (`httpOnly`, `secure`, CSRF defense), sessions cleared on logout and password change
- [ ] **Email verification and password reset** — hashed, expiring, single-use tokens
- [ ] **Rate limiting** — failed logins and reset requests per email and per IP via `auth_attempts`
- [ ] **Request middleware** — the `database-schema.md` §6.1 six steps: resolve session → reject suspended → filter by session user id → check ownership of every URL id → check role on admin routes → explicit column lists
- [ ] **SSE** — `/events` stream per user, `/internal/events` for the worker (`WORKER_SECRET`), periodic sweep for unsent rows
- [ ] **Security tests** — a learner cannot reach another learner's data or any admin route (`project-proposal.md` §9.2)
- [ ] **Deploy to Render** — Singapore region, env vars, health check; point the GitHub App webhook at it

## Phase 2 — Learner core

The main loop: sign up → roadmap → learn → pass.

- [ ] `apps/web` scaffold *(see Now)*
- [ ] Design tokens, base components, learner shell (sidebar / bottom nav), admin shell
- [ ] Public pages — landing, sign up, log in, forgot/reset password
- [ ] Onboarding — about you, target position, placement, generating; one page per step, resumable via `onboarding_step`
- [ ] **Roadmap chart** — React Flow, custom nodes, side panel, the `sm` stacked layout, keyboard navigation and nested-list DOM equivalent
- [ ] Module page, lesson reading, lesson progress
- [ ] Quiz — server-side grading, attempts, test-out
- [ ] Coding exercise — CodeMirror, Sandpack practice, server grading via Judge0 / Vitest+jsdom, results over SSE
- [ ] Home, My roadmaps, Explore modules, Notifications, Settings

## Phase 3 — AI components

`code_feedback` already works; the other three are stubs with schemas written.

- [ ] **`roadmap_generation`** — handler, prompt, validation against real module IDs, prerequisite order, full core coverage; reject and regenerate on invalid
- [ ] **Roadmap review screen** — AI rationale panel, track override, weekly hours, flag control
- [ ] **Technology decision** — comparison, taster lessons, AI recommendation, switching
- [ ] **Adaptive modules** — reinforcement after repeated low scores, challenge after high ones
- [ ] **`milestone_review`** — diff-only, split by file, `AI_CONTEXT_LARGE`
- [ ] **`resume_generation`** — evidence-only, cross-checked against verified skills
- [ ] **Prompt versioning** — `ai_prompts` rows, version recorded per job
- [ ] **Flagging** — "Is this wrong?" writes `ai_feedback_flags`

## Phase 4 — Capstone and certificates

- [ ] GitHub App — registration, install flow, `github_connections`
- [ ] Webhook endpoint — signature verification, `github_events` deduplication by `delivery_id`
- [ ] Project briefs, starter template repositories for React and Vue
- [ ] Milestone tracker — criteria, latest push, check results, AI review, history
- [ ] Automatic checks — `file_exists`, `workflow_test`, `deployment_url`
- [ ] Worker commit polling — backstop for deliveries missed while Render wakes
- [ ] Integrity signals — single-commit detection, similarity, `integrity_flags`
- [ ] **Certificates** — automatic issuance on requirements met, `public_code`, name snapshot, PDF to Storage
- [ ] **Public verification page** — `/verify/:code`, QR code, mobile-first, revoked state

## Phase 5 — Resume and admin

- [ ] Resume builder — evidence selection, personal details, tailoring, edit, PDF download, ATS parse check
- [ ] Admin overview
- [ ] Career path editor — skills, tracks, technology options, prerequisites, certificate requirements
- [ ] Module editor — lessons, quizzes, exercises, test cases, rubrics; preview
- [ ] **Versioning** — minor edit vs major revision, impact preview, learner update notices
- [ ] Capstone brief and milestone editor
- [ ] Project reviews — repositories, commit history, integrity flags, check overrides
- [ ] Flagged AI feedback review
- [ ] Certificates admin — templates, lookup, revoke, reissue
- [ ] Analytics — journey funnel, module pass rates, milestone drop-off, technology split, AI flag rate
- [ ] Users — search, suspend, data requests, admin accounts
- [ ] Settings and activity log

---

## Content (parallel track)

Not code, but the MVP is not demonstrable without it (`project-proposal.md` §2.2).

- [ ] Junior Web Developer career path
- [ ] Core skill modules — HTML, CSS, JavaScript, Git
- [ ] Frontend track — concept modules, then React and Vue technology modules
- [ ] Placement assessment questions
- [ ] At least one capstone brief with milestones, checks, and starter templates for both technologies
