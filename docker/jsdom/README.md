# The jsdom sandbox image

The image for exercises whose `code_runtime` is `jsdom` — ones that need a real
`document`. Added by migration `0004_jsdom_runtime.sql`.

## Build it

```powershell
docker build -t first-commit/jsdom:1 docker/jsdom
```

Then prove it on this machine:

```powershell
cd apps/worker
npm run sandbox:check      # includes a DOM probe: a page, a query, a change
npm run exercises:check    # every seeded exercise through the real sandbox
```

`sandbox:check` is the measurement that decides whether this runtime works here,
in the same way `npm run check` decides `AI_JSON_MODE`. The unit tests prove the
program is *generated* correctly; only a container proves it *runs*.

## Why the dependency is baked in

The container runs with `--network none`, a `--read-only` filesystem, no
capabilities and as uid 1000. Installing jsdom at run time is not slow, it is
impossible — which is the point. `npm install` happens once, at build time, as
root, into a path the sandbox user can only read.

## Why `NODE_PATH`

The program still arrives on **stdin**, exactly as the plain JavaScript
runtime's does: no bind mount, no temporary file, and no Windows path
translation, which is the part of Docker-on-Windows most likely to break. A
program read from stdin has no directory to resolve `node_modules` against, so
`NODE_PATH=/app/node_modules` is what makes `require("jsdom")` work. Without it
the run fails with `MODULE_NOT_FOUND` and the learner reads a message about
their own code.

The runner passes the same variable explicitly as well. The flag list is the
security boundary, and reading it should not require reading this file to know
the program can find its dependency.

## Why the tag is a version

`first-commit/jsdom:1`, not `latest`. Rebuilding must not silently change what a
learner's submission ran against — the same reason `ai_prompts` records a
version on every job. A change that alters behaviour gets tag `2` and a note
here.

## It exists on no registry

So a missing image is not a transient pull failure; it means nobody ran the
build. `DockerRunner.isImageMissing()` recognises Docker's own wording for that
and turns it into an operator message naming this directory, instead of handing
the learner a sentence about pull access to a repository.

## React and Vue

Not supported yet, and the gap is not the DOM. A component test also needs JSX
or SFC compilation and a render call — a harness of its own, against a content
contract no seeded exercise exercises. This image is where their dependencies
will go when that is built; `DockerRunner.supports()` refuses them until then,
so the worker records an honest error.
