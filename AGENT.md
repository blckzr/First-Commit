# AGENT.md — First Commit

Instructions for any AI agent working in this repository. `docs/` is the specification;
this file is the working contract.

---

## 1. The project

**First Commit** is an AI-assisted online learning platform that takes an aspiring
programmer from their first lesson to a job-ready portfolio: a personalized roadmap,
hands-on practice with feedback, a capstone project built on the learner's own GitHub,
verifiable certificates, and an honest ATS-friendly resume.

It is an **undergraduate thesis project**. That matters for how you work: the written
documents are defended, so code must match them, and every design decision needs a reason
that traces back to a document.

Two user types, and only two: **learners** and **admins**. One role per account, no role
switcher.

Three AI components, all running on one local open-weight model (Qwen3.5 via Ollama):

| Component | Does | Never does |
|---|---|---|
| **Roadmap AI** | Picks modules, track, and technology from admin-defined content | Invents modules or ignores prerequisites |
| **Code Review AI** | Explains test and lint results in beginner language | States correctness the tests did not prove, or writes the fix |
| **Resume AI** | Writes summary and project text from verified evidence | Adds a skill, level, or experience without evidence |

### Source documents

| Document | What it settles |
|---|---|
| [`docs/project-proposal.md`](docs/project-proposal.md) | Scope, learning structure, AI component design, evaluation plan, risks |
| [`docs/design.md`](docs/design.md) | Every screen, design tokens, components, copy rules, frontend implementation |
| [`docs/database-schema.md`](docs/database-schema.md) | Architecture, tables, the backend security checklist, DB functions, hosting |
| [`docs/model-setup-guide.md`](docs/model-setup-guide.md) | Ollama setup, VRAM budget, JSON modes, worker operation |
| [`supabase/migrations/0001_initial_schema.sql`](supabase/migrations/0001_initial_schema.sql) | The schema itself — the final word on any table question |
| [`docs/task-tracker.md`](docs/task-tracker.md) | What is planned and what is done — tick tasks off as you finish them |
| [`docs/CHANGELOG.md`](docs/CHANGELOG.md) | What changed, dated, task by task |

The stack is settled in `docs/project-proposal.md` §8.2: **React + TypeScript in the
browser, Node.js + Express (TypeScript) owning authentication and all business rules,
PostgreSQL hosted on Supabase, API deployed on Render.** Do not propose a replacement
backend or reintroduce Row Level Security — an earlier draft used Supabase as the backend
with RLS, and it was deliberately replaced.

---

## 2. Your two roles

You work as one person wearing two hats. Say which one you are wearing when it is not
obvious.

### AI engineer — owns `apps/worker` and the model

Prompts, JSON schemas, validation and retry logic, job handlers, Ollama configuration, the
VRAM budget, and the evaluation harness in `docs/project-proposal.md` §9 and
`docs/model-setup-guide.md` §12. You care about whether output is *valid, grounded, and
fast enough on one 8GB GPU*.

### Fullstack developer — owns `apps/web`, `apps/api`, and the schema

React screens, routing and guards, design tokens, accessibility, and data fetching; plus
the Express API — sessions, every permission check, all business rules, GitHub webhooks,
certificate issuance, SSE — and the migrations behind it. You care about whether the
interface *matches `docs/design.md`* and whether the API *cannot be used to read or forge
someone else's evidence*.

### The seam between them

**Server code writes evidence. The browser never does.** When a feature needs something
recorded as proof of learning, it is written by an API endpoint or by the worker from
results it computed itself — never from a number the browser sent. This is the single most
important rule in the repo (§6).

---

## 3. Architecture

```
  Browser                Render                    Supabase
 ┌──────────┐      ┌──────────────────┐        ┌──────────────┐
 │ React    │─────►│ Express API      │───────►│ PostgreSQL   │
 │ + TS     │◄─────│  sessions, rules │───────►│ Storage      │
 │ (Vite)   │ SSE  │  webhooks, certs │        └──────────────┘
 └──────────┘      └────────▲─────────┘               ▲
                            │ webhooks                │ claims jobs,
                        GitHub App                    │ writes results
                            ▲                ┌────────┴──────────┐
                            │                │ Worker (Node 20)  │
                            └── notifies ────│   ├─ Ollama       │
                              /internal/     │   │   Qwen3.5     │
                                 events      │   └─ Judge0       │
                                             └───────────────────┘
                                                (your machine)
```

- **The browser talks only to the Express API.** It never connects to the database. Every
  permission check therefore happens in one place, which is also this design's main risk —
  see §6.
- **GitHub webhooks go straight to the API**, which has a public HTTPS address on Render.
  No tunnel is needed.
- **The worker only makes outgoing connections.** It pulls jobs from PostgreSQL rather than
  waiting to be called, so nothing on the internet needs to reach the machine with the GPU.
- **SSE:** after the worker writes a result it posts to `/internal/events` with a shared
  `WORKER_SECRET`, and the API pushes it to that learner's open stream. The API also sweeps
  for unsent rows periodically, so a missed notice delays an update rather than losing it.
  (`LISTEN/NOTIFY` is not used: it does not work through Supabase's connection pooler,
  which the API uses.)
- **Free plans sleep.** Render sleeps after 15 minutes and takes 30–60s to wake; Supabase
  pauses after a week idle. The worker's periodic commit check is the backstop for a
  webhook that arrives while the API is waking.

---

## 4. Stack

### Web (`apps/web`, not yet scaffolded)

React · TypeScript strict · Vite · React Router (separate learner and admin route trees) ·
TanStack Query · React Hook Form + Zod · React Flow (`@xyflow/react`) for the roadmap
chart · elkjs or dagre for node layout · CodeMirror 6 (not Monaco — better on touch and
small screens) · Sandpack for React and Vue practice · CSS Modules with CSS custom
properties · Recharts for admin analytics · Vitest + React Testing Library + Playwright ·
eslint-plugin-jsx-a11y + axe.

Full table with rationale: `docs/design.md` §13.1.

### API (`apps/api`, not yet scaffolded)

Node 20+ · TypeScript · Express · `pg` (connection pooler, port 6543) · argon2id password
hashing · database-backed sessions with `httpOnly` `secure` cookies and CSRF defense ·
server-sent events · Supabase Storage for lesson media and certificate PDFs.

Deployed on Render, Singapore region. `app.set("trust proxy", 1)` is required for cookies
behind Render's proxy.

### Worker (`apps/worker`)

Node 20+ · TypeScript · `tsx` · Zod · Ollama's **native `/api/chat`** endpoint · direct
PostgreSQL connection (port 5432, not the pooler).

> The OpenAI-compatible endpoint is deliberately **not** used: schema enforcement has been
> reported as unreliable through it for Qwen3.5. See `docs/model-setup-guide.md` §8.

> **Current state:** the worker still uses `@supabase/supabase-js`. Porting it to `pg` is
> the next task. Until then, code and docs disagree here — knowingly.

---

## 5. Repo layout

```
First-Commit/
├── AGENT.md              This file
├── CLAUDE.md             Imports AGENT.md
├── README.md             Orientation and doc index
├── package.json          npm workspaces root (apps/*, packages/*)
├── docs/                 The specification, the task tracker, and the changelog
├── supabase/
│   └── migrations/       0001_initial_schema.sql, then numbered migrations
├── apps/
│   ├── worker/           Local AI worker (Node + TS)
│   ├── api/              Express API — NOT YET SCAFFOLDED
│   └── web/              React app — NOT YET SCAFFOLDED
└── packages/             Reserved for shared types
```

Root scripts: `npm run dev` (web app), `npm run lint`, `npm run test`,
`npm run typecheck`, and for the AI worker `npm run worker`, `npm run check`,
`npm run try:feedback`.

### `apps/worker/src`

| File | Purpose |
|---|---|
| `config.ts` | Reads `.env` |
| `ollama.ts` | **Every model call goes through here.** Calls Ollama, validates with Zod, retries invalid output |
| `schemas.ts` | Output shapes for code feedback, roadmaps, resumes; includes `noSolutionLeak` |
| `prompts/code-feedback.ts` | Builds the Code Review AI prompt |
| `check-setup.ts` | `npm run check` — verifies Ollama, compares JSON modes |
| `examples/code-feedback.ts` | `npm run try:feedback` — sample run |
| `worker.ts` | Claims jobs, dispatches handlers, writes results |

### `apps/web/src` (target shape, from `docs/design.md` §13.2)

```
app/        router.tsx, guards.tsx, LearnerShell.tsx, AdminShell.tsx, providers.tsx
routes/     public/ · onboarding/ · learner/ · admin/
features/   auth · roadmap · onboarding · module · exercise · technology ·
            capstone · certificates · resume · versioning
components/ hooks/ api/ types/ styles/
```

---

## 6. Rules that must not be broken

The database no longer knows who is asking. **The Express API is the only thing standing
between an account and other people's data**, and unlike Row Level Security it **fails
open**: a forgotten ownership check silently serves the wrong learner's records. Treat
`docs/database-schema.md` §6 as a checklist, not as background reading.

### Every request, without exception

From `docs/database-schema.md` §6.1:

1. **Resolve the session** — read the cookie, hash it, look it up in `sessions`, reject if
   expired. Load `role` and `status`.
2. **Reject suspended accounts** before anything else.
3. **Filter by the user's id from the session** — never from the request body, query
   string, or a header.
4. **Check ownership of every id in the URL.** A roadmap, submission, or project id from
   the browser must be confirmed to belong to the session user.
5. **Check the role on admin routes**, and write to `admin_activity_log` when the action
   changes a learner's outcome.
6. **Select columns explicitly.** Never `select *` — it is how secrets leak by accident.

### The rules themselves

1. **Evidence is written only by server code.** `module_completions`,
   `assessment_attempts`, `milestone_attempts`, and `certificates` are never written from
   data the browser sent. Scores come from server-side grading; certificates are issued
   after the backend checks the requirements itself. **No endpoint accepts a completion, a
   score, or a `passed` flag as input.**
2. **Secrets never reach a learner response** — quiz answer keys, reference solutions,
   rubrics, hidden test cases (`is_visible = false`), AI prompts, integrity flags, check
   overrides, GitHub events. Learner endpoints filter `is_visible = true`; the rest are
   admin-only.
3. **Route guards are experience, not security** (`docs/design.md` §13.6). Hiding a page
   tidies the interface. The API is what protects the data.
4. **Browser test results never count.** Sandpack gives instant "Run tests" practice; only
   worker-run results (Judge0, or Vitest + jsdom for React and Vue) are written as
   evidence. Submission endpoints accept files, nothing else.
5. **Nothing learners depend on is hard-deleted.** Content is archived via `status`;
   foreign keys to evidence are `on delete restrict`. Never add a cascading delete to a
   content table.
6. **Content is versioned.** Progress points at the exact `module_version_id` or capstone
   brief version taken. In-progress learners finish their version; completed learners keep
   credit. Never repoint existing progress at a new version.
7. **Progress belongs to the learner, not the roadmap.** One `module_completions` row per
   learner per module, read by every roadmap. Passing Git once counts everywhere.
8. **No endpoint updates `users.role`.** The first admin is set by running SQL directly.
9. **`admin_activity_log` is append-only** — a trigger blocks update and delete. Do not
   work around it.
10. **Admins cannot mark modules passed or edit scores.** Any correction is a logged
    override with a required reason.

### Authentication

From `docs/database-schema.md` §6.3, decided as **hand-rolled** (not Better Auth — that
would weaken proposal objective #8):

- **argon2id** (or bcrypt) with a per-password salt. Never store or log a password.
- **Session, verification, and reset tokens are stored hashed**, so a database copy cannot
  be replayed as a login. Links are random, expiring, and single use.
- **Cookies:** `httpOnly`, `secure`, with a matching CSRF defense.
- **Rate-limit** failed logins and reset requests per email and per IP using
  `auth_attempts`.
- **Messages must not leak accounts:** "Email or password is incorrect." / "If that email
  has an account, a reset link is on its way."
- **Clear sessions** on log out and on password change.

---

## 7. AI component rules

From `docs/project-proposal.md` §5 and `docs/model-setup-guide.md`.

### Grounding

- **The model is never the source of truth.** It explains, personalizes, and phrases
  results the platform already computed. Tests and checks run *before* any model call.
- Correctness claims must come from test and check results, not from the model reading
  code.
- Feedback gives **hints and points at the problem — never the corrected code**.
  `noSolutionLeak` in `schemas.ts` rejects hints containing code and the worker retries.
- Roadmap output is validated against real module IDs, prerequisite order, and full core
  coverage before anything is saved. Invalid output is rejected and regenerated.
- Resume output is cross-checked against the verified-skill list; unsupported skills are
  removed. **Module completion is a *skill*, never *experience*.** No capstone means no
  Projects section.
- All AI output is labeled as AI in the UI, carries a short reason, and is flaggable by
  learners (`ai_feedback_flags`).

### Mechanics

- Every response is **JSON-schema constrained *and* re-validated with Zod**, up to **3
  retries** with the error fed back. Both layers stay — schema mode is unreliable on some
  Ollama versions, which is exactly what `npm run check` measures.
- `AI_JSON_MODE` is decided by `npm run check` **on this machine**, not by assumption.
  Re-run it after every Ollama update and when switching model size.
- **All model calls go through `src/ollama.ts`**, so swapping provider or model size is a
  one-file change.
- Prompts are versioned in `ai_prompts`, one active per component, and the version is
  recorded on each job so evaluation results map to an exact prompt. Never change a prompt
  in place without a new version row.
- After writing a result, the worker posts to `/internal/events` so the API can push it
  over SSE. Treat a failed post as non-fatal — retry, and let the API's sweep catch it.

### The hardware budget is real

RTX 4060 Ti, **8GB VRAM**. `OLLAMA_NUM_PARALLEL=1`, `OLLAMA_MAX_LOADED_MODELS=1`,
KV cache `q8_0`, context **8192** (16384 only for milestone reviews). The worker handles
**one job at a time** via `claim_next_ai_job()`.

Do not propose parallel inference, larger contexts, whole-repository review, or a second
loaded model. Milestone reviews look at **the diff only**, split by file if too large.

### Job types

| Type | Status |
|---|---|
| `code_feedback` | Implemented in `worker.ts` |
| `roadmap_generation` | **Stub** — output schema already in `schemas.ts` |
| `milestone_review` | **Stub** — output schema already in `schemas.ts` |
| `resume_generation` | **Stub** — output schema already in `schemas.ts` |

When implementing a stub: add the handler in `worker.ts`, reuse the existing schema, add a
prompt module under `src/prompts/`, and register the prompt version in `ai_prompts`.

---

## 8. Frontend conventions

From `docs/design.md`. These are not preferences — they are what the design document
commits to.

### Tokens and status

- **Design tokens only.** Use the CSS custom properties from §13.4: `--paper`, `--surface`,
  `--ink`, `--ink-muted`, `--rule`, `--action`, `--here`, `--verified`, `--error`,
  `--notice`, `--ai`. **No hard-coded hex anywhere.**
- **Status is never colour alone.** Every status is icon **+** text **+** colour (§8):
  "Passed, 88%", "You are here", "Needs JS basics".
- `--error` marks the code or input that failed, **never the learner's progress**.
- Typography: Atkinson Hyperlegible Next for UI, JetBrains Mono for code. Sentence case
  headings, no all-caps labels.
- Elevation: flat 1px `--rule` border by default; shadow only for things that float.

### One responsive layout

- **No view switchers.** No "Desktop view" button, no `/mobile` routes, no duplicate mobile
  pages, no user-agent detection. Ever.
- Layout changes use **CSS first** — media and container queries. `useBreakpoint`
  (`window.matchMedia` via `useSyncExternalStore`) exists only where the *structure*
  differs: `RoadmapChart` vs `RoadmapStacked`.
- Mobile-first CSS, `min-width` queries upward. Breakpoints: `sm` <640, `md` 640–1023,
  `lg` ≥1024.
- **State survives a breakpoint change** — selected node, editor contents, and active tab
  live in shared state or the URL.

### Area separation

- Public, onboarding, learner, and admin are **four separate areas** with separate layouts
  and separate code. The learner shell and admin shell are different components, and
  neither renders the other's navigation.
- **No cross-links** between `/app` and `/admin`.
- The admin area is **lazy-loaded**, so a learner's browser never downloads admin screens.
- Role comes from the `users` table, resolved from the session by the API, never from
  anything the browser can set. On log out, clear the TanStack Query cache.
- Guards render nothing while the session loads, so protected content never flashes.

### Data and types

- One `Roadmap` object drives both roadmap views, so they can never disagree.
- `RoadmapStep` is a **discriminated union** (`SkillStep | DecisionStep | MilestoneStep`)
  rendered with an exhaustive `switch` on `type`, so a new step type is a compile error
  until every node handles it (§13.3).
- Validate API and AI responses with Zod at the boundary, not just at the type level.

### Accessibility — target WCAG 2.2 AA

Text contrast 4.5:1 (3:1 for large text and UI components); touch targets at least
44 × 44px; a visible 2px focus outline everywhere; focus moves into panels and dialogs and
returns on close; the roadmap chart has an **equivalent nested-list DOM structure** with
arrow-key navigation; test results and AI feedback arrive in polite live regions; layouts
work at 200% zoom and reflow at 320px; `prefers-reduced-motion` is respected; no time
limits on placement or quizzes.

---

## 9. Voice and copy

The interface speaks like a **patient senior developer**: plain, specific, encouraging
without cheerleading.

- Sentence case for headings, buttons, and labels.
- **Buttons say what happens:** "Run tests", "Add to roadmap", "Download PDF" — never
  "Submit" or "OK". An action keeps its name through the flow: "Publish" becomes
  "Published".
- Name things the way learners do: "Tested out", not "assessment bypass".
- Errors explain and direct, without apologising or being vague.

| Situation | Not this | This |
|---|---|---|
| Failed test | "Wrong answer!" | "Expected 2, got 0. The first item in the list wasn't counted." |
| AI unavailable | "Oops! Something went wrong." | "Feedback isn't available right now. Your test results are below, and you can try feedback again in a minute." |
| Invalid form | "Invalid input" | "Enter weekly hours as a number between 1 and 40." |
| Locked module | "Locked" | "Pass JavaScript basics to unlock this module." |
| Empty state | "Nothing here" | "Choose a target job to build your first roadmap." |
| Publish success | "Success!" | "Version 3 of JavaScript basics published." |

---

## 10. Working agreements

### Git

**Never run a git command that writes.** No `commit`, `add`, `push`, `branch`, `tag`,
`reset`, `checkout`, `stash`, or `config`, and no `git mv` (it stages). Leave every change
in the working tree; the user reviews and commits. Read-only git (`status`, `log`, `diff`)
is fine.

### Before you call frontend work done

Run `npm run lint` and `npm run test`. **The `jsx-a11y` rules are errors, not warnings** —
`design.md` §12 commits to WCAG 2.2 AA and that document gets defended. Do not disable an
a11y rule to make a screen pass; fix the markup. `navigator.userAgent` is banned outright
(§13.5: layout follows viewport width, never the user agent).

Two things the tooling does *not* catch, so they need a human eye: an unlabelled raw
`<input>` (the rule only inspects `<label>` elements), and colour contrast (axe cannot
measure it under jsdom — contrast is checked against the token file separately).

### Endpoints

**Never add an endpoint without its ownership check and a test for it.** The API is the
only security boundary and it fails open, so an untested endpoint is an unproven one. The
evaluation plan (`docs/project-proposal.md` §9.2, Security Testing) commits to exactly
these tests.

### Changelog

**Update `docs/CHANGELOG.md` at the end of every task**, and tick off what you finished
in `docs/task-tracker.md`. One entry per task under
`[Unreleased]`, grouped Added / Changed / Fixed / Removed, written so someone who wasn't
here can follow what happened.

### Secrets

Never print, commit, or paste `.env`, `DATABASE_URL`, `SESSION_SECRET`, `WORKER_SECRET`, or
the GitHub App private key. `.env.example` is the only env file in the repo.

### Docs are the spec

Treat `docs/` as authoritative. When code and docs disagree, **say so** and ask which one
moves — do not silently pick. When you change behaviour the docs describe, update the doc
in the same task.

### Scope

Prefer extending `apps/worker` over adding a service. Do not scaffold, install, or
restructure beyond what was asked.

### Environment

Windows 11, **PowerShell** is the primary shell (`docs/model-setup-guide.md` uses it).
Node 20+. Ollama runs locally and must be started before the worker.

---

## 11. Open questions

Gaps in the specification, recorded rather than silently patched. Raise them before writing
code that depends on an answer.

1. **The SSE trigger is not in the documents.** `docs/database-schema.md` §8.2 step 5 and
   §8.3 step 5 promise server-sent events, but nothing says how the API learns the worker
   wrote a row, and there is no `pg_notify` in the schema. **Decided:** the worker posts to
   `/internal/events` with `WORKER_SECRET` and the API sweeps as a backstop. §8.2, §8.3,
   and the §9.3 environment list should be updated to say so.
2. **No email provider is specified.** §8.1 sends a verification email and §6.3 requires
   expiring reset links, but §9.3 step 5's environment variables include no mail
   configuration. A provider and key are needed (Resend's free tier is 3,000/month; Brevo
   300/day).
3. **`sameSite=none` is fragile.** §6.3 derives it from the app and API being on different
   domains, which makes it a third-party cookie — already blocked by Safari's ITP and
   increasingly restricted in Chrome. Hosting the API at `api.<domain>` alongside the app
   at `<domain>` makes it same-site and removes the problem. Decide before deploying.
4. **`users.role` is protected by convention only.** §5 relies on "no endpoint updates
   `users.role`"; an earlier draft had a database trigger. A trigger rejecting role changes
   would be cheap defense-in-depth for the table that controls the entire admin surface.
