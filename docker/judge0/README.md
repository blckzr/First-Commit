# Judge0 — the code sandbox

Judge0 runs a learner's submitted code. It is the sandbox named in
[`project-proposal.md`](../../docs/project-proposal.md) §8 and
[`database-schema.md`](../../docs/database-schema.md) §1 and §8, and until it is running,
`CODE_RUNNER=none` makes every submission fail with an explanation rather than queue
forever.

**Why a sandbox at all:** the worker process holds `DATABASE_URL` and `WORKER_SECRET`.
Learner code running inside that process could read `process.env` and print your credentials
into its own test output — which the worker writes to `code_submissions.test_results`, which
`GET /submissions/:id` serves, which §5.11's screen renders. That chain is built and tested.
The sandbox is the wall across it. See `apps/worker/src/runner.ts`.

It runs **on your machine**, beside Ollama. Nothing on the internet needs to reach it, which
is the same reason the worker pulls jobs rather than listening for them.

---

## Judge0 does not run on Docker Desktop for Windows

**Measured on this machine, 2026-09-25.** Judge0 sandboxes with `isolate`, which speaks
**cgroup v1 only**. The WSL 2 VM that Docker Desktop runs its daemon in is **cgroup v2
unified**, and it will not hand out a v1 hierarchy even to a privileged container:

```
$ docker run --rm --privileged alpine sh -c "mount -t cgroup -o memory cgroup /tmp/cg"
mount: mounting cgroup on /tmp/cg failed: Invalid argument
```

`/proc/filesystems` does list `cgroup` alongside `cgroup2`, so v1 is compiled in — but every
controller is bound to the v2 hierarchy, which is what makes a v1 mount fail with `EINVAL`.

**The `systemd.unified_cgroup_hierarchy=0` kernel flag does not fix this**, and an earlier
version of this guide was wrong to say it would. That flag is read by **systemd**, and the
`docker-desktop` WSL distro does not run systemd, so nothing there acts on it. Judge0's own
notes give it as an *Ubuntu* instruction, where systemd is init; it does not transfer.

This is [judge0/judge0#583](https://github.com/judge0/judge0/issues/583), open with no fix,
and [#549](https://github.com/judge0/judge0/issues/549) before it.

### What Judge0 needs instead

| Path | Works? | Cost |
|---|---|---|
| **Linux VM** (Hyper-V), Ubuntu 22.04 with the GRUB flag | Yes — Judge0's documented environment | A full VM: ~4 GB RAM, ~20 GB disk |
| **Judge0 Cloud / RapidAPI** | Yes | Learner code leaves the machine; API key; rate limits |
| **A plain-container runner instead of Judge0** | Yes, on what is already installed | Not what `project-proposal.md` §8 names |
| Docker Desktop + WSL 2 | **No** | — |

`Judge0Runner` is finished and tested either way: it talks to a Judge0 over HTTP and does not
care where that Judge0 lives. Only `JUDGE0_URL` changes.

**The steps below assume you have solved the above.** In a Hyper-V Ubuntu VM, run steps 3–5
inside the VM and point `JUDGE0_URL` at its IP rather than `127.0.0.1`.

---

## What you need

| | |
|---|---|
| **Windows 11** with virtualization enabled in firmware | Already true on this machine — checked |
| **WSL 2** | Not installed yet — step 1 |
| **Docker Desktop** | Not installed yet — step 2 |
| **~8 GB disk, ~2 GB RAM while running** | 64 GB free, 31 GB RAM — fine |

Judge0 is Linux-only software, so on Windows it runs inside WSL 2. That is what Docker
Desktop's default backend already uses.

---

## 1. Install WSL 2

In an **Administrator** PowerShell:

```powershell
wsl --install
```

Then **reboot**. After the reboot, confirm:

```powershell
wsl --status
```

## 2. Install Docker Desktop

```powershell
winget install --id Docker.DockerDesktop --accept-package-agreements --accept-source-agreements
```

Start it. **There is no "Use the WSL 2 based engine" setting to tick** — recent Docker
Desktop removed the Hyper-V backend, so WSL 2 is the only one and the toggle is gone.
Confirm from a normal terminal:

```powershell
docker --version
docker compose version
wsl --list --verbose   # docker-desktop should read VERSION 2
```

## 3. Get Judge0

Use **v1.13.1**, not v1.13.0. v1.13.1 is a security release fixing three critical
vulnerabilities (CVE-2024-28185, CVE-2024-28189, CVE-2024-29021), and most tutorials still
point at v1.13.0.

```powershell
cd $HOME
Invoke-WebRequest -Uri https://github.com/judge0/judge0/releases/download/v1.13.1/judge0-v1.13.1.zip -OutFile judge0-v1.13.1.zip
Expand-Archive judge0-v1.13.1.zip -DestinationPath .
cd judge0-v1.13.1
```

**It is not cloned into this repo on purpose.** It is third-party infrastructure with its own
release cycle and its own `docker-compose.yml`; vendoring it would mean maintaining a fork of
somebody else's security-sensitive software. This folder holds only what is ours — the
`.wslconfig` line and this guide.

## 4. Set its passwords

Open `judge0.conf` and fill in two blanks:

```ini
REDIS_PASSWORD=<paste a long random string>
POSTGRES_PASSWORD=<paste a different long random string>
```

Generate them however you like — `-join ((48..57) + (97..122) | Get-Random -Count 40 | % {[char]$_})`
in PowerShell will do.

Two more lines worth setting while you are in there:

```ini
# Judge0 phones home by default. This is a personal project; turn it off.
DISABLE_TELEMETRY=true
```

Leave `AUTHN_TOKEN` empty. It only matters if the API is reachable from outside this machine,
and it should not be — see *Keep it local* below.

## 5. Start it

The order matters: the database and Redis have to be accepting connections before the server
and workers try to use them.

```powershell
docker compose up -d db redis
Start-Sleep -Seconds 10
docker compose up -d
Start-Sleep -Seconds 5
docker compose ps
```

All four services (`server`, `workers`, `db`, `redis`) should read `running`.

## 6. Prove it works

From this repo:

```powershell
npm run judge0:check
```

That checks four things in order, and tells you which one broke:

1. Judge0 answers, and on which version
2. Which language runtimes it actually offers, with their ids
3. A trivial program runs and its output comes back — **this is the cgroup check**
4. The seeded exercise runs end to end through `Judge0Runner`

Step 4 should report **3 of 5 passing**. That is correct, and worth understanding: the
seeded starter carries §5.11's own bug, a loop starting at index 1, so it drops whatever is
first. `[2, 4, 6]` totals 10 instead of 12, and `[2, 1]` totals 0 instead of 2 — which is
§5.11's own "Expected 2, got 0". The other three pass *despite* the bug, because the first
item happens not to matter for them.

**Five of five passing is a failure**, not good news: it means the harness is not running the
assertions.

## 7. Turn it on

In `apps/worker/.env`:

```ini
CODE_RUNNER=judge0
JUDGE0_URL=http://127.0.0.1:2358
```

Restart the worker (`npm run worker`). Submit the exercise at `/app/exercise/:id` and the
results panel fills in from a real run — and a full pass writes a `module_completions` row,
which is the first time a coding exercise produces evidence.

`127.0.0.1` rather than `localhost`: on Windows `localhost` can resolve to `::1` first, and
Judge0 publishes on IPv4.

---

## Keep it local

**Do not expose port 2358.** An open Judge0 is a service that runs arbitrary code for
anyone who finds it. Specifically:

- No port forwarding, no tunnel, no reverse proxy to it.
- It does not need to be reachable from the internet. The worker runs on the same machine,
  and the worker is the only thing that talks to it.
- `enable_network: false` is set on every submission the worker sends, so a learner's code
  cannot reach your network or the internet from inside the container.
- Per-submission limits come from `JUDGE0_CPU_SECONDS` and `JUDGE0_MEMORY_KB`. They are tight
  on purpose: this machine also holds a model in VRAM, and the worker runs one job at a time.

## When something is wrong

| What you see | Almost always |
|---|---|
| `judge0:check` says not reachable | Stack is down. `docker compose ps` in `judge0-v1.13.1` |
| Every submission is an internal error | **cgroup v2** — see the warning at the top. Not fixable on Docker Desktop |
| `workers` container restarts in a loop | Same cgroup problem — check `docker compose logs workers` |
| `db` or `redis` unhealthy | Passwords not set in `judge0.conf`, or step 5 was run in one go without the waits |
| Submissions hang as `queued` in Judge0 | `workers` is not running |
| `judge0:check` reports 5 of 5 passing | The harness is not running the assertions — a bug in `src/judge0/harness.ts`, not good news |
| `judge0:check` reports some other count | Same place. It should be 3 of 5, failing cases 1 and 3 |
| A learner sees "the code runner isn't responding" | Expected when Judge0 is down. Their files are saved; the message says so |

## Turning it off again

```powershell
docker compose down
```

Set `CODE_RUNNER=none` in `apps/worker/.env`. Submissions then fail with an explanation
rather than waiting on a service that is not there. **Nothing is lost** — a learner's files
are in `code_submissions` before the runner is ever called, and their existing completions
stand.

---

## What is ours and what is Judge0's

| Ours | Where |
|---|---|
| The `Runner` interface every submission goes through | `apps/worker/src/runner.ts` |
| The Judge0 client, and reading its results | `apps/worker/src/judge0/index.ts` |
| Compiling test cases into one program | `apps/worker/src/judge0/harness.ts` |
| `npm run judge0:check` | `apps/worker/src/judge0/check.ts` |
| This guide, and `.wslconfig` | `docker/judge0/` |

Judge0's own `docker-compose.yml`, `judge0.conf`, and images stay in the release folder you
unzipped. We do not modify them.

**Judge0 does not cover React and Vue.** Those need a component test run — Vitest with jsdom
and a `node_modules` tree — which Judge0 has not got. `Judge0Runner.supports()` returns false
for them, so the worker records an honest error instead of reporting a syntax error as the
learner's fault. That runner is a separate piece of work, tracked in
[`task-tracker.md`](../../docs/task-tracker.md).
