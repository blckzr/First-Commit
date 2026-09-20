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

- [ ] **Scaffold `apps/api`** — Express + TypeScript, `pg` pool on the connection pooler, `/health`, `app.set("trust proxy", 1)`.

## Decide

Open questions from [`../AGENT.md`](../AGENT.md) §11. Each blocks the task named beside it.

- [x] **Email provider — Brevo.** Verifies a sender by email, so it needs no domain; 300/day free. Written into `database-schema.md` §9.1–9.3. Auth is **no longer blocked**: mail sits behind one module with a dev transport that logs the link to the console.
- [!] **API domain** — blocks deployment. `§6.3`'s `sameSite=none` makes a third-party cookie, already blocked by Safari ITP. Hosting the API at `api.<domain>` alongside the app makes it same-site.
- [ ] **`users.role` trigger** — defense-in-depth for the table controlling the admin surface. §5 currently relies on convention alone.
- [ ] **Replace the substituted fonts, icons, and logo** if real brand assets exist — see [design-source.md](design-source.md) §6
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

- [x] Worker on `pg` — `@supabase/supabase-js` removed, `claim_next_ai_job()` and the writes are plain SQL, `notifyApi()` added for the SSE handoff. **Not yet run against a live database.**
- [ ] `apps/api` scaffold *(see Now)*
- [ ] **Mail module** — one interface, a console transport for development and Brevo for production
- [ ] **Sign up** — argon2id hash, insert `users` + `learner_profiles`, create session, send verification email
- [ ] **Log in / log out** — session cookie (`httpOnly`, `secure`, CSRF defense), sessions cleared on logout and password change
- [ ] **Email verification and password reset** — hashed, expiring, single-use tokens
- [ ] **Rate limiting** — failed logins and reset requests per email and per IP via `auth_attempts`
- [ ] **Request middleware** — the `database-schema.md` §6.1 six steps: resolve session → reject suspended → filter by session user id → check ownership of every URL id → check role on admin routes → explicit column lists
- [ ] **SSE** — `/events` stream per user, `/internal/events` for the worker (`WORKER_SECRET`), periodic sweep for unsent rows
- [ ] **Security tests** — a learner cannot reach another learner's data or any admin route (`project-proposal.md` §9.2)
- [ ] **Deploy to Render** — Singapore region, env vars, health check; point the GitHub App webhook at it

## Phase 1.5 — Design system ✓

Ported from the prototype (see [design-source.md](design-source.md)). Needs no API, so it
ran ahead of Phase 1.

- [x] `apps/web` scaffold — Vite, React 19, TypeScript strict, React Router
- [x] Tokens — `styles/tokens.css` and the `tokens.ts` mirror, with the contrast corrections
- [x] 14 components as `.tsx` + `.module.css`, hover/press/focus in CSS not React state
- [x] `LearnerShell` — sidebar at `lg`, icon rail at `md`, bottom navigation at `sm`
- [x] Route guards and the lazily-loaded admin chunk
- [x] Reference screens: Landing, Sign up, Learner home
- [x] Contrast verified — 28 pairs, all passing
- [x] Toolchain — ESLint 9 with `jsx-a11y` (a11y rules as errors), Vitest + Testing Library, axe helper. 21 tests.
- [x] Component gallery route at `/dev/components` — every variant, live token swatches, live contrast table. Dev-only; excluded from production builds.
- [x] Contrast gate — `contrast.test.ts` reads `tokens.css` from disk and asserts all 29 pairs, so §12 is enforced by a test, not by a one-off check
- [x] `AdminShell` — grouped sidebar, persistent Admin indicator, admin Overview screen, and a named placeholder for the other ten §6 screens
- [x] Playwright — 23 tests across the four §11.4 widths, plus live-resize and 320px reflow. **92 assertions passing.**
- [x] Dev session override (`?as=admin|learner|onboarding|signedout`), so all four areas and every §4.3 redirect can be exercised
- [x] Named placeholders for every specified-but-unbuilt screen, so no navigation item dead-ends. Each cites the `design.md` section that specifies it.

## Phase 2 — Learner core

The main loop: sign up → roadmap → learn → pass.

- [x] Landing and Sign up (Phase 1.5)
- [ ] Log in
- [ ] **Design + build `/forgot-password` and `/reset-password`** — not in the prototype
- [ ] Onboarding — about you, target position, placement, generating; one page per step, resumable via `onboarding_step`
- [ ] **Roadmap chart** — React Flow, custom nodes, side panel, the `sm` stacked layout, keyboard navigation and nested-list DOM equivalent
- [ ] Module page, lesson reading, lesson progress
- [ ] Quiz — server-side grading, attempts, test-out
- [ ] Coding exercise — CodeMirror, Sandpack practice, server grading via Judge0 / Vitest+jsdom, results over SSE
- [x] Home (Phase 1.5)
- [ ] My roadmaps, Explore modules, Settings
- [ ] **Design + build `/app/notifications`** — not in the prototype
- [ ] Reconcile `/app/profile` vs `design.md` §4.3, which folds profile into Settings

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
- [ ] **Design + build `/verify/:code`** — not in the prototype. QR code, mobile-first, revoked state

## Phase 5 — Resume and admin

- [ ] Resume builder — evidence selection, personal details, tailoring, edit, PDF download, ATS parse check
- [ ] Admin overview
- [ ] Career path editor — skills, tracks, technology options, prerequisites, certificate requirements
- [ ] Module editor — lessons, quizzes, exercises, test cases, rubrics; preview
- [ ] **Versioning** — minor edit vs major revision, impact preview, learner update notices
- [ ] Capstone brief and milestone editor
- [ ] Project reviews — repositories, commit history, integrity flags, check overrides
- [ ] Flagged AI feedback review
- [ ] **Design + build `/admin/certificates`** — not in the prototype. Templates, lookup, revoke, reissue
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
