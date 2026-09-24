# Changelog

Task log for First Commit. Every task adds an entry here before it is considered done
(see [`AGENT.md`](../AGENT.md) §10).

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). This project
does **not** follow semantic versioning yet — it is pre-release, so everything
lives under `[Unreleased]` until there is something to version.

---

## [Unreleased]

### 2026-09-25 — The security tests §9.2 commits to

`project-proposal.md` §9.2 names five things endpoint tests must cover. Most were covered
somewhere — but only for endpoints somebody had remembered to write a test for. The
database no longer knows who is asking (`database-schema.md` §6): the API is the only thing
between an account and other people's data, and **it fails open**. "The endpoints we tested
are fine" is a weaker claim than the architecture needs.

`apps/api/src/security.test.ts` is the stronger one. **62 tests, driven by lists**, so an
endpoint added without a guard fails here rather than shipping untested.

#### What it enumerates

| §9.2 commitment | How |
|---|---|
| A learner cannot reach admin endpoints | There are none yet, and a test **asserts that out loud** — the day one is registered, it fails and the route has to join a cross-role list |
| A learner cannot read or change another learner's records | Every route taking a learner-owned id, called with somebody else's, asserting **404 not 403** — saying "exists, but not yours" confirms the record, which is itself the leak. Then: nothing changed, and their own still works |
| Answer keys and explanations never appear in learner responses | A value planted in the secret column, and every learner `GET` scanned for it |
| Completions, scores and certificates cannot be set from a request body | Every mutating endpoint, called with `passed`, `score`, `method` and `certificateId` in the body, asserting no completion carries them and no certificate exists |
| Rate limiting, reset expiry and single use | Already covered and mutation-tested in `auth/rate-limit.test.ts` and `auth/tokens-flow.test.ts`; **not duplicated**, and the file says so |

Plus the one §9.2 implies rather than states: **every learner endpoint resolves a session**,
asserted over a list of all 18.

#### The list that guards the lists

A list of routes is only as good as its upkeep, so one test reads **Express's own registry**
and fails when a registered route is not in `LEARNER_ROUTES`. Adding an endpoint and
forgetting the test is the failure mode this whole file exists for, so it could not itself
depend on somebody remembering.

#### Mutation-tested, and the guard was not guarding anything

Five vulnerabilities introduced, confirmed, reverted:

1. `/roadmaps/:id` without `requireAuth` — **not caught**, and correctly so: `sessionUser()`
   throws a 401 of its own, so the guarantee held. The test asserts the outcome, not the
   mechanism. Repeating it on `/career-paths`, which never calls `sessionUser`, **was
   caught** — that is the route shape where forgetting `requireAuth` actually serves a
   stranger.
2. `buildRoadmap` dropping its `user_id` filter — **caught**.
3. The quiz endpoint returning which option is correct — **caught**.
4. A new route registered and not listed — **not caught**, and this one was a real bug.
5. …re-run after the fix — **caught**.

**Number 4 is the one worth recording.** The registry walk read `app._router`, which is
Express 4. This app is on Express 5, where it is `app.router`, so the walk found nothing,
compared an empty list against an empty list, and passed. The headline guarantee of the
file was guarding nothing, and no ordinary test run would ever have said so.

It reads both names now, and **throws when the table comes back empty** rather than
reporting success — a guard that cannot find anything to guard is broken, not satisfied.

#### Also corrected, in the test rather than the app

The first draft planted a marker in a quiz option's **text** and asserted it never appeared
in a response. It appeared immediately, and rightly: a learner cannot choose an answer they
cannot see. The secret is not the option, it is **which** option — so the assertion became
that after a *wrong* answer nothing in the response identifies the right one, neither the
explanation nor the correct option's id.

Two more the app got right and the draft got wrong: `POST /assessments/:id/attempts` is
`.strict()`, so a body carrying a score is **refused** rather than ignored — which is the
better behaviour and now has its own test; and the technology choice needs a real published
option, so the fixture grew one rather than the assertion being loosened.

#### Verified

**345 API + 280 web + 24 worker tests**, lint and typecheck clean. The API suite grew by 62.

### 2026-09-25 — The roadmap review, and the AI explanation nobody had read

The Roadmap AI writes the learner an explanation of the plan it made. It has been storing
it in `roadmaps.ai_rationale` on every generation since the worker was built, and **no
learner had ever seen it** — `apps/worker/src/roadmap/apply.ts` wrote it and nothing in
`apps/api/src/roadmaps/build.ts` read it back.

`design.md` §5.5 is where it belongs, and §5.4's flow diagram has ended at a roadmap review
all along:

```
Generating --> RoadmapReview: roadmap ready
RoadmapReview --> Home: start learning
```

Onboarding went to Home instead. It goes to the review now.

#### Added

- **`/app/roadmap/:id/review`** — §5.5. The plan, the counts, the estimate, the AI's
  reason, and two actions. It stays reachable afterwards: adjusting weekly hours is not a
  one-time act, and there was no reason to make the screen disappear.
  - **What placement bought, said plainly.** "You proved 1 module at placement, so 10
    remain." Until now a learner could answer 25 questions, clear four modules, and land on
    Home with nothing acknowledging any of it.
  - **The AI panel** carries §7's three requirements: labelled as AI, gives its reason, and
    is flaggable. The flag control is disabled until `ai_feedback_flags` has an endpoint,
    which is the third such control and is tracked.
- **`PATCH /roadmaps/:id`** — §5.5's "Adjust weekly hours", the only thing about a roadmap
  a browser may change. Hours are the learner's own statement about their life, not
  evidence. It writes the roadmap *and* the profile, because the Roadmap AI reads the
  profile when planning the next one and leaving them to disagree would mean the next
  roadmap silently using the old figure.
- **`estimatedWeeks`** on the roadmap — §5.5's "about 14 weeks at 6 hours a week",
  arithmetic over the hours **still to do**, so it falls as modules are passed. Null when
  the learner never said their hours, and the sentence drops with it rather than inventing
  a number.
- **`testedOutCount`** — of what is passed, how much was cleared without working through
  the module.
- **18 tests**: 9 on the API (the patch, its bounds, its ownership, and where `/auth/me`
  sends a learner) and 14 on the screen.

#### Changed

- **`GET /auth/me` returns `next`** — where this person belongs right now: `/admin`, their
  unfinished onboarding step, the review of a roadmap they have not started, or `/app`.
  The guards follow it instead of each deciding for themselves.

  This is the shape the earlier navigation bug asked for. The generating screen used to
  navigate while `RequireLearner` redirected somewhere else, and the two fought until the
  browser throttled navigation; the fix then was "one place decides where a learner goes",
  and the place was never named. It is named now. `next` is optional in the schema and the
  guards keep their old reasoning as a fallback, so nothing breaks on a response without
  it.
- **"Started" means a module has been opened**, read from `module_enrollments`. It needed no
  new column, and it means placement clearing modules does not count as having started —
  which is the whole point of showing the review afterwards.

#### The read-only guarantee moved rather than weakened

`roadmaps.test.ts` asserted that `POST`, `PUT`, `PATCH` and `DELETE` on a roadmap all 404 —
§6 rule 1, the roadmap is read-only. `PATCH` exists now, so the assertion could not stand
as written.

It was not deleted. It became a stronger one: `PATCH` is `.strict()` and takes only
`weeklyHours`, so a body carrying `passed`, `score`, `passedCount` or `trackId` is
**rejected with a 400** and writes no completions. Four cases, one per field. "There is no
route" became "the route cannot carry progress", which is what the rule actually wants.

#### Not built, and why

**§5.5's "Track [ Frontend ▾ ]" is absent.** Changing the track changes which modules are
on the roadmap, so it is a regeneration rather than an update — `roadmap_items` from the
old track would otherwise be left behind. Doing it properly means a forced track in the
job payload, the prompt, and the catalogue. That is its own task and it is in the tracker;
shipping a dropdown that silently corrupted a roadmap would have been worse than not
shipping one.

#### Verified

**283 API + 280 web + 24 worker tests**, 152 Playwright, lint and typecheck clean. The
screen was driven in a browser at 1440 and read back as a screenshot: header, AI panel,
chart, and the actions row §5.5 draws.

One test fixture taught something worth keeping: the screen patches the roadmap id **the
server gave it**, not the one in the URL, and the first version of the test stubbed the URL
param instead. The screen is right — the server's id is authoritative — and the test was
wrong.

### 2026-09-25 — Placement, and the measurement that decided its shape

`design.md` §5.4 introduced placement with "this short check helps us skip what you already
know". **The platform could not keep that promise.** Measured against the live catalogue:

```
0 of 13 modules can be skipped by placement
```

Every module on the Junior Web Developer path is `required_for_certificate`, and
`validate.ts` rejects a roadmap that leaves one out — because a skipped module writes no
evidence, so skipping a certificate requirement would make the certificate unreachable.

So placement does not skip. It **rates, then checks**: a learner says what they already
know, and anything they claim is tested before the platform believes it. Passing a skill's
check writes `module_completions` with `method = 'tested_out'` — the same evidence testing
out of one module produces, counting the same toward the certificate.

#### Why not the other shapes

Batching each module's own quiz at onboarding is **51 questions before the roadmap opens**,
which for a product whose first promise is "here is what to do next" is fatal. Generating
questions with the model would have put an AI-written answer key behind a certificate,
which is the one thing AGENT.md §7 exists to prevent — the model never decides what is
correct — and §9.2 would have had nothing fixed to evaluate.

One check per skill, sized to what a pass buys, is **25 questions**: short enough to sit
before a learner has seen anything, long enough that a pass means something.

#### Added

- **Migration `0002`** — an assessment now belongs to *either* a module version *or* a
  skill, never both and never neither, enforced by a check constraint.
  `module_version_id` became nullable and `skill_id` arrived beside it, with a partial
  unique index giving a skill at most one placement check.
- **`supabase/seed/placement.mjs`** — 25 questions across HTML, CSS, JavaScript and Git.
  Every one is answerable by somebody who learned the skill elsewhere: none refers to a
  First Commit lesson, uses our wording, or depends on a convention only this platform
  follows. The loader rejects a placement question that links to a lesson.
- **`gradePlacement`** (`apps/api/src/onboarding/placement.ts`) — the second place the
  platform writes evidence. Grades from `quiz_answer_keys`, clears the skill's core
  modules on *that learner's* path, and records the ratings and scores.
- **The placement screen**, rebuilt: rate four skills, then answer the checks for anything
  rated "comfortable", on one page. "I'm new to all of this" fills every row and asks
  nothing more, which is §5.4's "I don't know yet" kept as a single click.
- **13 API tests and 5 web tests** on the grading and the screen.

#### Decisions, and the reasons

| | |
|---|---|
| **Pass mark 80**, not the 70 a module quiz uses | One pass clears several modules at once, so it should cost more to earn |
| **All-or-nothing per skill** | Ten JavaScript questions over four modules is 2.5 per module; splitting it per module would make each one worth two answers |
| **Only "comfortable" triggers a check** | Someone who can use a skill *with help* should do the module, and their answers do not clear it even if they give them |
| **No retake at onboarding** | Failing changes nothing, and the per-module test-out — longer and stronger — is still there when they reach the module. That assessment *is* the retake |

#### Changed

- **`GET /onboarding`** returns the skills to rate and their questions — options only, never
  the key, which lives in a table no learner endpoint selects from (§6 rule 2).
- **`POST /onboarding/placement`** takes `{ ratings, answers }` and is `.strict()`, so a body
  carrying `score` or `passed` is **rejected** rather than quietly ignored (§6 rule 1).
- **The Roadmap AI prompt** no longer says to skip what placement shows. It cannot: a
  module proved at placement already has a completion, and belongs on the roadmap marked
  passed rather than missing from it. Ratings now decide **order** — what a learner is least
  sure of comes earlier. `PROMPT_VERSION` → 2.
- **`apps/api/src/test/db.ts` reads every migration**, not just `0001`. `0002` is the first
  migration to change a table `0001` created, and a harness stuck on the first file would
  have tested a schema the database no longer had — failing as a broken endpoint rather
  than as a stale harness.

#### Mutation-tested: five vulnerabilities, one gap found

Introduced, confirmed caught, reverted:

1. any rating triggers a check, not just "comfortable" — **caught**
2. modules cleared regardless of the score — **caught**
3. a placement pass overwrites a real pass (`do update` instead of `do nothing`) — **caught**
4. the score divided by the number of answers the browser sent — **not caught**
5. modules cleared on any path, not the learner's — **caught**

**Number 4 was a real hole.** With `Object.keys(answers).length` as the denominator, a
learner could send **one** correct answer, omit the rest, and score 100% — clearing a
skill's modules onto their certificate. Two tests now cover it: a single correct answer
scores 25 and clears nothing, and an answer to a question outside the check counts for
nothing. Re-running the mutation fails both.

The validator was mutation-tested too: too few questions for what a pass clears, a check
for a skill with no core modules, a placement question linked to a lesson, and an
out-of-range answer index — all four rejected before anything is written.

#### Verified

`npm run db:migrate` applied `0002`; `npm run db:seed` loads 4 placement checks with answer
keys, 25 questions, at 2.5 questions per module cleared, all passing at 80. The 19 module
quizzes are untouched. **270 API + 266 web + 24 worker tests**, 152 Playwright, lint and
typecheck clean.

#### Notes

- One e2e assertion changed: the step's heading was the word "Placement" and is now the
  question it asks. §5.4 still calls the step Placement; the page no longer names itself.
- AGENT.md §11 #3 is closed by this.
- **Open, and worth revisiting:** all 13 modules being certificate-required is what made
  skipping impossible. If any core module is genuinely optional for the certificate — the
  candidate is Branching and merging — placement could drop it outright for someone who
  proves Git, and "skip what you already know" becomes literally true. That is a curriculum
  judgement, not a code one.

### 2026-09-25 — The curriculum is finished

The remaining nine modules are written. **All 19 published modules now have three lessons
and a five-question quiz**, so a learner can walk the whole Junior Web Developer path —
core skills, the technology choice, and the modules on either side of it — without meeting
an empty reading column.

#### Added

**Three concept modules**, taught before the technology choice and shared by both tracks:

- **What are components** — one description used many times, props flowing one way, state
  versus derived values, and lifting state to a shared parent. Deliberately
  framework-independent: everything in it is true of React and Vue alike, which is why it
  sits before the decision.
- **How the web talks** — a request and a response, why `GET` being safe is a promise to
  caches and prefetchers rather than to you, the five status families, and why `401` and
  `403` send people to different places.
- **Fetching data** — `await` pausing a function and not the page, `Promise.all`, the fact
  that **`fetch` does not reject on a 404 or a 500**, and modelling loading / loaded /
  failed as one status rather than two booleans that can both be true.

**Three technology pairs**, written as pairs on purpose — the same lessons in the same
order, teaching the same ideas in different syntax, so §5.8's "you keep your progress on
shared modules" means something and switching does not feel like starting over:

| | React | Vue |
|---|---|---|
| Components | JSX as JavaScript, `className`, `children` | single-file components, `defineProps`, slots |
| Lists | `map` and why the index is a poor `key` | `v-for` and why the index is a poor `:key` |
| State | `useState`, stale reads, updater functions | `ref` and `.value`, `reactive`, `nextTick` |
| Asking the parent | a callback prop | `emit`, and what `v-model` is made of |
| Deriving | calculate in render, not in an effect | `computed`, not `watch` |

**Routing in Express and Django** — a route as method-plus-path against one view per path,
route order swallowing the specific case, where parameters and queries and bodies each come
from, and the middleware order that decides whether a guard actually guards anything.

Each pair carries the same gotchas where they genuinely rhyme (route order, path parameters
arriving as strings) and diverges where the frameworks do (`express.json()` versus Django's
CSRF check, `return` after `res.status(404)` versus `get_object_or_404`).

#### Verified

`npm run db:seed` loads **57 lessons and 19 quizzes**. Then, against the live database:

- **19 of 19 modules ready** — 10 core, 3 concept, 6 technology, each with lessons and a
  quiz.
- **All 611 lesson blocks** validate against `LessonContent` (`design.md` §13.3): five
  block types, two callout tones, every code block carrying both a language and its code.
- **All 96 answer keys** point at the option the author marked correct, checked row by row
  after the loader's rotation. Correct answers sit at position 0/1/2/3 in 31/20/22/23 of
  them.
- **No question links to a lesson outside its own module**, so §5.10's "topics to review"
  always sends a learner somewhere that covers what they missed.
- JSX, Vue single-file components and Django templates survive the round trip through
  `jsonb` intact — `<script setup>` and `{% csrf_token %}` come back exactly as written.
  They render as text: `LessonBody` and `CodeBlock` put every string in a text node, and
  neither file contains `dangerouslySetInnerHTML`.
- 255 API + 263 web + 24 worker tests, lint and typecheck clean.

#### Notes

- The technology modules are six modules for three topics. Written as three pairs in one
  sitting so the two halves actually match — a React lesson and its Vue twin written weeks
  apart would drift, and a learner switching framework would notice.
- Still unwritten content: **placement questions** (the schema has nowhere to put them —
  AGENT.md §11), **coding exercises** (no module has one, and §5.11's screen is unbuilt),
  and **a capstone brief**. Those are the three remaining items on the content track.

### 2026-09-25 — The core spine has content

Sixteen of nineteen published modules had nothing in them. Only HTML basics, CSS basics and
JavaScript basics were written, so a learner following their roadmap reached the second
module and found an empty reading column and no quiz. The platform worked; there was
nothing to learn on it.

**All ten core modules are now written** — the ones every learner on the path gets,
whatever track the Roadmap AI picks. Three lessons and a five-question quiz each.

#### Added

- **Seven modules of curriculum**, 21 lessons and 35 questions:
  - **Forms and semantics** — labels and the `for`/`id` join, why a placeholder is not a
    label, picking the right input type, landmarks and naming them.
  - **Layout with flex and grid** — one axis versus two, `repeat(auto-fit, minmax(…))`,
    `minmax(0, 1fr)`, mobile-first, and checking 320px.
  - **Functions** — parameters and return, scope and blocks, functions as values, and the
    `addEventListener("click", save())` slip.
  - **Arrays and objects** — indexing from zero, `const` fixing the name and not the value,
    optional chaining, `map`/`filter`/`reduce`, and which methods mutate.
  - **DOM manipulation** — `querySelector` returning `null`, `defer`, `textContent` versus
    `innerHTML` and the XSS that follows, events, and why a `<div>` is not a button.
  - **Git basics** — the three places a change lives, staging as a feature, commit messages
    written for the person who reads them next, and why a committed `.env` needs the key
    rotated rather than deleted.
  - **Branching and merging** — a branch as a pointer, what the conflict markers mean,
    `--abort`, keeping up with `main`, and `--force-with-lease`.
- Each quiz question links to the lesson that taught it, so §5.10's "topics to review"
  sends a learner somewhere that actually covers the question they missed.

#### Fixed

- **The correct answer was option 0 in all 51 questions.** Writing the right answer first is
  the natural way to author a question, and every question in the seed file did it — so
  every answer sat at `sort_order = 0` in the database too. `GET /assessments/:id` returns
  options in `sort_order` and nothing shuffles them, so **a learner could pass every quiz on
  the platform by clicking the top option**, and the pass would be written to
  `module_completions` as evidence. Real evidence, worth nothing — which is the one thing
  §6 rule 1 exists to prevent.
  - The seed loader now rotates each question's options before storing them, by an amount
    derived from the prompt. The correct answer now sits at position 0/1/2/3 in 17/6/14/14
    of the 51 questions.
  - **Deterministic on purpose.** A random shuffle would reorder every live quiz on each
    re-seed, and `quiz_options` is upserted by `(question_id, sort_order)` — so the text
    under a stored id would change while a learner was part-way through answering.
  - This fixes the three existing quizzes as well as the seven new ones. It needed no
    change to the content files: the author still writes the right answer first.

#### Verified

`npm run db:seed` loads 30 lessons and 10 quizzes. Then, against the live database:

- **10 of 10 core modules** have both lessons and a quiz. The nine still empty are concept
  and technology modules, which sit after the technology choice.
- **All 310 lesson blocks** validate against `LessonContent` (`design.md` §13.3) — the five
  block types and the two callout tones, nothing invented.
- **All 51 answer keys** still point at the option the author marked correct, checked row by
  row against the seed file after the rotation.
- `GET /modules/:id` returns Arrays and objects with its three lessons (11, 13 and 13
  blocks); `GET /assessments/:id` returns the five questions and **no answer-key field** of
  any name (§6 rule 2).
- 244 API + 263 web + 24 worker tests, lint and typecheck clean.

### 2026-09-22 — A roadmap job that failed had no way back

Starting onboarding with Ollama not running left the learner on `/onboarding/generating`
forever. The job failed three times, was marked `failed`, and nothing in the system ever
looked at it again — `claim_next_ai_job()` only reads `queued`. Starting Ollama afterwards
changed nothing.

Confirmed against the development database: one `roadmap_generation` row, `failed`,
`attempts = 3`, error `fetch failed`. And a second thing nobody had noticed yet — that
learner had **two active roadmaps**, because the way out of the stuck screen was a "Try
again" that walked back to placement, and placement inserted a roadmap every time it ran.

#### Fixed

- **The three attempts are three attempts now.** The worker waits before putting a failed
  job back on the queue — 15 seconds before the second attempt, 60 before the third.
  `claim_next_ai_job()` takes the oldest queued job, so a job re-queued immediately is
  re-claimed on the next poll: all three attempts landed inside a second, against the same
  dead socket. That is not a retry policy, it is one attempt with extra steps.
  - The job stays `running` while the worker waits, which is honest — it has not finished
    with it — and the wait is interruptible, so `Ctrl + C` is not ignored.
- **Jobs left `running` by a worker that stopped are put back on the queue at startup.**
  Only one worker ever holds a job (§7: one at a time on one GPU), so anything still
  `running` when a worker starts was abandoned — a crash, a `Ctrl + C` during the retry
  wait, a machine that slept. It would otherwise sit there forever for the same reason a
  `failed` job does.
- **`fetch failed` says what it means.** `fetch` reports a refused connection as that bare
  string, which is what landed in `ai_jobs.error` and told whoever read it nothing. An
  unreachable Ollama now says so, and where the worker looked.
- **Placement stops creating a second roadmap.** It reuses the learner's active roadmap for
  that career path, and reuses the job attached to it: a `failed` one is re-queued, a
  `queued` or `running` one is left alone, and only a `completed` one gets a fresh job.
  Before this, every pass left another active roadmap behind — invisible, because Home and
  the chart both read the *newest* active roadmap, and permanent, because §6 rule 5 means
  nothing is going to delete it.
- **The generating screen knows the job failed.** It polled the step, saw `generating`, and
  said "this usually takes under a minute" indefinitely. `GET /onboarding` now reports the
  job's status, and the screen says "We couldn't build your roadmap" with a "Try again"
  straight away instead of after a minute of false reassurance.

#### Added

- **`POST /onboarding/generating/retry`** — puts *this learner's* failed roadmap job back
  on the queue, with `attempts` reset so it does not give up again on the spot. The job is
  found from the session (§6.1 step 3), so there is no id in the request that could point
  at somebody else's. 409 when there is no job to retry; a queued or running job is left
  alone, because asking again would not make it faster.
- **`GET /onboarding` reports `generation`** — the job's status and **nothing else**.
  `ai_jobs.error` is whatever the worker threw: a model message, a host from a driver
  error, a fragment of a prompt. §6 rule 2 keeps all of it out of a learner response, so
  the screen writes its own copy from the status. A test asserts the error text never
  appears in the response body.
- **Eleven API tests and three web tests** covering the retry, placement's idempotence, and
  the screen's failure state.

#### Notes

- **Mutation-tested, two vulnerabilities.** Removing the retry lookup's `user_id` scope so
  it finds any learner's newest job is caught. Removing the *update's* `and user_id = $2`
  is **not** — and cannot be, because with the lookup correct there is no way through this
  endpoint to hold a job id that is not yours. It stays as a backstop against the day
  someone widens that lookup, and the code says so rather than implying a test exists.
- **The backoff has no automated test.** `apps/worker` still has no database test harness
  (tracked), so the retry timing was read rather than run. Moving `apps/api/src/test/db.ts`
  into `packages/` would let the worker use pg-mem too.
- **A longer-term fix this does not make:** a `next_attempt_at` column on `ai_jobs`, with
  `claim_next_ai_job()` skipping rows that are not due. That is the proper shape for a
  queue, and it would let the worker take other work while one job waits. It needs a
  migration, the schema doc, and the claim function, so it is recorded rather than done.

### 2026-09-22 — The learner side, built from the prototype this time

The previous entry claimed the design system's `ui_kits/app/` was the authority on what a
learner screen looks like. **It is not.** That kit is a generic learning app the system
ships to show how its parts compose; the actual design for this product is
`First Commit.dc.html` in the claude.ai design project, screen by screen, with real
measurements. Building from the kit produced screens that were coherent and wrong — most
visibly the frame, which the kit puts as an ink sidebar under a white top bar and the
prototype puts as an ink pill above a white sidebar panel.

This pass reads the prototype and follows it. It was read only; nothing was written back
to the design project, and nothing was committed.

#### Changed

- **`LearnerShell` is the prototype's frame.** An **ink pill** floating on the page wash —
  not a band — carrying the wordmark, the tabs, the bell and a profile button whose avatar
  is a lime disc with the learner's initials. Below it a **white sidebar panel** and the
  content beside it. Everything is a rounded panel on the wash, which is what §3.3 has
  always said and the shell was the last thing not doing.
- **Navigation is two levels now**, which §4.2 did not describe: three tabs — **Home,
  Study, Career** — and the tab's destinations in the sidebar. Home draws no sidebar
  because it has nowhere else to go. The active tab is a lime fill with ink on it; the
  active sidebar item is a violet tint.
  - Module, quiz, exercise and the technology choice have no navigation item of their own.
    They are opened *from* a roadmap, so they keep **Study** lit and its panel in place
    rather than leaving the learner looking at unlit navigation.
  - Below 640px the two levels collapse to one bottom bar, as before. Two rows of
    navigation above a 320px viewport leaves nothing for the content, and the prototype —
    drawn at 1440 — does not answer the question.
- **Home is the hero panel.** A violet gradient panel with the greeting as its eyebrow,
  "Pick up where you left off." as the headline, and Continue lesson beside View roadmap.
  The **ink card inside it** names the current module, the lesson, and the two counts —
  modules passed and remaining. Then the roadmap panel, then Updates.
  - The prototype sets the headline's accent phrase in lime, which measures **1.98:1**
    against that wash. §3.1's rule holds: violet-700 on light, lime on ink. The ink card's
    "CURRENT MODULE" eyebrow *is* lime, at 13.1:1.
- **The module page** is a header panel, an update notice as its own tile, a lesson rail
  and a reading panel, and a violet "Already know this?" strip. **The quiz is a row in the
  lesson list** under a rule, which is what §5.9's sketch has always shown.
- **The quiz result is a green tick and a sentence**, on the same white panel as every
  other state — not the ink panel with a lime score the previous pass invented. Icon, text
  and colour is all §8 asks for. What the learner got right sits below it on the verified
  tint, which is the prototype's green "Review:" box.
- **The technology choice** puts the recommendation's weight where the words already are:
  **primary on the recommended option, secondary on the rest**, which is what the prototype
  does. The previous entry argued both should be primary; the prototype disagrees, and the
  recommendation is labelled twice in words either way (§12). The comparison is plain
  lines under a rule rather than tiles, and "Is this wrong?" is an underlined link rather
  than a button.
- **The roadmap header** is a panel with the title, the bar, and the legend as a quiet row
  of icon-and-word under a rule — four badges were louder than a key to a chart needs to
  be. The side panel now follows the learner down the chart and lifts off the page.

#### Added

- **`map`, `layers`, `file-text` and `plus`** to `Icon`, which the two-level navigation
  needs.
- **`ProgressBar` takes `hideLabel`** — the accessible name stays, the visible header goes.
  Only for a bar whose text is already beside it, which on the quiz is "Question 3 of 8".

#### Fixed

- **`LessonRow` is the prototype's row**, not the design system's: the label on the left,
  the status icon on the right, a violet tint on the row being read. No numbered disc, so
  the three contrast corrections the disc needed are moot — but read and current stay
  separate props, because that bug was real and is still the right call.

#### Verified

`npm run typecheck` clean, `npm run lint` clean, **244 API + 260 web + 24 worker tests**,
and **152 Playwright tests** across the four §11.4 widths. Ten web assertions moved with
the copy and the markup they describe, and three e2e tests were rewritten for the two-level
navigation: the walk over every destination now covers both levels, and the icon-rail test
became "every navigation item keeps its accessible name", which is the §12 guarantee the
old test was standing in for.

Every screen was driven in a real browser at 360, 768 and 1440 and read back as a
screenshot before the tests were touched.

#### Still not the prototype

- **The roadmap chart** is our React Flow canvas, not the prototype's row-based spine. Both
  draw §2.1's layout; reconciling them is a piece of work in its own right and is not part
  of this pass.
- **"Roadmap menu"**, **"Try taster lesson"**, and the profile menu's **Log out** are in the
  prototype and absent here. Each needs something that is not built — §5.7's menu actions,
  a home for taster lessons (AGENT.md §11), a sign-out screen — and a dead control is worse
  than an absent one.
- **Explore modules, Capstone, Certificates, Resume, Profile and Settings** are designed in
  the prototype and still render a `Placeholder`. They are tracked per route in
  `task-tracker.md`.

### 2026-09-22 — The learner screens get the design system, not just its tokens

Four learner screens — the roadmap, the module page, the quiz, and the technology choice —
used the `Card` component **zero times** between them. They were built correctly from
`design.md` §5's behaviour and §3's tokens, and they passed every gate in the repo, but
none of them carried the design system's actual vocabulary: no panels, no ink surface, no
accent phrase. Home used `Card`, but only as three white boxes.

The reference for this pass was the design system's own `ui_kits/app/` — `AppShell`,
`Dashboard`, `LessonPlayer` — read from the claude.ai design project. It was read only;
nothing was written back, and nothing was committed.

> **Superseded the same day.** That kit is a generic learning app, not this product's
> design. `First Commit.dc.html` is, and the entry above this one rebuilds the learner
> side from it. What survives from this pass: the panels themselves, `Card`'s `radius` and
> `as`, the read-versus-current split in `LessonRow`, the two-`main` fix, and the review
> rows' alignment. What did not: the inverted shell, Home's ink Continue panel, and the
> quiz's ink pass panel.

#### Changed

- **`LearnerShell` is inverted.** The design system's app shell is an **ink sidebar** under
  a **white top bar**; ours was the opposite. The sidebar now carries the wordmark and the
  destinations, with the active item as a white label on a faint white wash and a **lime
  icon** — three cues, since §8 does not let colour be the only one. The top bar names the
  area you are in, beside the bell and a new avatar, as §4.2 has asked for all along.
  - Below 640px there is no sidebar, so the top bar carries the wordmark instead of the
    area name. Its accent word is **violet on white and lime on ink** — the same word in
    two colours, because §3.1 makes the accent phrase follow its surface.
  - Module, quiz, and exercise have no navigation item of their own (§4.2 offers none), so
    the bar names **Roadmaps** while they are open: they are opened from a roadmap.
  - The avatar links straight to Settings rather than opening a menu. §4.2 asks for a
    profile menu; until Settings is a real screen there is nothing for a menu to hold, and
    the link's accessible name says where it goes.
- **Home spends its one loud panel on Continue.** An ink panel at panel radius, an on-dark
  badge, a two-line headline whose second line is the module title in lime (13.1:1 there,
  1.98:1 on the page wash), and the lime call to action. Continue and the roadmap panel
  tile as an asymmetric two-up at `lg`, with Continue in the wide slot. The greeting's name
  is the accent phrase on a light surface, so it is violet-700.
  - **"Nothing is waiting on you" is deliberately not ink.** The dark panel marks the thing
    to do next; spending it on an empty state teaches the learner to ignore it.
- **The module page is three panels** — header, lesson rail, reading panel — where it was
  two bare columns on the page wash. The rail gained a lesson count, a "3 of 5 read"
  progress bar, and the quiz at its foot; the reading panel opens with a micro eyebrow
  naming the lesson's place in the module.
- **The quiz result** is an ink panel with the score in lime when the learner passes, and a
  plain panel when they do not. §3.1 keeps `--error` for the answer that failed, never for
  the learner's progress. Topics to review moved to their own white panel.
- **The technology choice** dropped its 760px cap — two comparison cards side by side is
  the point of the screen — and its AI panel, option cards, and confirmation are now real
  panels. The comparison rows sit on inset tiles.
- **The roadmap header** is a panel above the chart, with an eyebrow over the title.

#### Added

- **`LessonRow`** (`components/learning/`) — the module page's lesson rail, ported from the
  design system, which `design-source.md` §4 had left behind as course-shop furniture. It
  was not: §5.9 gives the rail the same three states.
- **`Card` takes `radius="panel"` and `as`.** §3.4's radii nest — 14 inside 20 inside 28 —
  and a card that *is* a section of the page is a panel. `as` renders it as the `li`,
  `section` or `header` the surrounding markup needs, instead of wrapping a `div` in one.
- **`--surface-on-dark-active` and `--surface-on-dark-hover`** — the two washes the ink
  sidebar needs. Inline `rgba(...)` would have broken the rule that only `tokens.css` holds
  literal colours.
- **Screen design coverage** in `task-tracker.md` — every route in §4.3 with a visual state
  each: applied, not applied, designed, or to design.

#### Fixed

- **`LessonRow` splits read from current.** The design system models a lesson as
  `todo | active | done`, which is right for a video course: the lesson you are on is by
  definition the one you have not finished. A First Commit lesson is read by pressing
  "Mark as read" and stays open afterwards, so it is routinely **both** — and folding them
  into one value dropped the tick from the row the learner was standing on. A test caught
  it. They are separate props now.
- **Three contrast corrections in that row**, all inherited from the source: the current
  lesson's disc was `--violet-500`, where white measures **3.98:1**, and is now
  `--violet-600` at 5.65:1; an unread number was `--text-faint` on `--surface-inset` at
  **2.65:1**, and is now `--text-muted` at 4.88:1; and because `--text-muted` measures
  **4.44:1** on the current row's violet tint, a row that is both read and current keeps
  `--text-strong`. The source also made the row a `<div onClick>`, which no keyboard can
  reach.
- **The quiz's "What you got right" rows were centred, not left-aligned.** A specificity
  clash that predates this pass and that nothing could have caught but looking:
  `.reviewList > li` is (0,1,1) and `.reviewExplained` only (0,1,0), so the column's
  `align-items: flex-start` lost to the row's `align-items: center`. Found in a screenshot
  taken to check the new ink panel.
- **The module page had two `main` landmarks** — the learner shell renders one and the
  reading column rendered another. A page with two has none a screen reader can jump to
  reliably. The reading column is a `section` now.

#### Why it happened, since the answer was not "we decided to"

Nothing in `CHANGELOG.md` or `task-tracker.md` recorded a decision to defer this, because
there was not one. Four things let it through:

1. **The Phase 1.5 plan deferred 28 screens** and said they were tracked in the tracker.
   They were — as *functional* tasks. No item anywhere said "apply the prototype's design
   to screen X".
2. **The tracker named the prototype only in the negative** — five lines, all "not in the
   prototype, design it". The 26 routes it *did* cover got no line at all, so "covered by
   the prototype" quietly came to mean *needs no design work*.
3. **The reference screen that closed Phase 1.5 had already dropped the vocabulary.**
   `git show 109f2ce:.../Home.module.css` is three white cards with no ink panel and no
   accent phrase. It proved the tokens and the components; it never proved the composition,
   and every learner screen built afterwards copied it.
4. **No gate can see it.** typecheck, `jsx-a11y` as errors, 259 unit tests, axe, Playwright
   at four widths, and the contrast gate all pass on a screen made of bare `div`s, provided
   the `div`s use tokens. The contrast gate reads `tokens.css` from disk and never looks at
   whether a screen uses what it checks.

The changelog says the same thing in its own voice: every Phase 2 learner entry cites §5
and §6, and **not one cites §3**.

#### Documentation

- `design.md` — §2.3 gains the one-loud-panel rule and says the ink panel does not compete
  with the roadmap; §4.2 describes the ink sidebar, the white bar, and what the bar names
  on a module page; §5.6, §5.9 and §5.10 describe their panel treatment; §7 gains
  `LessonRow` and records `Card`'s two new props.
- `design-source.md` — §1 names `ui_kits/app/` as the authority for learner screens; §3.5
  records the read-versus-current split and its three contrast corrections; §4 explains why
  `LessonRow` was ported after all; §5 records why the 26 covered routes were the ones that
  went wrong.
- `AGENT.md` — the web section now states that tokens alone are not the design system, and
  that no gate in the repo can catch the difference.

#### Verified

`npm run typecheck` clean, `npm run lint` clean, **244 API + 259 web + 24 worker tests**
passing including the contrast gate, and **152 Playwright tests** across the four §11.4
widths. Four unit tests changed with the copy they assert: three on Home, where the
greeting and the headline are now two elements each, and one on the module rail — the test
that caught the read-versus-current bug.

Every screen was also **driven in a real browser** at 360, 768 and 1440 and read back as a
screenshot, which is how the centred review rows turned up. The 2026-09-19 adoption entry
closed with "worth re-checking by hand before the layout is trusted" about exactly this,
and the check never came back until now.

One caution for the next run: Playwright reuses an existing dev server locally, so **editing
a source file while the suite runs leaves Vite serving a stale module** — here it produced
104 failures reading "does not provide an export named `LearnerShell`", none of them real.
Kill the server on 5173 and re-run before believing a red suite.

### 2026-09-22 — The documents catch up with the code

A sweep across every document, closing the gaps that had accumulated while the learner path
was being built. Nothing here changes behaviour except one route rename.

#### Changed

- **`README.md`** said "Nothing has run against a real database yet" and "Phase 1 is 9 of
  10". Both had been false for days. It now carries a phase table, the full first-run
  sequence including `db:seed` and `db:accounts`, and the three terminals needed to run the
  thing.
- **`design.md` §4.3** gained the three routes that exist and were not in the map:
  `/app/roadmap/:id/technology/:decisionId`, `/app/quiz/:id`, and the reason each is shaped
  that way. The signed-in redirect row now names where "their own area" is.
- **`design.md` §5.4** claimed placement skips what a learner already knows. It cannot:
  skipping writes no evidence, so a skipped module can be neither required for the
  certificate nor a prerequisite of anything on the roadmap. Only testing out really
  removes a module. The section says so now, with the two rules the validator enforces.
- **`design.md` §7** marks the twelve roadmap, technology and lesson components as built,
  and `LessonBody` was missing from the table entirely.
- **`design.md` §13.1** listed "elkjs or dagre" for chart layout. The layout is written —
  a fixed spine is not a general graph — and the table now says why, and where a solver
  would still suit.
- **`database-schema.md` §8.4 is new**: how a result actually reaches the browser. The
  flows in §8.1–8.3 all ended "through server-sent events" and nothing said how the API
  learned a row had been written. It was decided long ago (the worker posts to
  `/internal/events`, the API sweeps every 10 seconds) and never written down.
- **`model-setup-guide.md` §11** told you to use a "direct connection (port 5432)", which
  on Supabase is IPv6-only and unreachable from an IPv4 machine. It now explains session
  mode, and three new troubleshooting rows cover `ENOTFOUND`, the pooler port, and the
  prompt-version refusal.
- **`AGENT.md` §11** — the SSE question is struck through as settled and pointed at its new
  section; four new ones replace it, each found by building something that needed an answer.
- **`/app/modules` renamed to `/app/explore`.** §4.3 said `explore` and the router said
  `modules`. Docs are authoritative and the screen is a placeholder, so the router moved.

#### Notes

- A link check across all eight documents: every internal reference resolves.
- `project-proposal.md` is still written as an academic study — "Proponent(s)", an adviser,
  a defense, an evaluation plan on ISO/IEC 25010. It is the author's own document and was
  left alone, as flagged when the project stopped being a thesis.

### 2026-09-22 — The site never checked whether you were already signed in

Reported as "the website doesn't hold the session — all I need is to reset the website to
log in to another account." The session was being held correctly the whole time: the cookie
persists for 30 days, `httpOnly`, `SameSite=Lax`, and `GET /auth/me` returns the user on
every request. **Nothing on the public pages was looking at it.**

#### Added

- **`RedirectIfSignedIn` on `/login` and `/signup`** — design.md §4.3's last redirect rule,
  "Anyone signed in | `/login` or `/signup` | Sent to their own area", which had never been
  built. A signed-in learner opening the site was shown a log-in page as though they were a
  stranger, and could sign in as somebody else without ever signing out.
  - "Their own area" is the same answer `POST /auth/login` gives in its `next`: `/admin`
    for an admin, the unfinished onboarding step for a learner mid-flow, `/app` otherwise.
  - Password reset stays reachable while signed in. §5.3's reset clears every session, so
    someone using it has a reason to, and bouncing them away would be the wrong moment to
    be clever.
  - 5 tests.
- **`npm run db:accounts -- reset`** puts the development learners back to their first day:
  roadmaps, completions, enrolments, lesson progress, quiz attempts, placement results, AI
  jobs and outputs all removed, and the profile back to the `about` step.
  - It deletes real evidence, which §6 rule 5 forbids anywhere near a learner who earned
    it. That is why it lives only here, behind the production refusal, and why nothing in
    the API can do it.
  - `certificates` and `capstone_projects` hold `on delete restrict` references to a
    roadmap, so they are cleared first or the delete is refused.
  - `reset` is a positional, not a flag, for the same reason `stub` is: npm strips unknown
    `--flags` in a nested workspace run, and a silently ignored `--reset` would be a delete
    that looked like it happened and did not.

#### Notes

- Landing (`/`) still shows the marketing page to a signed-in visitor, because §4.3 names
  only `/login` and `/signup`. Whether it should say "Go to your roadmap" instead of
  "Log in" is recorded as a decision rather than made here.

### 2026-09-21 — Two redirects fighting over the same learner

The generating screen worked, but the browser console said "Maximum update depth exceeded"
and then "Throttling navigation to prevent the browser from hanging", with a 500 on
`/home` in the middle of the storm. Reported from a real run, not from a test.

#### Fixed

- **`Generating` and `RequireLearner` were both redirecting to `/app`.** The screen called
  `navigate("/app")` when the step reached `done`; navigating changed the location,
  `useNavigate` returned a new identity, the effect's dependencies changed, and it
  navigated again — a loop, on top of the guard's own redirect.
  - The screen navigates nowhere now. `done` means the session's `onboardingStep` is
    stale, so it refreshes the session and lets the guard — which already owns that
    decision — do the one redirect. Polling also stops at `done`, so nothing is in flight
    while the redirect happens.
  - The `/home` 500 was a symptom: the loop hammered the endpoint. It does not reproduce,
    and `buildHome` returns cleanly for both learners with roadmaps.
- **The inner guards redirected before the session had loaded.** `RequireLearner`,
  `RequireAdmin` and `RequireOnboardingStep` all read a not-yet-loaded session as an
  answer: `onboardingStep` is null before it arrives, which `RequireLearner needsOnboarding`
  read as "onboarding is finished" and redirected on. They were only correct because
  `RequireAuth` waits above them in the router — §13.6 says guards render nothing while the
  session loads, and now each one does that on its own.
  - Found by writing the test for the first bug: mounting `Generating` under its real guard
    made the guard redirect instantly, before `/auth/me` had returned.
  - Four tests now mount each guard **alone**, which the router never does, precisely
    because that is where the assumption hides.

#### Notes

- The test for the first fix mounts the screen and the guard **together**, since the bug was
  the two of them disagreeing — neither in isolation was wrong. The session handler changes
  its answer between calls, the way the worker changes it underneath a real learner.
- Both defects were re-introduced afterwards and both failed the suite.

### 2026-09-21 — The worker's connection string was impossible on Supabase

`apps/worker/.env.example`, `AGENT.md` §4 and `config.ts` all told you to use a "direct
PostgreSQL connection (port 5432, not the pooler)". On Supabase that host is
`db.<project-ref>.supabase.co`, which **publishes an AAAA record and no A record** — so on
an IPv4-only machine it fails with `ENOTFOUND` and no amount of retrying helps. Confirmed:
the host resolves only to IPv6, and this machine has no routable IPv6 address.

#### Changed

- The worker's requirement is **session mode**, not "direct" — it holds one long-lived
  connection and claims jobs with `for update skip locked` inside a transaction. On
  Supabase that is the **pooler host on port 5432**: the same string the API uses with 6543
  changed to 5432.
- Corrected in `apps/worker/.env.example`, `apps/worker/src/config.ts`, `AGENT.md` §4 and
  `docs/database-schema.md` §9.3, each saying why rather than just naming a port.
- Verified against the session pooler: it connects over IPv4, `claim_next_ai_job()` runs
  with `for update skip locked` inside a transaction, and a named prepared statement is
  reused — the three things transaction pooling would break.

### 2026-09-21 — The Roadmap AI, run for the first time

Written days ago, validated against real PostgreSQL, and never actually asked anything. It
works: **three runs on qwen3.5:4b, one attempt each, 7.5–8s warm**, all choosing Frontend
with an explanation tied to the learner's stated goal. The catalogue is presented in an
already-valid order precisely so a lazy answer is still correct, and one attempt every time
is that design paying off.

Measured while I was there: the prompt is ~2,400 tokens of the 8,192 context, leaving
~5,800 for the answer and any retry turns. Context was a risk; it is not one.

#### Fixed

- **`npm run check` recommended dropping a safety layer.** It ranked the JSON modes by
  validity, then first-try, then **speed** — and on this machine all three scored 5/5, so
  `prompt_only` won by 0.1s. That mode sends no schema at all: the model is merely asked
  for JSON and Zod is the only thing behind it. AGENT.md §7 is explicit that both layers
  stay and that this check exists to measure *whether schema mode is reliable here*, not
  which mode is quickest. Schema modes now win a tie, and the output says why. It
  recommends `think_off_schema` — which is what the worker was already using.
- **Regenerating a roadmap stranded the technology choice.** `applyRoadmapPlan` deleted
  every `source = 'generated'` item, including the framework modules the learner put there
  by answering §5.8 — leaving a roadmap that said "you chose Vue" with **zero Vue modules
  on it**. Found by running the thing rather than by reading it.
  - Technology modules now survive a regeneration. They are not the plan's to write.
  - Unless the regenerated plan lands on a **different track**, in which case the choice
    belonged to a track no longer on this roadmap, so the choice and its modules go with
    it and the learner picks again.
  - Verified against real PostgreSQL: choose React → 2 modules; regenerate same track →
    still React, still 2; regenerate onto Backend → choice cleared, modules gone.
- **`npm run try:roadmap -- … --stub` silently called the model.** npm strips unknown
  `--flags` in a nested workspace run, so the argument never reached the script — a flag
  whose entire purpose is "do not use the GPU" quietly used it. It is a positional now
  (`… junior-web-developer stub`); `--stub` still works when running the file directly.

#### Notes

- **`npm run check`, run for the first time** (AGENT.md §7: "decided by `npm run check` on
  this machine, not by assumption"). On qwen3.5:4b, all three modes returned 5/5 valid on
  the first try; `think_off_schema` averaged 1.1s, `prompt_only` 1.0s, and
  `think_on_schema` 12.5s. Schema mode is reliable here, so both layers stay.
- `apps/worker` has no database test harness, so `apply.ts` and `catalogue.ts` are checked
  against the real database by hand rather than by a test. `apps/api/src/test/db.ts`
  already builds pg-mem from the real migration; moving it to `packages/` would let the
  worker use it. Recorded in the tracker.
- Three runs is a sanity check, not the §9 evaluation harness.

### 2026-09-21 — Accounts you can actually sign in with

There were two accounts in the development database and neither could log in: both had
placeholder password hashes (`x` and `not-a-real-hash`) left behind by the verification and
pipeline checks. Sign-up always creates a learner, so there was also no way to reach
`/admin` at all.

#### Added

- **`npm run db:accounts`** — creates `admin@firstcommit.test`,
  `learner@firstcommit.test` and `student@firstcommit.test`, all active and email-verified,
  sharing one development password (`--password` overrides it).
  - **This is the sanctioned way to make an admin.** AGENT.md §6 rule 8: "No endpoint
    updates `users.role`. The first admin is set by running SQL directly."
  - It hashes with the API's own `hashPassword`, not a copy — so the accounts authenticate
    through the real argon2id path, and tuning those parameters later cannot leave them
    unloggable. Verified: the right password returns true, a wrong one false.
  - Two learners on purpose, so "learner A cannot see learner B's data" can be tried by
    hand as well as in a test.
  - It **refuses to run when `NODE_ENV=production`**, and asks before writing to a remote
    database that has not declared itself as development. Known-password accounts are
    exactly what must never reach a deployment.
  - Idempotent, and it clears the account's sessions so a re-run is a clean slate.

#### Fixed

- **The API never loaded its `.env`.** `apps/api` has no dotenv and its dev script was
  plain `tsx watch src/index.ts`, so `npm run dev:api` would have failed on
  `DATABASE_URL` — the endpoint tests inject a pool and never noticed. Now
  `tsx watch --env-file-if-exists=.env`, so a missing file still gives config's named
  error rather than an ENOENT.

#### Notes

- Verified by hand against the running API: `POST /auth/login` returns 200 with an
  `httpOnly` `SameSite=Lax` session cookie, the admin's `next` is `/admin` and the fresh
  learner's is `/onboarding/about`, and a wrong password gives §6.3's non-leaking
  "Email or password is incorrect."
- **`SESSION_SECRET` is still the placeholder text** in `apps/api/.env`. `required()` only
  checks for non-empty, so the API boots and sessions work — with a publicly known signing
  secret. Both the value and the missing validation are recorded in the tracker.

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
