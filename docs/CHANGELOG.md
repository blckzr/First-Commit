# Changelog

Task log for First Commit. Every task adds an entry here before it is considered done
(see [`AGENT.md`](../AGENT.md) §10).

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). This project
does **not** follow semantic versioning yet — it is pre-release thesis work, so everything
lives under `[Unreleased]` until there is something to version.

---

## [Unreleased]

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
