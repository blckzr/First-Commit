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
apps/api/              Express API (not scaffolded yet)
apps/web/              React + TypeScript app (not scaffolded yet)
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

Database setup — creating the project, applying
[`supabase/migrations/0001_initial_schema.sql`](supabase/migrations/0001_initial_schema.sql),
creating storage buckets, deploying the API to Render, and making the first admin — is in
[`docs/database-schema.md`](docs/database-schema.md) §9.3.

### Environment

| Variable | Used by | What it is |
|---|---|---|
| `DATABASE_URL` | API, worker | Connection string. The API uses the pooler (6543); the worker uses a direct connection (5432). |
| `SESSION_SECRET` | API | Signs session cookies |
| `APP_ORIGIN` | API | The frontend's URL, for CORS and cookies |
| `WORKER_SECRET` | API, worker | Shared secret so the worker can tell the API a result is ready |
| GitHub App id, webhook secret, private key | API | Capstone tracking |
| Email provider key | API | Verification and password-reset links (provider not yet chosen — see `AGENT.md` §11) |

> **Never commit `.env`.** The connection string and secrets belong to the API and the
> worker only, never to the React app.

## Status

Planning documents and the database schema are complete. The AI worker implements the Code
Review AI (`code_feedback`); the roadmap, milestone review, and resume job types are stubs
with their output schemas already defined — and the worker still uses the Supabase client
library, so porting it to `pg` is the next task. The Express API and the React app have not
been scaffolded yet.

Next up is porting the worker to `pg`, then scaffolding the API and the web app — see
[`docs/task-tracker.md`](docs/task-tracker.md). Four open questions in the specification
are tracked in [`AGENT.md`](AGENT.md) §11 and in the tracker's "Decide" section.

---

Undergraduate thesis project.
