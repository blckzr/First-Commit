# First Commit

An AI-assisted online learning platform for aspiring programmers. It guides a learner from
their first lesson to a job-ready portfolio: a personalized roadmap, hands-on practice with
beginner-friendly feedback, a capstone project built on the learner's own GitHub,
verifiable certificates, and an ATS-friendly resume built only from verified evidence.

Three AI components — **Roadmap AI**, **Code Review AI**, and **Resume AI** — all run on a
single open-weight model (Qwen3.5) hosted locally through Ollama, so there are no API costs
and learner code never leaves the project's own machine.

---

## Repository

```
docs/                  The specification, task tracker, and changelog
supabase/migrations/   Database schema (PostgreSQL)
apps/api/              Express API: sessions, auth, rate limiting, SSE
apps/web/              React + TypeScript app
apps/worker/           Local AI worker: job queue → Ollama → validated JSON
packages/              Reserved for shared types
AGENT.md               Working contract for AI agents on this project
```

## Documents

| Document | Read it for |
|---|---|
| [Project proposal](docs/project-proposal.md) | What the platform is, scope and limits, learning structure, the three AI components, certificates, module versioning, evaluation plan |
| [UI/UX design](docs/design.md) | Every screen, design tokens, components, status system, copy rules, frontend implementation |
| [Database schema](docs/database-schema.md) | Architecture, tables, the backend security checklist, database functions, hosting |
| [Model setup guide](docs/model-setup-guide.md) | Installing Ollama, tuning for an 8GB GPU, running the worker, choosing between 4B and 9B |
| [Task tracker](docs/task-tracker.md) | What is planned and what is done, phase by phase |
| [Changelog](docs/CHANGELOG.md) | What changed, dated, task by task |

## Architecture in one paragraph

The React app talks only to an **Express API** deployed on Render; the browser never
connects to the database, so every permission check lives in one place. The API owns
sessions, business rules, GitHub webhooks, and certificate issuance, and reads and writes
**PostgreSQL** hosted on Supabase. A **local worker** claims jobs from the `ai_jobs` queue,
runs code in Judge0 and prompts through Ollama on the project's own GPU, validates every
response against a Zod schema, and writes the results back — then notifies the API, which
pushes them to the browser over **server-sent events**. The worker only makes outgoing
connections, so nothing on the internet needs to reach the machine with the GPU.

Full picture: [`docs/database-schema.md`](docs/database-schema.md) §1.

## Getting started

Prerequisites: Node 20+, an NVIDIA GPU with 8GB VRAM for the model, and a PostgreSQL
database (Supabase free plan is fine).

```powershell
npm install          # installs every workspace
```

Then follow [`docs/model-setup-guide.md`](docs/model-setup-guide.md) to install Ollama,
pull the model, configure it for an 8GB GPU, and run:

```powershell
npm run check         # verify Ollama and pick the JSON mode for this machine
npm run try:feedback  # try the Code Review AI on a sample exercise
npm run worker        # process jobs from the database
```

### Database

Create a Supabase project, put its connection string in `apps/api/.env`, then:

```powershell
npm run db:migrate    # applies supabase/migrations in order, once each
npm run db:verify     # proves the functions and triggers actually run
npm run db:seed       # loads the Junior Web Developer curriculum
npm run db:accounts   # creates the development sign-in accounts
```

`db:seed` loads `supabase/seed/` — a career path, 2 tracks, 8 skills, 19 modules with
prerequisites, 9 lessons and 3 quizzes. Until the admin content editor exists, that
directory is what "an admin defined" means, and the loader validates it (prerequisite
cycles, dangling references, answer keys out of range) before writing anything.

`db:accounts` is **the only sanctioned way to make an admin** — no endpoint updates
`users.role` (AGENT.md §6 rule 8), and sign-up always creates a learner. It also takes
`reset` to put the development learners back to their first day.

The rest — storage buckets, Render — is in
[`docs/database-schema.md`](docs/database-schema.md) §9.3.

### Running it

Three terminals:

```powershell
npm run dev:api   # Express on :4000
npm run dev       # Vite on :5173
npm run worker    # claims AI jobs; needs Ollama running
```

Sign in at `http://localhost:5173/login` with an account from `db:accounts`.

### Environment

| Variable | Used by | What it is |
|---|---|---|
| `DATABASE_URL` | API, worker | Connection string. The API uses the **transaction pooler** (6543); the worker uses **session mode** (5432). On Supabase both are the pooler host — not `db.<project-ref>.supabase.co`, which is IPv6-only. |
| `SESSION_SECRET` | API | Signs session cookies |
| `APP_ORIGIN` | API | The frontend's URL, for CORS and cookies |
| `WORKER_SECRET`, `API_URL` | API, worker | Shared secret and address so the worker can tell the API a result is ready. Optional — without them results are still written, and the API's periodic sweep finds them a few seconds later. |
| `AI_MODEL`, `AI_JSON_MODE`, `AI_CONTEXT` | worker | Which model, which JSON mode, how much context. `AI_JSON_MODE` is decided by `npm run check` **on your machine**, not by assumption. |
| GitHub App id, webhook secret, private key | API | Capstone tracking |
| `BREVO_API_KEY`, `MAIL_FROM`, `MAIL_FROM_NAME` | API | Brevo, for verification and reset links. Leave the key unset in development and links are logged to the console instead. |

> **Never commit `.env`.** The connection string and secrets belong to the API and the
> worker only, never to the React app.

## Status

**The learner path runs end to end**, against a live database: sign up → verify → log in →
onboarding → the Roadmap AI plans a roadmap → the roadmap chart → a module → lessons → a
quiz → passing moves "You are here" and unlocks what is next → the technology decision adds
that framework's modules.

| Phase | State |
|---|---|
| **0 — Foundation** | Done |
| **1 — Backend** | Auth, sessions, rate limiting, the §6.1 middleware and SSE, every security-critical path mutation-tested. Remaining: the §9.2 security tests, and Render (blocked on the API domain decision in [`AGENT.md`](AGENT.md) §11) |
| **1.5 — Design system** | Done. Tokens plus 15 components, both shells, a contrast gate that reads `tokens.css` from disk |
| **2 — Learner core** | Home, onboarding, roadmap chart, module page, quiz and the technology choice all on the real API. Remaining: the coding exercise, My roadmaps, Explore, Settings, Notifications |
| **3 — AI components** | `code_feedback` and `roadmap_generation` work. `technology_recommendation`, `roadmap_adaptation`, `milestone_review` and `resume_generation` are stubs with schemas written |
| **4 — Capstone, certificates** | Not started |
| **5 — Resume, admin** | Not started. Admin Overview is the last screen still on mock data |

Roughly 530 tests: the API's run against an in-memory PostgreSQL built from the real
migration, the web's against the API stubbed at the network boundary, plus 152 Playwright
tests at the four widths §11.4 names. **Security-critical code is mutation-tested** —
introduce the vulnerability, confirm a test catches it, revert — which has repeatedly found
tests that were asserting the wrong thing.

See [`docs/task-tracker.md`](docs/task-tracker.md) for what is next, and
[`docs/CHANGELOG.md`](docs/CHANGELOG.md) for what happened.

---

A personal project.
