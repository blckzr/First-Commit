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

- [x] **Supabase project created**, migrated and verified. `npm run db:seed` loads the curriculum and `npm run db:accounts` creates the sign-in accounts.
- [ ] **Replace the placeholder `SESSION_SECRET` in `apps/api/.env`.** It is the literal instruction text rather than a value. `required()` only checks for non-empty, so the API boots and sessions work — but the signing secret is a publicly known string. Generate one with `node -e "console.log(crypto.randomBytes(32).toString('hex'))"`. (`apps/api/.env` also lists `APP_ORIGIN` twice; harmless, but worth tidying.)
- [ ] **`config.ts` accepts a placeholder as a secret.** `SESSION_SECRET` passing validation as `<node -e "...">` is the kind of thing that reaches production. A length check, and a refusal on anything starting with `<`, would cost two lines.

- [ ] **Security tests** — `project-proposal.md` §9.2 names these as a deliverable. Much is already covered; what is missing is a learner reaching another learner's data, which needs a second endpoint to test against.




## Decide

Open questions from [`../AGENT.md`](../AGENT.md) §11. Each blocks the task named beside it.

- [ ] **Does Landing redirect a signed-in visitor?** §4.3 sends them away from `/login` and `/signup`, and says nothing about `/`. Showing a signed-in learner a "Log in" button is what made the session look broken. Recommendation: keep the page, swap the call to action for "Go to your roadmap".

- [x] **Email provider — Brevo.** Verifies a sender by email, so it needs no domain; 300/day free. Written into `database-schema.md` §9.1–9.3. Auth is **no longer blocked**: mail sits behind one module with a dev transport that logs the link to the console.
- [!] **API domain** — blocks deployment. `§6.3`'s `sameSite=none` makes a third-party cookie, already blocked by Safari ITP. Hosting the API at `api.<domain>` alongside the app makes it same-site.
- [ ] **`users.role` trigger** — defense-in-depth for the table controlling the admin surface. §5 currently relies on convention alone.
- [ ] **Replace the substituted fonts, icons, and logo** if real brand assets exist — see [design-source.md](design-source.md) §6
- [x] **SSE trigger documented** — `database-schema.md` §8.4 now describes the whole path, and §8.1–8.3 point at it.

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
- [x] `apps/api` scaffold — Express 5 + TS, pooled `pg`, CORS for `APP_ORIGIN` with credentials, JSON error handling, `/health` + `/health/db`, graceful shutdown, and a supertest harness (8 tests)
- [x] **Mail module** — one interface, console transport for development, Brevo for production, plus the verification and reset templates. Injected through `app.locals`, so endpoint tests substitute their own.
- [x] **Sign up** — `POST /auth/signup`: argon2id, `users` + `learner_profiles` + verification token in one transaction, session cookie, verification mail. Plus `GET /auth/me`.
- [x] **Log in / log out** — `POST /auth/login` and `/auth/logout`, non-leaking failure message, decoy hash against timing enumeration, `next` destination per §5.3, plus the **CSRF guard** on every state-changing route. Mutation-tested: six vulnerabilities, all caught.
- [x] **Email verification and password reset** — `/auth/verify-email`, `/auth/verification/resend`, `/auth/password/forgot`, `/auth/password/reset`. Atomic single-use spending, non-leaking forgot reply, all sessions cleared on reset. Mutation-tested: eight vulnerabilities, all caught.
- [x] **Rate limiting** — per email and per IP on log in (5/20 per 15 min, failures only) and reset requests (3/10 per hour, all requests). Attempts recorded for unknown addresses too, so a 429 leaks nothing. Mutation-tested: seven vulnerabilities, all caught.
- [x] **Request middleware** — §6.1 steps 1, 2 and 5 as `attachSession` / `requireAuth` / `requireAdmin`; steps 3, 4 and 6 as `sessionUser()`, `assertOwned()` and the explicit-columns rule. **Mutation-tested**: five deliberate vulnerabilities, all caught.
- [x] **SSE** — `/events` per session user with `Last-Event-ID` resume, `/internal/events` for the worker behind a constant-time secret check, heartbeat, and a 10s sweep as the backstop. Mutation-tested: six vulnerabilities, all caught after three test gaps were fixed.
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
  - [x] ~~Learner home proved the system end to end~~ — it did not. It was signed off as three white cards with no ink panel and no accent phrase, so it proved the tokens and the components but never the composition, and every learner screen built afterwards copied it. Corrected in the learner design pass; see *Screen design coverage*
- [x] Contrast verified — 28 pairs, all passing
- [x] Toolchain — ESLint 9 with `jsx-a11y` (a11y rules as errors), Vitest + Testing Library, axe helper. 21 tests.
- [x] Component gallery route at `/dev/components` — every variant, live token swatches, live contrast table. Dev-only; excluded from production builds.
- [x] Contrast gate — `contrast.test.ts` reads `tokens.css` from disk and asserts all 29 pairs, so §12 is enforced by a test, not by a one-off check
- [x] `AdminShell` — grouped sidebar, persistent Admin indicator, admin Overview screen, and a named placeholder for the other ten §6 screens
- [x] Playwright — 23 tests across the four §11.4 widths, plus live-resize and 320px reflow. **92 assertions passing.**
- [x] ~~Dev session override (`?as=`)~~ — **removed** in Phase 2 when `useSession` became a real `GET /auth/me` query. Playwright now stubs the API at the network boundary (`e2e/session.ts`), which exercises the real session path instead of a development-only branch.
- [x] Named placeholders for every specified-but-unbuilt screen, so no navigation item dead-ends. Each cites the `design.md` section that specifies it.

## Screen design coverage

Every route in [`design.md`](design.md) §4.3, and where each one stands **visually**. This
table exists because the old tracker named the prototype only in the negative — five lines
saying "not in the prototype" — so the 26 routes it *did* cover were tracked as data tasks
and never as design ones. Four learner screens were built from §5's behaviour alone and
never given the system's vocabulary. See [design-source.md](design-source.md) §5.

**"Applied" means built from `First Commit.dc.html`**, not from the design system's generic
`ui_kits/app/`. The first attempt at this used the kit and had to be redone; see the
changelog for 2026-09-22.

| State | Meaning |
|---|---|
| **applied** | Built, and carries the design system: panels, surfaces, the accent phrase |
| **not applied** | Built and correct, but styled from §5's behaviour alone |
| **designed** | The prototype covers it; the route still renders a `Placeholder` |
| **to design** | The prototype does not cover it — design it against §5's rules first |

### Public and onboarding

- [x] `/` · `/signup` · `/login` — **applied** (Phase 1.5 reference screens, straight from the prototype)
- [x] `/forgot-password` · `/reset-password` — **applied**; designed against §5.3 rather than the prototype, which does not cover them
- [x] `/onboarding/about` · `/target` · `/placement` · `/generating` — **applied**, through `OnboardingLayout`
- [ ] `/verify/:code` — **to design**. Public, mobile-first, opened from a QR code

### Learner

- [x] **The learner frame** — ink pill, tabs, white sidebar panel, profile menu
- [x] `/app` — **applied**. Violet hero with the ink current-module card inside it
- [x] `/app/roadmap/:id` — **applied** (header, legend, floating side panel)
  - [ ] The chart itself is our React Flow canvas, not the prototype's row-based spine. Both draw §2.1; reconciling them is its own piece of work
  - [ ] "Roadmap menu" is in the prototype and absent here — §5.7's actions (weekly hours, track, regenerate, archive) have no endpoint
- [x] `/app/roadmap/:id/technology/:decisionId` — **applied**. Primary on the recommended option, secondary on the rest
  - [ ] "Try taster lesson" is in the prototype; taster lessons still have nowhere to live (AGENT.md §11)
- [x] `/app/module/:id` — **applied**. Header panel, notice tile, rail with the quiz as a row, reading panel, test-out strip
- [x] `/app/quiz/:id` — **applied**. Green tick and a sentence on a pass, the same panel either way
- [ ] `/app/roadmaps` · `/app/explore` · `/app/capstone` · `/app/certificates` · `/app/resume` · `/app/settings` — **designed**, not built. Each has a screen in the prototype
- [ ] **Log out** is in the prototype's profile menu and absent here — signing out has no screen yet
- [ ] `/app/exercise/:id` — **designed**, not built (Phase 2, needs CodeMirror)
- [ ] `/app/notifications` — **to design**
- [ ] Reconcile `/app/profile` against §4.3, which folds profile into Settings

### Admin

- [ ] `/admin` — **not applied**. Overview is built, on mock data, and has no panel treatment
- [ ] `/admin/paths` · `/modules` · `/briefs` · `/reviews` · `/flags` · `/analytics` · `/users` · `/settings` · `/log` — **designed**, not built
- [ ] `/admin/certificates` — **to design**

---

## Phase 2 — Learner core

The main loop: sign up → roadmap → learn → pass.

- [x] **Data layer** — TanStack Query, a Zod-validated API client, `Providers`, and MSW so web tests need no database. `useSession` is now a real `GET /auth/me` query, not a stub.
- [x] **Sign up wired** to `POST /auth/signup`

- [x] Landing and Sign up (Phase 1.5)
- [x] **Log in** — built and wired to `POST /auth/login`, with the §5.3 destination rules and the single non-leaking failure message
- [x] **Design + build `/forgot-password` and `/reset-password`** — not in the prototype, so designed against §5.3's rules: one confirmation whatever the address, and a token-less link explained without a round trip
- [x] **Onboarding** — about you, target position, placement, generating; one page per step, resumable via `onboarding_step`. API (`GET /career-paths`, `GET /onboarding`, `PUT /onboarding/about`, `PUT /onboarding/target`, `POST /onboarding/placement`) enforces the step order; `RequireOnboardingStep` mirrors it in the browser for the experience
  - [ ] **Placement questions are not specified.** The schema has no question table and `placement_results.results` is free-form jsonb, so the screen currently offers only the skip §5.4 requires anyway. Settle where the questions come from, then fill the screen and the `results` shape
  - [x] The generating screen now completes: the worker sets `onboarding_step = 'done'` in the same transaction that writes the roadmap
  - [x] ~~A failed roadmap job left the learner on the generating screen forever~~ — the worker backs off between attempts and recovers stranded jobs, `GET /onboarding` reports the job status, and `POST /onboarding/generating/retry` re-queues it. Placement no longer creates a second roadmap each time it runs
  - [ ] **`ai_jobs` has no `next_attempt_at`.** The worker holds a job `running` while it waits out its backoff, which works because there is one worker and one job at a time. A due-time column plus a `claim_next_ai_job()` that skips rows not yet due is the proper shape, and would let the worker take other work while one job waits
  - [ ] Move the generating screen from polling to SSE — the worker already posts to `/internal/events`, so this is a subscription, not new plumbing
  - [ ] **§5.5 Roadmap Review does not exist.** Onboarding currently ends at `/app`, skipping the review the document specifies ("Track [ Frontend ▾ ]", "Adjust weekly hours", "Start learning")
- [x] **Roadmap chart** — React Flow, custom nodes, side panel, the `sm` stacked layout, keyboard navigation and nested-list DOM equivalent. Built on the `Roadmap` type from `design.md` §13.3 against mock data
  - [x] **Fetch a real roadmap** — `GET /roadmaps/:id` builds the §13.3 object from the database; the screen no longer holds mock data
  - [x] ~~§4.3 has no address for the technology choice or the quiz~~ — both are in the route map now, with the reason each is shaped that way
  - [ ] **`pathColor` has no column.** §13.3 has it, `career_paths` does not, so the API derives it from the path id. Either §13.3 drops it or the schema gains it
  - [ ] **`RoadmapModuleNode` has no description**, but §5.7 says the side panel shows one. Add it to §13.3 or drop it from §5.7
  - [ ] **`sharedWithPaths` holds ids, and §2.1 renders names** ("Also in: Data"). The panel says "1 other career path" until the type carries a title
  - [ ] Reinforcement "Remove" and challenge "Skip" are disabled — both change the roadmap, so both need an endpoint
  - [x] ~~`/app/modules` vs `/app/explore`~~ — the router moved to `/app/explore`, which is what §4.3 says
- [x] **Module page, lesson reading, lesson progress** — `GET /modules/:id`, `POST /modules/:id/start`, `POST /lessons/:id/complete`. §5.9's lesson list, 720px reading column, both version notices, and test-out. The open lesson is in the URL
- [x] **Quiz — server-side grading, attempts, test-out** — `GET /assessments/:id` (questions, never the key) and `POST /assessments/:id/attempts` (chosen options only). **The first place the platform writes evidence**; mutation-tested with four deliberate defects
  - [ ] §5.10: "After a second failed attempt, the Roadmap AI may add a reinforcement module, and the result screen says so." The `roadmap_adaptation` job type exists in the enum; nothing queues it
  - [ ] §5.10 shows "I don't know yet" as a quiz option. It is content, and the seeded questions do not offer it
  - [ ] "Review answers" is not built — the result screen shows topics to review and the explanations for correct answers, which is what §5.10 requires, but not a full answer review
  - [x] ~~Only 3 of 19 modules have a quiz~~ — **all 10 core modules** now have three lessons and a five-question quiz. The 9 still empty are concept and technology modules, which come after the technology choice
  - [x] ~~The correct answer was option 0 in all 51 questions~~ — the seed loader rotates each question's options by an amount derived from its prompt, so clicking the top option no longer passes every quiz on the platform
  - [ ] No module has a coding exercise
- [ ] Coding exercise — CodeMirror, Sandpack practice, server grading via Judge0 / Vitest+jsdom, results over SSE
- [x] **Home on real data** — `GET /home`: the Continue panel, roadmap progress, and §5.6's Updates. It reuses `buildRoadmap`, so Home and the chart can never disagree about "You are here"
  - [ ] §5.6: "During the capstone, the Continue panel shows the current milestone instead of a lesson." `ContinuePanel` is a union with one member; the milestone variant arrives with Phase 4
  - [ ] Updates are **derived**, not read from `notifications` — nothing writes that table yet. §5.17's screen is where an event history belongs
  - [ ] §5.6's Updates panel offers "[Remove]" on an AI-added module. That changes the roadmap, so it needs the same endpoint the roadmap panel's Remove is waiting on
- [ ] My roadmaps, Explore modules, Settings
- [ ] **Design + build `/app/notifications`** — not in the prototype (see *Screen design coverage*)
- [ ] Reconcile `/app/profile` vs `design.md` §4.3, which folds profile into Settings

## Phase 3 — AI components

`code_feedback` and `roadmap_generation` work; the other two are stubs with schemas written.

- [x] **Seed content** — `npm run db:seed` loads the Junior Web Developer path from `supabase/seed/`: 2 tracks, 8 skills, 19 modules with prerequisites, 2 technology decisions, 3 quizzes. Idempotent by slug, and it validates the content (cycles, dangling references, core-depends-on-concept) before writing anything
  - [x] **Lesson format settled** — a block list, written into `design.md` §13.3 as `LessonContent`. Five block types, and `text` is plain except for backticks marking inline code, so nothing in a lesson can inject markup. 9 lessons seeded for the three modules with quizzes
  - [ ] This replaces an admin content editor, which is still unbuilt
- [x] **`roadmap_generation`** — handler, prompt, validation against real module IDs, prerequisite order, full core coverage; reject and regenerate on invalid. 24 tests on the validator
  - [x] **Run against the model.** Three runs on qwen3.5:4b: **one attempt each**, 7.5–8s warm, all chose Frontend with an explanation tied to the learner's stated goal. The prompt measures ~2,400 tokens of the 8,192 context, so there is room for the answer and retries
  - [ ] **`apps/worker` has no database test harness**, so `catalogue.ts`, `apply.ts` and the retry backoff are only ever checked against the real database by hand. `apps/api/src/test/db.ts` builds pg-mem from the real migration; moving it to `packages/` would let the worker use it too
  - [x] **`AI_JSON_MODE` measured on this machine** — all three modes 5/5 valid, 5/5 first try on qwen3.5:4b. `think_off_schema` 1.1s, `prompt_only` 1.0s, `think_on_schema` 12.5s. Schema mode is reliable here, so `think_off_schema` stands
  - [ ] Evaluation harness (`project-proposal.md` §9, `model-setup-guide.md` §12) — three runs is a sanity check, not a measurement
  - [~] `apps/worker/.env` exists. Its `DATABASE_URL` points at `db.<project-ref>.supabase.co`, which is **IPv6-only** and unreachable here — use the **session pooler** instead: the API's string with 6543 changed to 5432
  - [x] ~~§5.4 reads as though placement removes modules~~ — it now states the two rules the validator enforces, and that only testing out really skips a module
  - [ ] `weeklySchedule` was removed from `RoadmapPlan` — nothing stored it, and §5.5's "about 14 weeks" is arithmetic the platform does
- [ ] **Roadmap review screen** — AI rationale panel, track override, weekly hours, flag control
- [x] **Technology decision** — comparison, switching, and the AI panel when there is a recommendation to show. `GET`/`POST /roadmaps/:id/decisions/:decisionId`; choosing adds that framework's modules to the roadmap, switching archives the old ones. 23 API tests, 23 screen tests
  - [ ] **Taster lessons are not built.** §5.8 offers "Try taster lesson" per option — "the same small counter in each framework, about 10 minutes" — and the schema has nowhere for one. It is not a module (it is not on the roadmap) and not a lesson (it belongs to no version). Settle where it lives before building it
  - [ ] **`technology_recommendation` is not built**, so the AI panel is absent rather than filled in. The job type is in the enum and `roadmap_technology_choices` already has `recommended_technology_id` and `recommendation_reason`
  - [ ] "Is this wrong?" is disabled until `ai_feedback_flags` has an endpoint
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
- [ ] **Design + build `/verify/:code`** — not in the prototype (see *Screen design coverage*). QR code, mobile-first, revoked state

## Phase 5 — Resume and admin

- [ ] Resume builder — evidence selection, personal details, tailoring, edit, PDF download, ATS parse check
- [ ] Admin overview
- [ ] Career path editor — skills, tracks, technology options, prerequisites, certificate requirements
- [ ] Module editor — lessons, quizzes, exercises, test cases, rubrics; preview
- [ ] **Versioning** — minor edit vs major revision, impact preview, learner update notices
- [ ] Capstone brief and milestone editor
- [ ] Project reviews — repositories, commit history, integrity flags, check overrides
- [ ] Flagged AI feedback review
- [ ] **Design + build `/admin/certificates`** — not in the prototype (see *Screen design coverage*). Templates, lookup, revoke, reissue
- [ ] Analytics — journey funnel, module pass rates, milestone drop-off, technology split, AI flag rate
- [ ] Users — search, suspend, data requests, admin accounts
- [ ] Settings and activity log

---

## Content (parallel track)

Not code, but the MVP is not demonstrable without it (`project-proposal.md` §2.2).

- [x] **Junior Web Developer career path** — 2 tracks, 8 skills, 19 modules, 2 technology decisions
- [x] **Core skill modules — HTML, CSS, JavaScript, Git.** All 10 written: 3 lessons and a 5-question quiz each, every question linked to the lesson that taught it
- [ ] **Concept modules** — What are components, Fetching data, How the web talks. These come after the technology choice, so a learner reaches them later
- [ ] **Technology modules** — Components and State/props in React and Vue, Routing in Express and Django
- [ ] Placement assessment questions
- [ ] Coding exercises — no module has one yet, and §5.11's screen is unbuilt
- [ ] At least one capstone brief with milestones, checks, and starter templates for both technologies
