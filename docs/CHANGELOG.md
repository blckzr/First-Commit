# Changelog

Task log for First Commit. Every task adds an entry here before it is considered done
(see [`AGENT.md`](../AGENT.md) §10).

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). This project
does **not** follow semantic versioning yet — it is pre-release, so everything
lives under `[Unreleased]` until there is something to version.

---

## [Unreleased]

### 2026-09-21 — The roadmap becomes finishable

Every generated roadmap has a technology decision on it, and the screen behind it was a
placeholder — so the five technology modules in the seeded path could never appear, and the
roadmap was decorative past that node. Choosing now rebuilds the plan around the answer.

Verified against the live database: the test learner's roadmap went from 12 modules to 14
on choosing React, stayed at 14 when switching to Vue (React's two archived, Vue's two
added), and `module_completions` was untouched throughout.

#### Added

- **`GET` and `POST /roadmaps/:roadmapId/decisions/:decisionId`** — 23 tests.
  - Nested under the roadmap because that is where the answer lives:
    `roadmap_technology_choices` is keyed on `(roadmap_id, decision_id)`, so the same
    decision on two of a learner's roadmaps is two separate choices. It also puts both ids
    in the URL, where both get checked against the session on every call.
  - **Choosing rebuilds the technology part of the roadmap**: the chosen framework's
    modules are appended in the admin's order, and every other framework's are set to
    `status = 'removed'`.
  - **Nothing touches `module_completions`.** §5.8 promises "your 3 passed React modules
    stay on your resume", and a switch changes the *plan*, never the evidence (§6 rules 1
    and 5). Archiving rather than deleting also means switching back finds the original
    plan instead of a duplicate — there is a test for exactly that.
  - The body carries `technologyId` and nothing else, `.strict()`, so a request trying to
    name its own module list is a 400.
- **The technology choice screen** (§5.8) at
  `/app/roadmap/:id/technology/:decisionId` — 23 tests.
  - §5.8's two confirmations: "Your roadmap will use React" on a first choice, and the full
    switch explanation otherwise — core modules stay passed, the passed framework modules
    stay on the resume, the new framework's modules replace the old.
  - The AI panel renders only when there is a recommendation. `technology_recommendation`
    is not built, so today there never is — absent, rather than filled with a guess.
  - The recommended option is marked **in words** (§12), not by colour.
- The roadmap side panel's decision action now goes to the real screen instead of a
  placeholder route.

#### Fixed

- Comparison labels were title case ("Learning Curve"). §9 commits to sentence case for
  labels, so `learningCurve` now reads "Learning curve". Caught by a test asserting the
  copy rule rather than by reading the output.

#### Notes

- **Three pg-mem incompatibilities**, all found by tests that could not otherwise have run:
  `for update of <alias>` does not parse (widened to plain `for update`, which locks the
  roadmap row too and is the safer lock anyway); an `update … as alias … from` does not
  resolve the target (rewritten as a subquery).
- **Four ownership and evidence filters were removed to test them**, and the first pass
  caught two. Both survivors were missing cases rather than working code:
  - a technology that is a valid option *of another decision* — choosing Express on the
    Frontend decision would put Backend modules on a Frontend roadmap. The obvious test
    used a technology with no `decision_options` row at all, which fails either way.
  - the passed-module count read every learner's completions, so another learner's
    progress would appear in this learner's switch dialog.
  Re-run afterwards, all four failed.
- On the browser side, three more: sending a module list alongside the choice, skipping the
  confirmation, and dropping the resume promise from the switch dialog. All three caught.
- **Taster lessons are not built.** §5.8 offers one per option and the schema has nowhere
  for it — it is not a module (not on the roadmap) and not a lesson (belongs to no
  version). Left out rather than rendered as a dead button, and recorded.

### 2026-09-21 — Home stops lying

Home was the last screen still on mock data, and it is the first thing a learner sees after
onboarding — so it was the most visible falsehood left in the app. It now answers §5.6's
one question, "what do I do next?", from the database.

Verified against the live database: the test learner who passed HTML basics earlier sees
`1 of 12 passed` and a Continue panel pointing at `Forms and semantics`, which is exactly
what the roadmap says.

#### Added

- **`GET /home`** — §5.6's three panels. 16 tests.
  - **It reuses `buildRoadmap` rather than recomputing.** "You are here" is decided in one
    place, so Home and the chart can never disagree about which module the learner is on —
    the drift that makes a dashboard untrustworthy. It costs a few extra queries; Home is
    not a hot path and agreeing is worth more than the milliseconds.
  - The Continue panel resolves the lesson the learner actually stopped at, falling back to
    the first when they have not started or when their bookmark points at a lesson the
    version no longer has.
  - `ContinuePanel` is a **union with one member**. §5.6 says the capstone replaces the
    lesson panel with a milestone one, so shaping it now means the browser's exhaustive
    switch will refuse to compile until that variant is rendered.
  - **Updates are derived, not read from `notifications`.** Nothing writes that table yet,
    and these are statements about the roadmap as it stands — "the AI added this", "a
    module you passed moved on" — which stay true until acted on. An event log belongs on
    §5.17's screen, where a dealt-with event still makes sense.
- **The Home screen**, rewritten against the API. 18 tests, including §5.6's empty state
  ("Choose a target job to build your first roadmap"), a loading state, a failure that
  reassures rather than blames, and an unparseable response treated as a failure rather
  than an empty Home.
- The Playwright `signedIn` helper now stubs `/home` too, since every `/app` page renders
  the learner shell and several specs land on Home on the way elsewhere.

#### Notes

- **Three ownership filters were removed to test them**, and the first pass caught only
  one. Both survivors were test gaps, not working code:
  - the active-roadmap lookup is backstopped by `buildRoadmap`, which filters by user
    anyway — so the obvious "don't show another learner's roadmap" test passed either way.
    The case that actually bites is a learner who **has** a roadmap when someone else's is
    newer: their own would vanish from Home. That test now exists.
  - a version-update notice read `module_completions` across all learners. The module is on
    both roadmaps, so only `user_id` tells them apart, and there was no test for it.
  All three were then re-run and all three failed.
- Home writes nothing, and a test asserts that reading it leaves `module_completions`,
  `module_enrollments` and `lesson_progress` untouched.
- §5.6's Updates panel offers "[Remove]" on an AI-added module. That changes the roadmap,
  so it is left out rather than rendered as a dead button — the same endpoint the roadmap
  side panel's Remove is waiting on.

### 2026-09-21 — The module page and the quiz: the platform writes evidence

Before this, `module_completions` had never been written by any code path, so every
roadmap sat permanently at "nothing passed". This is the loop that moves it — and it is
where AGENT.md §6 rule 1 stops being a rule in a document and becomes code.

Verified end to end against real PostgreSQL: grading the seeded HTML basics quiz 6/6 turned
`HTML basics` from `current` to `passed (100%)`, moved "You are here" to
`Forms and semantics`, unlocked `CSS basics`, and took the roadmap from 0 to 1 of 12.

#### Added

- **The lesson format**, settled and written into `design.md` §13.3 as `LessonContent`: a
  block list of five types. Not a rich-text document and not markdown — the §5.9 reading
  column needs exactly these five things, a block list renders without a parser, and a
  runnable example stays its own block with its own language.
  - `text` is plain with **one** inline rule: `backticks` mark inline code. There is no
    other markup and no escape hatch, which is what lets the renderer put everything in a
    text node. A test renders `<strong>bold</strong>` from a lesson and asserts no
    `<strong>` element exists — a lesson teaching HTML is full of tags in prose.
- **9 lessons seeded** for the three modules that have quizzes, and every quiz question now
  links to the lesson it came from, which is what §5.10's failed-quiz screen needs. The
  seed validator rejects a question pointing at a lesson that does not exist.
- **`GET /modules/:id`, `POST /modules/:id/start`, `POST /lessons/:id/complete`** and the
  module page (§5.9). 29 API tests.
  - Starting a module **pins the learner to the version published now** (§6 rule 6). A
    later publish shows a notice and never repoints them; the page has both of §5.9's
    notices, one for a learner mid-module and one for a learner who already passed.
  - The bookmark moves forward and never back, so re-reading lesson 1 does not undo
    reaching lesson 3.
  - A lesson's ownership check is that it belongs to a version the learner is enrolled in.
- **`GET /assessments/:id` and `POST /assessments/:id/attempts`** — the quiz, and the
  grading behind it.
  - **The body carries chosen option ids and nothing else.** The Zod schema is `.strict()`,
    so a body with `score` or `passed` alongside is a 400, not something silently ignored —
    the refusal is visible in a test and in a log.
  - The score is computed from `quiz_answer_keys`, which no learner endpoint selects from.
    The question endpoint withholds the explanations too, because an explanation usually
    states the answer.
  - §5.10: **a wrong answer gets no correct option and no explanation back**, so a retake
    still means something. It gets the lesson to go back to instead.
  - A retake keeps the better score, and never turns a test-out into an ordinary pass.
- **The quiz screen** (§5.10): one question at a time, no time limit and it says so,
  answers kept while moving between questions, and a result screen with §5.10's three
  states. 20 tests.
- **`LessonBody`** — renders the block list with an exhaustive `switch`, so a block type
  added to the format without a renderer is a compile error rather than a gap in someone's
  lesson.

#### Fixed

- **pg-mem cannot resolve a correlated subquery against an outer alias.** The module page's
  question and attempt counts were subqueries in the select list; they threw
  `column "a.id" does not exist`, which meant the endpoint could not be tested at all.
  Rewritten as three plain queries merged in JS.
- `xmax = 0` (to detect an insert versus an update) and `update … from` are PostgreSQL-only
  and pg-mem runs neither. Both replaced with a read-then-write, which is clearer anyway.
- The module page's Previous button disappeared on the first lesson instead of being
  disabled, which moved the Next button under the reader's cursor. §5.9 shows Previous on
  every lesson.

#### Notes

- **Four deliberate defects were introduced into grading**, the most security-critical code
  in the repo so far: handing back the answer for a wrong response, accepting an option
  from another question, letting a retake lower the recorded score, and dropping `.strict()`
  from the body. The first pass caught only two — both surviving defects were **my tests
  asserting the wrong thing**, not the code being right:
  - the option-from-another-question check does not change the *grade* (the comparison is
    per question); it protects the **stored attempt**, which is what an admin reads in a
    dispute. The test now asserts that.
  - a failing retake never reaches the completion at all, so it proves nothing about which
    score is kept. The test now uses a *passing* retake that scores lower.
  Both were then re-run and all four failed the suite.
- A fifth defect — rendering lesson text through `dangerouslySetInnerHTML` — survived the
  first pass too, because the only test used text *with* backticks and the shortcut only
  applied to text without them. The no-backticks test above was added, and it catches it.
- §5.10's "After a second failed attempt, the Roadmap AI may add a reinforcement module" is
  not built. `roadmap_adaptation` is in the job-type enum and nothing queues it.
- §4.3 still has no address for the quiz, as it has none for the technology choice.
  `/app/quiz/:id` is the router's choice, recorded in the tracker.

### 2026-09-21 — Sign up now leads to a real roadmap

Before this, the learner journey dead-ended: `career_paths` was empty, so the onboarding
target step had nothing to offer, and `/onboarding/generating` waited forever because
`roadmap_generation` was a worker stub. Three pieces close that loop — content to choose
from, a worker that plans a roadmap from it, and an endpoint the chart reads.

#### Added

- **`npm run db:seed`** — `scripts/seed.mjs` loads `supabase/seed/junior-web-developer.mjs`:
  one career path, 2 tracks (Frontend, Backend), 4 technologies, 8 skills, 19 modules with
  published versions and prerequisites, 2 technology decisions, and 3 quizzes with answer
  keys. 74 rows in all.
  - The content is **data in its own file**; the script is only the loader. Until an admin
    content editor exists, that file is what "an admin defined" means.
  - **Idempotent by slug**, so re-running after an edit applies the edit. Two runs produce
    identical row counts — checked, not assumed.
  - **It validates before it writes**, and `--dry-run` does that with no database:
    prerequisite cycles, dangling references, a technology module with no technology, an
    answer key pointing outside its options, and a core module depending on a track's
    concept module (which would strand every learner on the other track). Five deliberate
    defects were introduced; all five were reported at once.
  - It never deletes and never touches learner data.
- **`roadmap_generation` in the worker** — `apps/worker/src/roadmap/`, plus a versioned
  prompt. 24 tests.
  - `catalogue.ts` reads the published content and the real learner from the database,
    **never from the job payload** — a payload is a snapshot someone else wrote.
  - `validate.ts` is the part AGENT.md §7 rests on: real module ids, no duplicates, no
    technology modules (those arrive with the learner's choice), full core coverage, the
    track's own modules, and prerequisite order. It returns **one message at a time**,
    because that message is fed back to the model as the next turn, and six complaints
    make a worse prompt than one instruction.
  - The prompt presents the catalogue **already in a valid order**, so a model that changes
    nothing still returns something valid. Choosing the track, what to skip and how to
    sequence within the constraints is still entirely its own.
  - Prompts register themselves in `ai_prompts` on startup and the version is recorded on
    each job. The worker **refuses to start** if the stored text for a version differs from
    the code — which is how "never change a prompt in place" stops being a rule people
    remember and starts being one the process enforces.
- **`GET /roadmaps/:id` and `GET /roadmaps`** — `apps/api/src/roadmaps/`, 24 tests.
  `buildRoadmap` assembles the `Roadmap` object design.md §13.3 defines, computing every
  status from `module_completions` and `module_enrollments`.
  - Ownership is the whole job: the first query filters on `user_id`, and a roadmap that is
    not the caller's is a **404, not a 403** — a 403 would confirm it exists. Mutation-tested
    by removing both ownership filters; both tests failed.
  - Six tests assert the absence of a write path: no POST, PUT, PATCH or DELETE exists on
    either route, sent with a valid Origin so the 404 proves there is no route rather than
    that CSRF stopped it.
- **The roadmap screen fetches its roadmap.** `api/roadmaps.ts` validates the response with
  a Zod discriminated union on `type`, so a step type the API adds before the browser knows
  about it is a parse failure rather than a node that renders nothing. Loading, not-found
  and unparseable responses each have copy and a test.
- **`npm run try:roadmap -- <userId> <slug> [--stub]`** — generates one roadmap against the
  real database. `--stub` skips Ollama and uses the catalogue's own order, which puts the
  catalogue query, the validator and the writes under test with no GPU. The stub plan goes
  through the same validator and would be rejected the same way.
- Vitest in `apps/worker`, which had no test runner at all.

#### Changed

- **`POST /onboarding/placement` now creates the roadmap row** and passes its id as the
  job's `source_id`. The API owns business rules, so whose roadmap it is comes from the
  session — the worker refuses a job without a `source_id` it can verify belongs to that
  learner and career path. Previously `source_id` was `gen_random_uuid()`, which pointed at
  nothing.
- **The worker sets `onboarding_step = 'done'`** in the same transaction that writes the
  roadmap. That is what the generating screen has been waiting for; it polls, sees `done`,
  and leaves for the app.
- **`weeklySchedule` removed from `RoadmapPlan`.** Nothing stored it, and §5.5's
  "about 14 weeks at 6 hours a week" is `sum(estimated_hours) / weekly_hours` — arithmetic
  the platform does exactly. Asking a model for it is what §7 exists to prevent, and it
  costs tokens on an 8GB budget.
- The mock roadmap moved from `features/roadmap/mock.ts` to `src/test/roadmap.ts`. It is
  now a fixture shared by the component tests and the Playwright stubs, not something the
  app ships.

#### Fixed

- **`= any($1::uuid[])` returns nothing under pg-mem.** Four lookups in the roadmap builder
  — prerequisites, version numbers, shared paths, archived modules — silently returned
  empty, which showed up as modules reporting `available` when their prerequisites were not
  met. Rewritten as joins back to `roadmap_items`, which is better SQL anyway. Caught
  because the status tests asserted the whole status map rather than one module.
- The test schema now handles `unique nulls not distinct` (PostgreSQL 15+, which pg-mem
  cannot parse), in a named list of exceptions rather than a general cleanup.
- The validator crashed on the first dangling module reference instead of reporting every
  problem. Found by feeding it five defects at once.

#### Notes

- **The model has never been asked.** Ollama was not running, so `roadmap_generation` is
  verified end to end against real PostgreSQL with the plan stubbed — catalogue, validator,
  writes, and the resulting `Roadmap` the chart reads. The prompt itself is unexercised.
  Start Ollama and run `npm run try:roadmap` without `--stub`.
- **Placement can barely skip anything, and that is correct.** Skipping writes no
  `module_completions` row, so a skipped module cannot be required for the certificate
  (the learner could never earn it) and cannot be a prerequisite of anything on the roadmap
  (it would never unlock). Only testing out really skips a module, because only that
  produces evidence. §5.4 reads as though placement removes modules and should say this.
  The first version of the rule allowed a skipped prerequisite; a test caught it.
- **`pathColor` has no column.** §13.3 has it, `career_paths` does not, so the API derives
  it from the path id — stable, because a roadmap that changes colour reads as a different
  roadmap. Recorded for §13.3 or the schema to settle.
- A test learner (`roadmap-check@example.invalid`) exists in the development database with
  a generated roadmap, from verifying the pipeline. It can be deleted.

### 2026-09-21 — The roadmap chart

The screen the whole product is named after (`design.md` §2.1, §5.7): a vertical main path
with modules branching left and right, a side panel, and the same roadmap as a single
column on `sm`. Built against the `Roadmap` type from §13.3, on mock data.

#### Added

- **`features/roadmap/`** — the §13.3 types verbatim, a mock roadmap, the status
  vocabulary, the accessible labels, and the layout.
  - `status.ts` is **the one place** that decides a status's icon, words and colour, so the
    node, the list, the panel and the screen reader can never disagree (§8).
  - `mock.ts` is filled out to exercise every branch the components have: all six statuses,
    all five module kinds, an unmade decision, three milestones. It sits beside the types,
    not in a test file, so a type change breaks it immediately.
  - `layout.ts` is **written rather than delegated to elkjs or dagre**. §13.1 offers those
    and closes with "alternatives with the same capabilities are acceptable"; the roadmap
    is not a general graph but a fixed spine with known children, so a solver would add a
    large async dependency to compute what 40 lines decide exactly. It is synchronous, so
    the chart has no frame with every node at the origin, and pure, so its 8 tests assert
    on real coordinates. The admin editor's free-form prerequisite graph may still want a
    solver.
- **`components/roadmap/`** — `RoadmapNav`, `RoadmapChart`, `RoadmapStacked`,
  `RoadmapPanel`, and the four chart node components.
  - **There is one roadmap in the DOM, not two.** The nested list §12 requires is the real
    structure: on `sm` it *is* the view, and on `md`/`lg` it sits inside the chart region
    clipped to a pixel — clipped, not `display: none`, because a hidden element cannot be
    focused. The canvas is `aria-hidden`, so a screen reader reads the roadmap once, and
    the chart node matching the focused list item draws the focus ring. A keyboard user and
    a mouse user move through the same state.
  - Arrow keys walk the roadmap, Left and Right step between a skill and its modules, Home
    and End jump to the ends, Enter opens the panel and focus moves to its heading, Escape
    closes it and focus returns to the node (§12).
  - Roving tabindex: one tab stop for the whole roadmap, so Tab leaves it rather than
    walking 25 nodes.
  - The selected node lives in **the URL**, so it survives the breakpoint change §13.5
    requires and a node is linkable.
  - Nothing in the panel writes progress. §5.7: "Learners cannot mark modules as done
    manually" — a test asserts no control offers to.
- **`/app/roadmap/:id`** replaces its placeholder. 31 component tests, 8 layout tests,
  8 end-to-end tests across the four widths.
- `@xyflow/react`, the first new dependency since the toolchain.
- **`src/test/viewport.ts`** — a `matchMedia` and `ResizeObserver` for jsdom, which has
  neither. `useBreakpoint` is the one place §13.5 lets JavaScript decide layout, and it had
  never run in a test; `setBreakpoint()` also makes "state survives a breakpoint change"
  testable without a browser.

#### Fixed

- **The learner shell's main column shrank to its content.** `margin: 0 auto` on a grid
  item turns off the default stretch, so a page whose content can collapse — the roadmap's
  canvas beside its panel — collapsed the whole column with it: the canvas rendered 2px
  wide. Adding `width: 100%` fixes it for every screen, not just this one. Found by
  screenshotting the built page, which nothing in the test suite would have caught.
- **`--text-muted` on `--surface-card-soft` measures 4.44:1**, just under the 4.5:1 §12
  commits to. The milestone node's meta line now uses `--text-body`. Found by the contrast
  gate, which gained six pairs for the surfaces and edges the roadmap introduced.

#### Notes

- **The roadmap is mock data.** `roadmap_generation` is a worker stub, so there is nothing
  to fetch. The screen is built against the type the API should return, so wiring it later
  is a query rather than a rewrite.
- Four gaps between the code and the documents are recorded in `docs/task-tracker.md`
  rather than patched quietly: §4.3 has no address for the technology choice screen that
  §5.8 specifies; `RoadmapModuleNode` has no description although §5.7's panel shows one;
  `sharedWithPaths` holds ids while §2.1 renders names; and the router says `/app/modules`
  where §4.3 says `/app/explore`.
- Four defects were introduced to check the tests earn their keep: a step type nobody
  handles (five compile errors, which is exactly what §13.3 promises), every node in the
  tab order, focus not returning when the panel closes, and the assistive list hidden
  instead of clipped. All four failed the suite; all four were reverted.

### 2026-09-21 — Password reset and onboarding

Two of the three screens groups Phase 2 was missing. Both are specified in `design.md` but
neither existed in the prototype, so both were designed from the copy and security rules
rather than ported.

#### Added

- **`/forgot-password` and `/reset-password`** (`apps/web/src/routes/public/`).
  - The forgot page shows **one confirmation whatever the address**, because §5.3 says the
    page never reveals which emails are registered. There is deliberately no second,
    cheerier state for "we really did send it" — the screen cannot know which case it is in,
    and a test asserts no such wording appears.
  - The reset page reads the token from the query string, checks the confirmation field
    before calling anything, and **explains a link with no token at all without a round
    trip** — mail clients truncate long URLs, and "invalid token" from the server would
    leave the learner guessing.
  - 12 tests.
- **The onboarding API** (`apps/api/src/onboarding/`): `GET /career-paths`,
  `GET /onboarding`, `PUT /onboarding/about`, `PUT /onboarding/target`,
  `POST /onboarding/placement`. 20 tests.
  - Every write is scoped to `req.user.id` from the session; a test sends another learner's
    id in the body and asserts their row is untouched (§6.1 step 3).
  - **Step order is enforced here, not in the browser.** Jumping ahead is a 409. Redoing a
    finished step saves the new answer without dragging the learner backwards.
  - `GET /career-paths` returns published paths only, so a draft is never a learner's to
    pick — asserted for both `draft` and `archived`.
  - Placement writes `placement_results` and queues the `roadmap_generation` job **in one
    transaction**, so a queued job never exists without the result it was queued for.
- **The four onboarding screens** (`apps/web/src/routes/onboarding/`), wired into the
  router in place of their placeholders. 20 component tests, 6 end-to-end tests across the
  four widths.
  - `RequireOnboardingStep` sends a learner who jumps ahead back to their first unfinished
    step, and lets them go *back* freely — that is how §5.4 says earlier answers get
    changed. It mirrors the API's 409; it does not replace it.
  - The generating screen polls `GET /onboarding` and leaves for `/app` when the API reports
    `done`. **The browser decides nothing here** — the worker moves the step.
- **`apps/web/src/app/guards.test.tsx`** — the guards had no tests at all. 13 now cover the
  onboarding order, the learner/admin split, and that protected content never renders while
  the session is still loading.

#### Fixed

- **The onboarding header scrolled sideways at 360px.** Four step labels plus the rules
  between them need about 440px. Below `md` the header now shows "Step 2 of 4" and the full
  indicator appears from 640px — one layout, a CSS swap, no view switcher (§11.1). Found by
  a new 320px reflow check, not by reading the CSS.

#### Notes

- **Placement has no questions yet**, because the schema has no table for them and
  `placement_results.results` is free-form jsonb (`AGENT.md` §11). The screen therefore
  offers only the skip that §5.4 requires be available anyway, and records an empty result.
  It says so to the learner rather than pretending to have assessed them.
- **The generating screen waits on work that does not happen yet.** `roadmap_generation` is
  a worker stub, so the queued job sits there. The screen is built for the real thing and
  will complete on its own once the handler exists; the poll should become SSE then.
- Its progress bar carries **no `aria-valuenow` and no percentage**. The wait has no
  measurable progress, so any number would be invented. A test asserts none appears.
- Three deliberate defects were introduced to check the tests earn their keep — a guard that
  lets a learner jump ahead, a slack upper bound on weekly hours, and a generating screen
  that never leaves. All three failed the suite; all three were reverted.

### 2026-09-21 — Database tooling, and the project is personal, not academic

#### Changed

- **The project is a personal one, not a thesis.** `AGENT.md` §1 and `README.md` said
  otherwise, and that framing had been doing real work in the reasoning — "the documents are
  defended" was the stated reason for several decisions. The reason is now the honest one:
  `docs/` is a specification the author wrote and intends to follow, so code matches it, and
  where a document is wrong it gets changed rather than quietly diverged from. The rigour
  stays; only the justification changes.
- Corrected drift in `README.md` and `AGENT.md` §4 that had accumulated over the last few
  tasks: both still claimed `apps/api` and `apps/web` were unscaffolded, that TanStack Query
  and Zod were not installed, and that the API had only `/health`. The tracker still listed
  the `?as=` dev override that was removed when `useSession` became real.

#### Added

- **`scripts/db.mjs`**, as `npm run db:migrate` and `npm run db:verify`.
  - `migrate` applies every file in `supabase/migrations` in order, each in a transaction,
    recording it in `schema_migrations` so a second run is a no-op. It refuses to silently
    accept a migration file that changed after it was applied.
  - **`verify` is the point.** The API's tests run against pg-mem, which executes neither
    triggers nor plpgsql — so `claim_next_ai_job()`, `prevent_log_changes()` and
    `set_updated_at()` have never actually run. `verify` exercises all three against the
    real database, plus counts tables, functions and triggers.

#### Notes

- **Supabase itself still needs the author**: creating the project requires a login, so the
  repo side is what was prepared. Once a connection string is in `apps/api/.env`, the two
  commands above close the verification gap.
- `docs/project-proposal.md` is still written as an academic study — "Proponent(s)",
  "Adviser", a defense, and an evaluation plan built on ISO/IEC 25010 and usability
  respondents. `database-schema.md` also refers to backups "before the defense". Those are
  the author's own documents and were left alone; they are worth a pass if the academic
  framing is going away entirely.

### 2026-09-21 — Phase 2 begins: the web app talks to the API

The three existing screens stop being mockups. Sign up and log in now work against the real
endpoints, and every later screen has a data layer to build on.

#### Added

- **`src/api/`** — one client that sets `credentials: "include"` on every request (the
  session is an `httpOnly` cookie), maps failures to an `ApiError` whose message is safe to
  display, and **validates every response with Zod** before the app trusts it. A shape
  change fails loudly at the boundary instead of surfacing as an undefined three components
  deep.
- **TanStack Query**, with a 401 excluded from retries: no session is a normal state, not a
  failure worth hammering the API over while the learner waits.
- **`app/providers.tsx`**, so tests build the same tree with their own client.
- **The log-in screen** (design.md §5.3), wired to `POST /auth/login`. It honours the §5.3
  destinations — admin to `/admin`, a learner mid-onboarding to their step, everyone else
  to `/app` — and `location.state.from` when a guard sent them there.
- **MSW**, so web tests exercise the real fetch path with no database and no running server.
  `onUnhandledRequest: "error"`, so a component reaching an unstubbed endpoint fails the
  test rather than escaping to the network.
- 11 new web tests covering the auth flow.

#### Changed

- **`useSession` is no longer a stub.** It asks `GET /auth/me`, so the role comes from the
  server exactly as design.md §13.6 requires. The `?as=` development override is **gone**.
- **`GET /auth/me` now returns `onboardingStep`.** Removing the stub exposed that it did
  not: §4.3 sends a learner with unfinished onboarding back to their current step, which
  means the browser needs that value on *every* request, not only in a log-in reply. `'done'`
  and a missing learner profile both read as null.
- **Playwright now stubs the API at the network boundary** (`e2e/session.ts`) instead of
  using the removed `?as=` override. This is the better test: the app runs its real session
  query and its real guards against a real response, rather than a branch that only existed
  in development.
- Sign up puts "That email is already registered" **under the email field**, where the
  learner is looking, and everything else above the button.

#### A deliberate difference between the two screens

Sign up reports a taken address under the field. **Log in never does** — its one message sits
above the button, because pointing at a field would imply the other one was right, and
that is exactly what `database-schema.md` §6.3 refuses to reveal. There is a test asserting
neither log-in field carries `aria-invalid` after a failure.

#### Verified

130 API tests, 70 web tests, **96 Playwright assertions across four viewports**, all three
workspaces typecheck, lint clean, build succeeds.

#### Notes

- **None of this has run against the real API yet** — there is still no database. The web
  tests stub the API and the API tests stub the database, so the two contracts are asserted
  independently but never against each other. The first run with Postgres behind it is still
  the outstanding check.

### 2026-09-21 — Server-sent events

Phase 1 is 9 of 10. The worker-to-browser path is closed: the worker writes a result, posts
to the API, and the learner's open stream receives it.

#### Added

- **`GET /events`** — one stream per session user. Scoped to `req.user.id`, never to
  anything in the query string.
- **`POST /internal/events`** — the worker's hint, behind a constant-time `WORKER_SECRET`
  check and **mounted before the CSRF guard**, because the worker is not a browser and sends
  no `Origin`. The body says only *who* has something waiting; the API reads the rows itself,
  so even a leaked secret cannot inject content into a learner's stream.
- **`EventHub`** — connection registry, 25s heartbeat so proxies do not close idle streams,
  and a **10s sweep** that finds rows whose notify never arrived. That sweep is why the
  worker can treat a failed post as non-fatal.
- **Resume after a dropped connection.** Each frame carries an `id` of
  `createdAt|rowId`, which the browser replays as `Last-Event-ID`. Rows are ordered and
  compared on **both halves**, because two rows can share a timestamp and comparing on the
  timestamp alone would silently drop one.
- `X-Accel-Buffering: no`, since proxies buffer by default and would hold events until the
  response ended — the opposite of the point.

#### Verified by mutation testing — and it found four real gaps

Six vulnerabilities. **Only two were caught on the first pass.** Each miss was a genuine
hole in the tests, not a false alarm:

| Vulnerability | First pass | Why it was missed |
|---|---|---|
| Stream scoped to a query param, not the session | missed | The test never flushed for the *other* user, so a wrongly-registered stream received nothing either way |
| Hub ignores its user filter, fanning out to everyone | missed | Only one stream was ever open, so there was nobody to leak to |
| Internal route accepts any secret | missed | **`WORKER_SECRET` was unset in tests**, so the route 404'd before ever reaching the comparison |
| Internal route open when no secret is configured | caught | |
| Cursor ignored, so reconnecting replays everything | caught | |
| Cursor drops rows sharing a timestamp | missed | The test read with no cursor, so the tie-break branch never ran |

Fixed by setting `WORKER_SECRET` in the test setup, opening **two concurrent streams** from
different learners, flushing for the other user while connected, and resuming from the
lower-sorting of two rows that share a timestamp. All six are now caught.

The third row is the one worth remembering: a whole authentication check had **no coverage
at all** and every test around it was green, because an earlier guard was short-circuiting
the request first.

#### Changed

- `workerSecret` is injectable through `createApp`, like the pool and the mailer, so the
  unconfigured case can be tested.
- `src/test/db.ts` now also loads `ai_jobs` and `ai_outputs` from the real migration.
- `index.ts` closes open streams on SIGTERM before `server.close()`, which would otherwise
  wait on them forever.

**129 API tests**, 59 web, all three workspaces typecheck.

#### Notes

- **The hub's state lives in one process.** Render runs a single free instance, so this is
  correct today. With two instances, a learner connected to A would not get a notify
  delivered to B — the sweep would still find it, just later. `LISTEN/NOTIFY` is not the fix,
  because the pooler does not support it; a shared bus would be.

### 2026-09-21 — Rate limiting

Phase 1 is 8 of 10.

#### Added

- **`enforceLimit` / `recordAttempt`** over `auth_attempts`, on the two endpoints §6.3 names.

| Endpoint | Per email | Per IP | Window | Counts |
|---|---|---|---|---|
| `POST /auth/login` | 5 | 20 | 15 min | failures only |
| `POST /auth/password/forgot` | 3 | 10 | 1 hour | every request |

Two dimensions because they stop different attacks. **Per email** stops credential stuffing
against one account; its cost is that someone can lock a specific address out for the length
of the window, so that window is short. **Per IP** stops one machine spraying many
addresses, which the per-email limit cannot see at all.

Reset requests count *every* attempt rather than only failures, because a reset request has
no meaningful failure — each one sends an email.

#### The detail that matters most

**Attempts are recorded whether or not the address has an account.** If rows were only
written for real accounts, a 429 would mean "this account exists" — and the limiter meant to
protect §6.3's non-leaking guarantee would have become the enumeration oracle it was
protecting against. There is a test asserting a rate-limited known address and a
rate-limited unknown one return identical bodies.

**The limit is checked before the password is verified**, so an attacker cannot spend the
endpoint's own argon2id cost against it. A mutation moving the check after the verify is
caught.

#### Verified by mutation testing

Seven vulnerabilities, one at a time; **every one caught**:

| Vulnerability | Caught |
|---|---|
| Per-email limit never fires | yes |
| Per-IP limit never fires | yes |
| Window ignored, so attempts never expire | yes |
| Attempts not recorded for an unknown address | yes |
| Limit checked after the password verify | yes |
| Successful logins count toward the limit | yes |
| Reset requests counted only when an account matched | yes |

**108 API tests**, 59 web, all three workspaces typecheck.

#### Notes

- Sign up is deliberately **not** rate-limited. §6.3 names log in and reset requests, and
  this follows the document. It is worth revisiting before the platform is public, since
  unlimited sign up means unlimited junk accounts and unlimited outbound verification mail
  against a 300-a-day Brevo allowance.
- `purge_expired_auth_rows()` already exists in the schema to trim the table; §9.3 step 9
  schedules it.

### 2026-09-21 — Email verification and password reset

Phase 1 is 7 of 10. The auth story is complete apart from rate limiting.

#### Added

- **`POST /auth/verify-email`** — spends the token issued at sign up.
- **`POST /auth/verification/resend`** — a new link, session required.
- **`POST /auth/password/forgot`** — always the same reply.
- **`POST /auth/password/reset`** — sets the password, then clears every session.
- **`spendToken` / `issueToken`**, shared by both flows.

#### The race a select-then-update would have left open

Spending a token is **one statement**:

```sql
update password_reset_tokens set used_at = now()
 where token_hash = $1 and used_at is null and expires_at > now()
returning user_id
```

Checking first and updating second would let two requests carrying the same link both pass
the check before either wrote — which matters, because a leaked reset link is exactly the
thing worth replaying. As one atomic compare-and-set the second request matches zero rows.
Expiry is judged by the database clock, so clock drift cannot extend a link.

**Asking for a new link kills the old one.** Otherwise every request leaves another live
link in another inbox, and the oldest is the most likely to have been forwarded or caught by
a mail scanner.

#### Leak-proofing

- Expired, already used, and never valid give the **identical** response, with a test
  asserting the bodies are equal. Distinguishing them would tell a stranger which links
  exist.
- `forgot-password` answers the same for a registered and an unregistered address — and
  **a mail failure is logged, never surfaced**, because a 502 there would mean "this address
  exists".
- A suspended account gets no reset link.
- Resend needs a session, so it cannot be used to probe addresses.

#### Decided

A password reset now also confirms the email address. Following an emailed link proves
control of the inbox, which is the same thing verification asks for; a second link would be
ceremony. Not something the documents specify either way, so it is recorded here.

#### Verified by mutation testing

Eight vulnerabilities, one at a time. Seven caught immediately. **The eighth exposed a real
gap in the tests**: dropping `requireAuth` from the resend route still returned 401, because
`sessionUser()` throws by design — but `requireAuth` *also* rejects suspended accounts and
`sessionUser()` does not, and nothing covered that. Added the missing test; the mutation is
now caught.

| Vulnerability | Caught |
|---|---|
| Token spendable twice | yes |
| Expired token still spends | yes |
| Raw token compared against the stored column | yes |
| A new link leaves the old one live | yes |
| Forgot-password reveals an unknown address | yes |
| Mail failure reveals the address exists | yes |
| Reset leaves old sessions alive | yes |
| Resend does not require a session | after adding the missing test |

**94 API tests**, all three workspaces typecheck.

### 2026-09-21 — Log in, log out, and the CSRF guard

Phase 1 is 6 of 10. Auth is usable end to end: sign up, sign out, sign back in.

#### Added

- **`POST /auth/login`** — verifies with argon2id, issues a session, records `last_login_at`,
  and returns where the browser goes next per design.md §5.3 (admin to `/admin`, a learner
  mid-onboarding back to their step, everyone else to `/app`).
- **`POST /auth/logout`** — ends the presented session only, not every session for that
  user, and always answers 204. Log out is not a place to tell someone whether their cookie
  was real.
- **`requireSameOrigin`** — the CSRF defense §6.3 asks for, on every state-changing route.

#### The CSRF hole this closes

CORS alone was not enough. In production the session cookie is `sameSite=none`, so browsers
attach it to cross-site requests. A cross-origin `fetch` is stopped, because sending
credentials cross-origin triggers a preflight our CORS refuses. **But a plain HTML form post
is a simple request** — no preflight, cookie attached, and nothing for CORS to block. Any
endpoint not needing a parseable JSON body would have acted on it, and `/auth/logout` takes
no body at all.

Every state-changing request now needs an `Origin` we recognise, with a same-origin
`Referer` accepted as a fallback for the browsers that omit `Origin` on same-origin form
posts. Routes authenticated by a shared secret rather than a cookie — the worker's
`/internal/events` — will mount before the guard, since a non-browser caller sends no
`Origin` at all.

#### Two enumeration defenses

- **A wrong password and an unknown address return the identical response.** There is a test
  asserting the two bodies are equal, not merely that both are 401.
- **A decoy hash.** Without one, an unknown address returns before argon2id runs and a known
  one returns after — a timing difference wide enough to enumerate accounts. Both paths now
  verify against a hash, so both cost the same.
- Suspension is reported **only after the password checks out**, so it confirms nothing to
  someone who has not already proved they hold the credentials.

#### Verified by mutation testing

Six vulnerabilities introduced one at a time; **every one caught**:

| Vulnerability | Caught |
|---|---|
| CSRF guard accepts any origin | yes |
| CSRF guard allows a missing Origin | yes |
| Login reveals that an address is unknown | yes |
| Login ignores suspension | yes |
| Logout does not end the session | yes |
| Login issues a session before checking the password | yes |

**71 API tests**, all three workspaces typecheck.

#### Changed

- Test POSTs now go through `src/test/http.ts`, which sets `Origin` the way a browser does.
  Without it every POST test would have been asserting against a 403 from the CSRF guard
  rather than against the handler — the guard caught its own tests first, which is a fair
  sign it works.

### 2026-09-20 — Sign up, and the §6.1 request middleware

Phase 1 is 5 of 10. The first real endpoint, landed together with the middleware that
protects every endpoint after it.

#### Added

- **`POST /auth/signup`** — argon2id (OWASP baseline parameters), then `users`,
  `learner_profiles`, and the verification token in **one transaction**, then a session
  cookie, then the mail. A provider outage logs and carries on: the account exists either
  way and the learner can ask for another link.
- **`GET /auth/me`** — the session the browser holds. This is what the web app's
  `useSession` stub will call.
- **Session handling** — random 256-bit tokens, SHA-256 in the database, `httpOnly`
  cookie, expiry judged by the **database** clock so a clock difference cannot extend a
  session. `destroyAllSessions` is there for §6.3's "clear sessions on password change".
- **The §6.1 pipeline** — `attachSession` (step 1) on every request, `requireAuth`
  (steps 1–2), `requireAdmin` (step 5), plus `sessionUser()` and `assertOwned()` for
  steps 3 and 4. A learner hitting an admin route gets **404, not 403**: answering
  "forbidden" confirms the route exists.
- **An in-memory PostgreSQL for endpoint tests** (`src/test/db.ts`). The DDL is
  **extracted from the real migration**, not hand-written, so a renamed column or a moved
  constraint fails the tests. A hand-copied schema drifts silently, which is worse than no
  schema test.
- **39 new tests**, 52 in the API.

#### Fixed

- **One client could have occupied two rate-limit buckets.** Express reports an IPv4
  caller as the IPv4-mapped IPv6 address `::ffff:127.0.0.1`, so the same client can be
  written to `sessions.ip_address` and `auth_attempts` under two different values — and
  §6.3's per-IP limiting counts by value. `clientIp()` now normalises both the mapped form
  and `::1` before anything stores an address. Found because pg-mem rejected the mapped
  form as `inet`.

#### Verified by mutation testing

Passing security tests prove nothing until they have failed. Five vulnerabilities were
introduced deliberately, one at a time, and **every one was caught**:

| Vulnerability | Caught |
|---|---|
| Session expiry not enforced | yes |
| Suspended accounts allowed through | yes |
| Admin route open to learners | yes |
| Raw cookie compared against the stored hash | yes |
| Browser able to choose its own `role` | yes |

All five were reverted, and the restored code was re-checked before the suite was run
again.

#### Notes

- **The bash heredoc in this environment eats backslashes**, which silently turned a test
  helper's `\([\s\S]` into `([sS]`. That had been quietly breaking earlier work too.
  Files containing regexes or escapes are now written with the editor rather than a
  heredoc.
- pg-mem is not PostgreSQL: it does not run the triggers or plpgsql functions, and its
  planner is simpler. It proves the SQL is valid and matches the real columns. Anything
  depending on a trigger — `prevent_log_changes`, `set_updated_at` — still needs a real
  database, and so does the worker's `claim_next_ai_job()`.
- `sameSite` is `"lax"` in development and `"none"` in production, and the reason it has to
  be `"none"` is the open question in AGENT.md §11 about hosting the API at `api.<domain>`.
  The code comment says so, so whoever changes it knows why.

### 2026-09-20 — Mail module

Phase 1 is 3 of 10. Every remaining auth task is now unblocked, and none of them needs a
Brevo account to build or test.

#### Added

- **`src/mail/`** — one `Mailer` interface, two transports.
  - **Console** (development): prints the message and pulls the links out so they can be
    copied straight from the terminal. This is what makes all of
    `docs/database-schema.md` §6.3 — hashed, expiring, single-use tokens and the rate
    limiting around them — buildable and testable with no provider account.
  - **Brevo** (production): posts to the transactional API with a 15s timeout.
- **`createMailer()`** picks between them on `BREVO_API_KEY`, and **throws at boot** if a key
  is set without `MAIL_FROM`. Failing at startup beats failing at the first sign up, by
  which point an account exists with no way to verify it.
- **Verification and password-reset templates**, in the §9 voice: plain, specific, no
  exclamation marks, no "Oops". Both say the link works once and expires; the reset message
  says plainly that ignoring it is safe and the password stays as it is.
- The mailer is injected through `app.locals`, so no module imports a singleton and every
  endpoint test can substitute its own.
- **15 mail tests**, 23 in the API total.

#### Notes

- **One of the tests was vacuous and I only found it by trying to break it.** The check that
  an error never contains the API key used `rejects.toThrow(expect.not.stringContaining(...))`
  — but `toThrow()` does not accept an asymmetric matcher, so it passed whatever the message
  said. Deliberately leaking the key into the error proved it: a *different* test caught the
  leak while the dedicated one stayed green. Rewritten to catch the error and assert on the
  message, and it now fails when the key leaks. A matching test covers the message body, so
  a reset token cannot reach a log either.
- The HTML template is deliberately plain and does not use the design tokens. Mail clients
  strip most CSS, and a verification link that renders as unstyled text in Outlook beats one
  that renders as a broken layout. URLs are escaped before interpolation, with a test using
  a `<script>` payload.
- `send()` throws and the caller decides. Sign up should log and carry on — the account
  exists either way and the learner can ask for another link — while an explicit resend
  should surface the failure, since silence would look like success. Written into the
  interface docs.

### 2026-09-20 — `apps/api` scaffolded

Phase 1 is now 2 of 10. The API exists, boots, and has a test harness ready for the first
real endpoint.

#### Added

- **`apps/api`** — Express 5 + TypeScript strict, in the workspace as `@first-commit/api`.
  Express 5 forwards rejected promises to the error handler on its own, so handlers need no
  async wrapper.
- **`createApp()` separate from `index.ts`**, so tests drive the app without binding a port.
  That is the pattern every endpoint test should follow, given AGENT.md §10's rule that no
  endpoint ships without a test.
- **`config.ts`** validates the environment once at import, so a missing variable fails at
  boot with a named error instead of surfacing as an undefined inside a handler.
- **`db.ts`** — a `pg` pool on the **connection pooler** (6543), deliberately the opposite
  of the worker's direct connection (5432). `pg` connects lazily, so the API boots and
  answers `/health` even with no database reachable.
- **`/health` and `/health/db`** — liveness and readiness, split on purpose. Render's health
  check points at `/health`, which must not touch the database: a check that fails when the
  database blinks would have Render restart a healthy process. `/health/db` is where the
  connection is actually reported, with a 503 when it is down.
- **Error handling** — an `HttpError` class whose message reaches the client, and a catch-all
  that logs the real error and answers generically, so an internal failure cannot leak a
  query or a column name. Unknown routes return JSON, not an HTML stack.
- **CORS for `APP_ORIGIN` with credentials**, `trust proxy`, `x-powered-by` disabled, and a
  graceful SIGTERM shutdown that drains in-flight requests and ends the pool.
- **8 tests** covering liveness without the database, readiness pass and fail, the JSON 404,
  the absent framework header, and the CORS behaviour including a credentialed preflight.
- Root script `npm run dev:api`; `npm run typecheck` now covers all three workspaces.

#### Fixed

- **`/health/db` reported an empty error string.** Node tries IPv6 and IPv4 in parallel, so
  a connection failure arrives as an `AggregateError` whose own `message` is blank —
  reporting it verbatim gave `"error": ""`, which tells an operator nothing. It now unwraps
  the aggregate and includes the error code, e.g.
  `ECONNREFUSED: connect ECONNREFUSED 127.0.0.1:6543`.

#### Verified

Booted the API against a deliberately unreachable database: `/health` answered 200 without
touching it, `/health/db` returned 503 with a useful message, `/nope` returned JSON 404, and
the startup log named the two unset optional secrets. All three workspaces typecheck; web
lint clean; 8 API tests and 59 web tests pass. The temporary `.env` used for the smoke test
was deleted afterwards.

#### Notes

- One test failure along the way was the test's fault, not the code's. I asserted that a
  foreign `Origin` gets no `Access-Control-Allow-Origin` header, but `cors` returns the
  *configured* origin rather than echoing the caller's — which is safe, because the browser
  compares the two and blocks the read when they differ. Rewritten to assert the property
  that matters: the header never equals a foreign origin. A credentialed preflight test was
  added alongside it.
- `ssl: { rejectUnauthorized: false }` is set on the pool, matching the worker, because that
  is how Supabase connections are normally made without its root certificate.

### 2026-09-20 — Worker ported from the Supabase client to `pg`

The last place where code contradicted the documentation. The repo is now internally
consistent for the first time since the architecture changed to Express.

#### Changed

- **`apps/worker` no longer uses `@supabase/supabase-js`.** Dependency removed, `pg` and
  `@types/pg` added.
- `config.ts` — `supabaseConfig()` becomes `dbConfig()`: `SUPABASE_URL` and
  `SUPABASE_SERVICE_ROLE_KEY` are replaced by `DATABASE_URL`, plus optional `API_URL` and
  `WORKER_SECRET`.
- `worker.ts` — `createClient` becomes a `Pool` capped at one connection, since the worker
  handles one job at a time anyway. `.rpc("claim_next_ai_job")` becomes
  `select * from claim_next_ai_job()`, and the `ai_outputs` insert and two `ai_jobs`
  updates become parameterised SQL written against the actual column lists in the
  migration.
- **Added `notifyApi()`** — the `POST /internal/events` handoff the SSE decision requires.
  It is deliberately non-fatal and optional: the result is already committed before it
  runs, and if `API_URL`/`WORKER_SECRET` are unset, or the call fails, the worker logs it
  and moves on. The API's sweep is the backstop, so a missed notice delays an update rather
  than losing one. The worker says so at startup when those variables are absent.
- `.env.example` rewritten for the direct connection (port 5432, **not** the pooler — the
  worker holds one long-lived connection and claims inside a transaction with
  `for update skip locked`).
- Removed the three now-false notes saying the worker still used the Supabase client:
  `AGENT.md` §4, `docs/model-setup-guide.md` §11, and the worker's own README.

#### Verified

`tsc --noEmit` clean in both workspaces; no `supabase` reference remains in worker code,
`package.json`, or `.env.example`; a missing `DATABASE_URL` still produces the intended
"Copy .env.example to .env and fill it in" error. Web lint clean, 59 unit tests pass.

#### Notes

- **Not run against a live database.** There is no Supabase project yet, so the SQL was
  checked by reading the migration — `claim_next_ai_job()` returns `setof ai_jobs`, and the
  `ai_outputs` insert matches its column list — rather than by executing it. First run
  against a real database is the remaining check, and `docs/model-setup-guide.md` §11 step 5
  has the test job to do it with.
- `ssl: { rejectUnauthorized: false }` is set on the pool because that is how Supabase
  connections are normally made from a client without its root certificate. Worth
  revisiting if the database ever moves.

### 2026-09-20 — Email provider decided: Brevo

Closes the first of the two blocked items. **Auth is no longer blocked** — see the dev
transport below.

#### Decided

- **Brevo**, over Resend, for one reason: Brevo verifies a sender by clicking a link in
  that inbox, so it needs **no domain**. Resend without a verified domain sends from
  `onboarding@resend.dev` and delivers **only to the account owner's address**, which would
  make the usability testing in `project-proposal.md` §9.2 impossible. Free tier is 300 a
  day, which is ample when the only mail sent is verification and reset links.
- **Mail sits behind one module with two implementations** — Brevo in production, and a
  development transport that writes the link to the console. Everything §6.3 specifies
  (hashed, expiring, single-use tokens, and the rate limiting around them) can be built and
  tested with no provider account, and moving to another provider later changes one file.

#### Changed

- `docs/database-schema.md` §9.1 lists Brevo as a part that runs somewhere; §9.2 records
  both limits that matter; §9.3 step 5's environment list gains `BREVO_API_KEY`,
  `MAIL_FROM`, `MAIL_FROM_NAME` — and `WORKER_SECRET`, which was also missing — with a new
  step 6 covering Brevo setup and the transport split.
- `AGENT.md` §4 records the decision and the reasoning; §11's open question about the email
  provider is removed, leaving three.
- `docs/task-tracker.md` — the email item flips from `[!]` to done, and Phase 1 gains a
  "mail module" task ahead of sign up.

#### Notes

- **Deliverability is the trade.** Without a domain there is no SPF or DKIM alignment, so
  mail from a verified personal address often lands in spam. Fine while the recipients are
  testers who can be told to check; not fine for anything wider. Verifying a domain in
  Brevo later fixes it without changing any code.
- **A domain would close the remaining blocked item too.** Hosting the app at a domain and
  the API at `api.<domain>` makes the session cookie same-site and removes the
  `sameSite=none` problem in §11 entirely. Around $10–12 a year, and it would let the
  provider move to Resend with proper deliverability. Recorded, not urgent.
- Brevo's free plan has historically added its own branding to outgoing mail — worth
  confirming before the defense, since a verification email is something a panel may see.

### 2026-09-20 — Corrected AGENT.md, and made every route resolve

#### Fixed

- **`AGENT.md` §8 listed five design tokens that no longer exist** — `--paper`,
  `--surface`, `--ink-muted`, `--rule`, `--action`, none of which appear in `tokens.css`.
  It also still named Atkinson Hyperlegible as the UI face. This was drift from the
  design-system adoption: `design.md` §3 was rewritten and `AGENT.md` was not. An agent
  following the contract would have written `var(--action)` and produced dead CSS, and the
  contrast gate would not have caught it because it only checks the pairs it is given.
  §8 now names the tokens that exist and carries the lime-as-fill and control-edge rules.
- **`AGENT.md` §4 and §5 claimed `apps/web` was not scaffolded.** Both now describe what is
  actually built, and list which of the §13.1 libraries are still uninstalled so nobody
  assumes TanStack Query or React Flow is already there.
- **Two admin placeholders cited the wrong section.** `design.md` §6.4 is the Impact Preview
  Dialog, not Capstone projects (§6.5), and Project reviews is §6.6.
- `AGENT.md` §1 was missing `docs/design-source.md`; §5's script list was missing
  `npm run e2e`.

#### Added

- **A shared `Placeholder`** at `src/routes/Placeholder.tsx`, replacing the admin-only one.
  It takes the screen's title, the `design.md` section that specifies it, and a one-line
  purpose drawn from that section, and renders either inside a shell or standalone.
- **Every route the navigation offers now resolves.** Previously the six learner sidebar
  items, `/login`, and the onboarding steps all fell through to "We couldn't find that
  page", while admin had proper placeholders — an inconsistency that made the learner app
  look broken during review. Added: `/login`, `/forgot-password`, `/reset-password`,
  `/verify/:code`, the four `/onboarding/*` steps, and ten learner routes including
  `/app/roadmap/:id`, `/app/module/:id`, and `/app/exercise/:id`.
- **An e2e guard**, mirroring the admin one: walk every link in the learner navigation and
  assert none lands on the not-found page. At `sm` it opens the "More" disclosure first, so
  the three items behind it are covered too. The onboarding and signed-out redirect tests
  now also assert the destination *renders*, not just that the URL changed.

**96 Playwright assertions** across the four widths (was 92), 59 unit tests, lint clean,
build succeeds.

#### Notes

- One Playwright failure was the test's fault, not the app's: it asserted at least five
  links in the learner navigation, but at 360px there are four plus a `<details>` holding
  the rest, and a closed disclosure has no rendered links. Rewritten to open it and assert
  six distinct destinations at every width.
- `/onboarding/*` renders Home for the default session. That is correct — §4.3 sends a
  learner who has finished onboarding away from those pages. `?as=onboarding` reaches them.

### 2026-09-19 — Admin shell, and Playwright found five real layout bugs

#### Added

- **`AdminShell`** — the grouped sidebar from `design.md` §4.2 (Content / Quality /
  Platform, with Overview above the groups) and the persistent "Admin" indicator. A
  separate component from `LearnerShell`: neither renders the other's navigation, and
  neither links into the other's area.
- **Admin Overview** (§6.1) — drafts, flagged AI feedback, flagged projects, struggling
  modules, each with a link to handle it. Mock data.
- **A named placeholder** for the other ten admin screens, each citing the `design.md`
  section that specifies it, so the sidebar is walkable while the shell is reviewed.
- **Dev session override** in `useSession` — `?as=admin|learner|onboarding|signedout`,
  sticky per tab. All four areas and every §4.3 redirect can now be exercised without
  editing a file. Gated on `import.meta.env.DEV`, so it never ships.
- **Playwright** — `e2e/responsive.spec.ts` and `e2e/areas.spec.ts`, **23 tests run across
  the four widths §11.4 names** (360, 768, 1024, 1440): **92 passing**. They cover the
  live-resize case §11.4 asks for, the 320px reflow §12 requires, the no-view-switcher rule
  from §11.1, and the area separation in §4.3.

The admin chunk now carries real weight — 6.58 kB JS + 3.86 kB CSS, separate from the main
bundle — so the lazy split in §4.3 is doing actual work rather than splitting a stub.

#### Fixed — all five found by Playwright, none catchable in jsdom

1. **Nav links had no accessible name at 768px.** The icon rail hid labels with
   `display: none`, which removes them from the accessibility tree — a screen reader user
   at that width got six unlabelled links, straight against §12. Labels are now visually
   hidden (clipped) and remain in the tree. **This is the one that mattered.**
2. **The learner bottom bar overflowed 320px** (471px of content in a 320px viewport). The
   cause was mine: §4.2 specifies *five* items below 640px — Home, Roadmaps, Capstone,
   Resume, and More — and the first implementation put all six in. Now five, with More as a
   native `<details>` disclosure opening Explore, Certificates, and Settings.
3. **The landing top bar overflowed 320px.** The wordmark plus both actions do not fit; it
   now wraps.
4. **Checkbox and radio inputs were `0×0` with `opacity: 0`.** A zero-size control is
   invisible to Windows High Contrast Mode, which paints the real control rather than our
   styled span, and is not a usable target for a stylus or for automation. Both now keep the
   visual box's footprint.
5. **The decorative box swallowed clicks meant for the input beneath it.** Both indicators
   are `aria-hidden` decoration and now carry `pointer-events: none`.

#### Verified

Lint clean, 59 unit tests, 92 Playwright assertions across four viewports, `tsc --noEmit`
clean, build succeeds.

#### Notes

- Two Playwright failures were defects in the *tests*, not the app, and are recorded because
  the distinction matters: `evaluateAll` does not auto-wait, so it ran before the lazy admin
  chunk loaded; and `isVisible()` returns true for a 1px clipped element, so the label test
  had to assert rendered width instead.
- `e2e/areas.spec.ts` exercises the guards, which decide what *renders*. It is not a
  security test — the API decides what data comes back (`database-schema.md` §6). The real
  versions live in the API's endpoint tests.

### 2026-09-19 — Component gallery, and contrast became an automated gate

#### Added

- **`/dev/components`** — every component in every variant, plus live token swatches, the
  type scale, radii, and elevation. Mounted behind `import.meta.env.DEV`, so the route and
  the module behind it are dropped from a production build. Verified: the string
  "Component gallery" does not appear in `dist`.
- **A live contrast table in the gallery.** Ratios are computed from the *resolved* custom
  properties at render, not copied in, so changing a token shows its consequence
  immediately. Two rows fail on purpose and are labelled as evidence rather than defects:
  lime as text on a light surface (1.98:1 — the reason the fill-only rule exists) and
  `--border-strong`, which is a decorative rule no control depends on.
- **`src/styles/contrast.ts`** — WCAG luminance and ratio helpers, plus token resolution
  that follows `var()` chains.
- **`src/styles/contrast.test.ts` — the contrast gate.** Reads `tokens.css` from disk,
  resolves the `var()` chains itself, and asserts **29 token pairs** against 4.5:1 for text
  and 3:1 for UI. It also asserts the two pairs that are *supposed* to fail, so if a token
  moves and lime becomes legible as text, the rule text gets revisited rather than silently
  drifting.
- **`Gallery.test.tsx`** — one axe pass over the whole component set at once, which is the
  cheapest broad guard available against a regression in a component nobody is looking at.

**Tests: 59 across 8 files** (was 21 across 6).

#### Changed

- Replaced the gallery's mount-effect with render-time `useMemo`. The original
  `useEffect(() => setReady(true), [])` caused a cascading render, which
  `react-hooks/set-state-in-effect` correctly flagged. Stylesheets are parsed before React
  mounts, so the tokens are readable during the first render and the effect was never
  needed.

#### Verified

Both gates were checked against deliberate breakage rather than assumed to work:

- A probe file with a missing `alt`, an invalid ARIA role, a misspelled `aria-labeledby`,
  an empty anchor, an anchor without `href`, and a `navigator.userAgent` read produced
  exactly **6 errors**.
- Pointing `--text-accent` back at `--lime-600` failed exactly the two accent-phrase pairs
  and nothing else. Restored afterwards.

Lint clean, 59 tests pass, `tsc --noEmit` clean, build succeeds.

#### Notes

- **The gallery's contrast table cannot be asserted in tests.** jsdom does not resolve
  custom properties from a stylesheet, so every row renders "—" under test. That is why the
  real gate reads the CSS file directly instead of going through the DOM. The gallery test
  asserts the table's *structure*; `contrast.test.ts` asserts its *values*.
- The gallery is the natural target for Playwright visual regression once that is added.

### 2026-09-19 — Frontend toolchain: linting and tests

Put the quality tooling in before more screens get built on the component set, since both
items get more expensive to retrofit the more screens exist.

#### Added

- **ESLint 9** (flat config) with `typescript-eslint`, `eslint-plugin-react-hooks`,
  `eslint-plugin-react-refresh`, and **`eslint-plugin-jsx-a11y`**. The accessibility rules
  are **errors, not warnings** — `design.md` §12 commits to WCAG 2.2 AA in a document that
  gets defended, and a warning nobody reads is not a commitment.
- A custom `no-restricted-properties` rule banning **`navigator.userAgent`**, with the
  message pointing at `design.md` §13.5: layout follows viewport width, never the user
  agent. This is the rule that stops the "mobile view" pattern the design document rules
  out from creeping back in.
- **Vitest + Testing Library + jsdom**, and `src/test/axe.ts`, a helper that runs axe-core
  over a rendered container and fails with the violations listed.
- **21 tests across 6 files**, written against the documented commitments rather than
  against implementation details:
  - `Button` — accessible name, disabled does not fire, loading swaps the label and sets
    `aria-busy`, icons are `aria-hidden` (§7.1)
  - `Badge` — the status is in text, not only in colour (§8)
  - `Input` — visible label associated, error linked via `aria-describedby` with
    `aria-invalid`, error preferred over hint (§12)
  - `Checkbox` — a real checkbox with the label as its name, toggles with the space key
  - `ProgressBar` — `progressbar` role with correct aria values, same information as text,
    clamps out-of-range values (§7)
  - `SignUp` — no app navigation (§5.2), every field labelled, submit stays disabled until
    consent, and **no axe violations**
- Scripts: `lint`, `test`, `test:run`, `test:coverage` on the web workspace, plus root
  `npm run lint`, `npm run test`, and `npm run dev`.

#### Changed

- Extracted `NotFound` from `router.tsx` into `routes/public/NotFound.tsx` with its own
  styles — it was a real route living as an inline component, and it was tripping the
  fast-refresh rule.
- `react-refresh/only-export-components` is switched off for `src/app/router.tsx` alone,
  in config rather than as an inline disable. A router module exports a route configuration
  object, not a component, which is the one shape that rule cannot verify; restructuring the
  router to satisfy it would make it worse.

#### Verified

`eslint .` passes with **zero problems**. 21 tests pass. `tsc --noEmit` clean, build
succeeds. The rules were then checked against a deliberately broken probe file, which
correctly produced 6 errors — missing `alt`, invalid ARIA role, misspelled `aria-labeledby`,
empty anchor, anchor without `href`, and the `navigator.userAgent` ban.

#### Notes

- **`jsx-a11y` does not catch an unlabelled `<input>`.** The probe's bare
  `<input type="text" />` passed lint: `label-has-associated-control` inspects `<label>`
  elements, not inputs. The `Input` component always renders a label, and the tests assert
  it, but nothing stops a raw `<input>` being added to a screen later. Worth a review habit.
- **axe cannot check colour contrast under jsdom** — it needs real layout and rendering, and
  emits a canvas warning. Contrast is covered separately by the token script described in
  the design-system entry; the two checks do not overlap.
- Playwright is still missing, so the 360/768/1024/1440 viewport tests `design.md` §11.4
  commits to are not running yet. Tracked in Phase 1.5.

### 2026-09-19 — Design system adopted and ported into `apps/web`

Imported the clickable prototype from the claude.ai design project
(`f4e40614-…`, `First Commit.dc.html`) — 31 routes on a 25-component design system — and
built its foundation into the web app. Nothing was written back to the design project; it
was read only. Nothing was committed.

#### Added

- **`apps/web`** — Vite + React 19 + TypeScript strict, React Router, the `src/` tree from
  `design.md` §13.2. Builds clean, and the admin area compiles to its own 0.20 kB chunk, so
  a learner's browser never downloads admin screens (§4.3).
- **`src/styles/tokens.css`** and its `tokens.ts` mirror — the full token set, with the
  contrast corrections below applied.
- **14 components** as `.tsx` + `.module.css`: Icon, Button, LinkButton, IconButton, Badge,
  Card, Tag, Input, Select, Checkbox, RadioOption, SearchField, ProgressBar, CodeBlock,
  StepIndicator.
- **`LearnerShell`** — bottom navigation below 640px, an icon rail to 1023px, the full
  sidebar above, all in CSS with no toggle.
- **Route guards**, a session stub, and `useBreakpoint`.
- **Three reference screens** — Landing, Sign up, Learner home — on mock data.
- **`docs/design-source.md`** — the provenance record.

#### Changed

- **`docs/design.md` §3 rewritten** for the new system: the lime/violet/ink palette, the
  status text-vs-tint split, Plus Jakarta Sans and its scale, the 12px-gutter mosaic layout,
  and the nesting radii. §7's component table now marks what is built, §8's status table
  points at the new tokens, §10 uses the motion tokens, and §13.4 carries the new `:root`.
  The Atkinson Hyperlegible rationale was removed with it.
- **`docs/task-tracker.md`** — added Phase 1.5 (design system, done), and turned the five
  routes the prototype does not cover into explicit tasks so they are not lost.

#### Contrast — why the tokens are not the source's

Adopting the system unaltered would have broken `design.md` §12's WCAG 2.2 AA commitment.
Measured: the accent colour `--lime-600` is **1.98:1** on white (and lime-700 only 3.11:1),
`--border-strong` is **1.62:1**, a lime fill on the page is **1.38:1**, and the progress
fill on its track is **1.08:1**. Since the system's signature move is a lime-highlighted
phrase in every headline, this was not a detail.

Four corrections, none of which cost the design its character:

1. **Lime is a fill, and text only on ink** (13.1:1 there). On light surfaces the accent
   phrase uses violet-700 at 8.26:1.
2. **`--border-control` (`#847C93`)** added for control edges, where the border is the only
   thing identifying the control — 3.97:1 on a card, 3.36:1 on the page.
3. **A lime fill carries a 1px `--border-accent` edge**, giving the primary button a 3.88:1
   boundary.
4. **The progress fill carries the same edge** (3.47:1); dropped on ink, where it is
   already 12.6:1.

All 28 checked pairs now pass — 4.5:1 for text, 3:1 for UI components.

#### Two defects found in the source system

- **A token name collision.** `--text-body` was defined as a colour in `colors.css` and as
  `15px` in `typography.css`; typography imports last, so `color: var(--text-body)` resolved
  to a length and body colour silently fell back. Here the size is `--text-body-base`.
- **Interaction state in JavaScript.** Components drove hover and press with
  `React.useState` + `onMouseEnter`/`onMouseDown`, which re-rendered on every interaction
  and gave keyboard users no focus treatment at all. Ported to CSS `:hover`, `:active`, and
  `:focus-visible`, which `design.md` §13.1 already specified.

Also swapped the runtime unpkg icon fetch for `lucide-react`, so glyphs are bundled and
tree-shaken instead of costing a network round trip each.

#### Verified

`tsc --noEmit` clean under strict; `vite build` succeeds. All three screens render in
Chrome; the focus ring (2px `#6F4FD1` at 2px offset) confirmed on inputs, checkbox, and
links; the 640px and 1024px media queries confirmed against the compiled CSS. Only
`tokens.css` holds literal colours. Nothing staged, no commits.

#### Notes

- **Narrow widths were not driven in the browser** — the extension's window resize did not
  change the viewport (it stayed 1920), so the `sm` and `md` layouts were verified from the
  compiled media queries rather than from screenshots at 360px and 768px. Worth re-checking
  by hand before the layout is trusted.
- Button focus rings could not be demonstrated with real Tab presses for the same reason;
  the global `:focus-visible` rule is confirmed present and applies to every element.
- The prototype does not cover `/forgot-password`, `/reset-password`, `/verify/:code`,
  `/app/notifications`, or `/admin/certificates`, and adds `/app/profile` and
  `/admin/profile` that `design.md` §4.3 does not list.
- Fonts, icons, and the logo are all substitutions — `design-source.md` §6 says what to
  change if real brand assets arrive.

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
