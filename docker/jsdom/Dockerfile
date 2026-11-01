# =============================================================================
# The sandbox image for exercises that need a `document` (code_runtime = jsdom).
#
# One image, built once, with its dependency baked in. **Nothing can be
# installed at run time**: the container runs with `--network none`, a
# `--read-only` filesystem and no capabilities, so a `npm install` on first use
# is not merely slow, it is impossible. That is the point of the image.
#
# The program itself still arrives on **stdin**, exactly as the plain JavaScript
# runtime's does — no bind mount, no temporary file, no Windows path
# translation. A program read from stdin has no directory to resolve
# `node_modules` against, so `NODE_PATH` below is what makes `require("jsdom")`
# resolve. Without it the program fails with MODULE_NOT_FOUND and the learner
# reads a message about their own code.
#
# Build:   docker build -t first-commit/jsdom:1 docker/jsdom
# Verify:  npm run sandbox:check          (from apps/worker)
#
# The tag is pinned in the image, not latest, so rebuilding the image cannot
# silently change what a learner's submission ran against — the same reason
# `ai_prompts` records a version on every job.
# =============================================================================
FROM node:20-alpine

# Installed as root, into a path the sandbox user can only read.
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund \
 && npm cache clean --force \
 # The sandbox runs as 1000:1000 with a read-only root. Nothing here should be
 # writable by it: a learner who could write into node_modules would change what
 # the next submission runs.
 && chmod -R a-w /app

# What makes `require("jsdom")` resolve for a program with no file of its own.
ENV NODE_PATH=/app/node_modules

# `node:20-alpine` already has a uid 1000 (`node`). Stated here so the image is
# usable without `--user`, while the runner still passes it explicitly.
USER 1000:1000

# No ENTRYPOINT and no CMD on purpose: the runner supplies the whole command,
# `timeout -s KILL <seconds> node`, so the time limit is the first thing in the
# process tree rather than something the image could override.
