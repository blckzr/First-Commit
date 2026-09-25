# The code sandbox

A learner's submitted code runs in a **throwaway Docker container, one per
submission** (`apps/worker/src/sandbox/docker.ts`). This is the sandbox in use.

**Why a sandbox at all:** the worker process holds `DATABASE_URL` and `WORKER_SECRET`.
Learner code running inside that process could read `process.env` and print your credentials
into its own test output — which the worker writes to `code_submissions.test_results`, which
`GET /submissions/:id` serves, which §5.11's screen renders. That chain is built and tested.
The sandbox is the wall across it.

**Why not Judge0**, which `project-proposal.md` §8 names: it needs cgroup v1 and this machine
cannot provide it. Measured, with the alternatives, in [`judge0/README.md`](judge0/README.md).
`Judge0Runner` is kept and kept tested — it works unchanged on a Linux host, and swapping is
one environment variable.

---

## Setup

Docker Desktop, already installed. Then:

```powershell
docker pull node:20-alpine
docker pull python:3.12-alpine    # only when a Python exercise exists
npm run sandbox:check
```

Then in `apps/worker/.env`:

```ini
CODE_RUNNER=docker
```

Restart the worker. That is the whole setup — there is no service to run and nothing
listening, because a container is started per submission and thrown away.

## What `npm run sandbox:check` proves

The same relationship `npm run check` has with Ollama: this guide says what should be true,
the script says what *is* true on this machine.

| Step | Catches |
|---|---|
| The runtimes it accepts | A runner claiming React or Vue, which neither sandbox can do |
| The seeded exercise, end to end | A harness that is not running the assertions |
| A program that never finishes | A sandbox that cannot stop a runaway loop |

The exercise should report **3 of 5 passing**. That is correct: the seeded starter carries
§5.11's own bug, a loop starting at index 1, so it drops whatever is first. `[2, 4, 6]` totals
10 instead of 12, and `[2, 1]` totals 0 instead of 2 — §5.11's own "Expected 2, got 0". The
other three pass *despite* the bug.

**Five of five is a failure, not good news:** it means the assertions are not running.

## The isolation

Every flag was verified against a real container before being written down. `containerArgs()`
is exported from `sandbox/docker.ts` so a unit test asserts each one is still there — dropping
one is otherwise silent.

| Flag | Stops | Verified |
|---|---|---|
| `--init` | A loop that never ends | Without it, `timeout` is PID 1 and does nothing — an infinite loop ran **631s** |
| `--network none` | Fetching an answer; reaching this machine | DNS fails with `EAI_AGAIN` |
| `--memory` = `--memory-swap` | Growing forever, and swapping around the cap | `memory.max` 134217728, `memory.swap.max` 0 |
| `--cpus` | Pinning the host while a model is loaded | `cpu.max` 100000 100000 |
| `--pids-limit` | Fork bombs | `pids.max` 64 |
| `--read-only` + `noexec` tmpfs | Writing anywhere but scratch; running from scratch | Writing `/evil.txt` fails `EROFS` |
| `--cap-drop ALL`, `no-new-privileges` | Privilege escalation inside the container | — |
| `--user 1000:1000` | Running as root | `uid 1000` |
| `--rm`, fresh each time | One run affecting the next | — |

**The timeout is enforced twice:** `timeout -s KILL` inside the container, and the worker
killing the container if that fails. The inner one failing silently is exactly the bug that
was found here, so the outer one is not redundant.

## How an exercise becomes a program

Judge0 and this runner both take **one source file**. Our exercises hold an assertion per
case (`expect(sumEven([2, 4, 6])).toBe(12)`) and §5.11 shows a per-case tick with an expected
and an actual. So `sandbox/harness.ts` compiles the cases **into** the program: the learner's
files, a minimal `expect`, then each case wrapped so it reports itself as a line of JSON.

**The program goes in on stdin.** `node` and `python3 -` both read a program from stdin, which
means no temporary file and no bind mount — and therefore no Windows path translation, the
part of Docker-on-Windows most likely to break.

Three consequences worth knowing:

- **The program always exits 0.** A case's outcome is data, not an exit code — §5.11 shows the
  whole list, not the first thing that broke.
- **A case that reports nothing is a failure.** Code that exits early or deletes the
  assertions fails the exercise. `sandbox/results.ts` owns that rule, both sandboxes use it,
  and it is mutation-tested.
- **No database id or case name goes into the source.** The learner's code shares stdout with
  the results, so it could print a forged result line — it just has nothing real to attach it
  to, and the first line for a case wins.

Read the generated program for yourself:

```powershell
npm run sandbox:check -w @first-commit/worker -- source     # prints it
```

## What it does not cover

**React and Vue.** They need a component test run — Vitest with jsdom and a `node_modules`
tree — which neither sandbox provides. `supports()` returns false, so the worker records an
honest error instead of sending a component test to a bare runtime and reporting the resulting
syntax error as the learner's fault. A container image with those dependencies baked in is the
natural shape for it; tracked in [`task-tracker.md`](../docs/task-tracker.md).

## When something is wrong

| What you see | Almost always |
|---|---|
| `spawn docker ENOENT` | **A terminal older than the Docker install.** `docker` works when you type it but fails when npm spawns it, because the shell's PATH was captured before Docker Desktop added itself. Close the terminal and open a new one. `sandbox:check` now says this for you |
| "The code runner isn't available right now" | Docker Desktop is not running, or the above. The learner's files are saved and the message says so |
| Every submission is `error` with "No sandbox is configured" | `CODE_RUNNER` is still `none` |
| `CODE_RUNNER is "…", which is not a runner` | Typo. Use `docker`, `judge0`, or `none` — it throws rather than silently falling back to no sandbox |
| `sandbox:check` reports 5 of 5 passing | The assertions are not running — a bug in `sandbox/harness.ts` |
| A loop that never ends is not stopped | `--init` is missing from `containerArgs()` |
| First submission after a restart is slow | Docker is pulling or starting the image. Pre-pull it |

## Turning it off

Set `CODE_RUNNER=none`. Submissions then fail with an explanation rather than waiting on
something that is not there. **Nothing is lost** — a learner's files are in `code_submissions`
before the runner is ever called, and existing completions stand.
