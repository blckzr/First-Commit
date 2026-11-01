import { describe, expect, it } from "vitest";
import { domSource, splitDomFiles, DOM_MATCHERS } from "./dom-harness.js";
import { buildHarness, RESULT_MARKER, UnsupportedRuntime } from "./harness.js";
import { containerArgs, DOCKER_RUNTIMES, isImageMissing } from "./docker.js";
import { DockerRunner } from "./docker.js";

/**
 * The `jsdom` runtime (migration 0004).
 *
 * **What these tests can and cannot prove.** Generating the program is a pure
 * function, so everything about its *shape* is tested here: the page, the
 * ordering, the escaping, the flags, the refusals. Whether the generated program
 * actually runs is a question about a container, and it belongs to
 * `npm run sandbox:check`, which measures it on this machine — the same
 * relationship `AI_JSON_MODE` has with `npm run check`. Nothing here should be
 * read as evidence that a DOM exercise passes.
 */

const oneCase = [{ id: "c1", name: "finds the heading", code: "expect(1).toBe(1);", visible: true }];

describe("which file is the page", () => {
  it("uses the exercise's .html fixture as the document", () => {
    const { page, scripts } = splitDomFiles(
      [{ path: "src/app.js", content: "// code" }],
      [{ path: "index.html", content: "<!doctype html><body><h1>Tasks</h1></body>" }],
    );

    expect(page).toContain("<h1>Tasks</h1>");
    expect(scripts.map((f) => f.path)).toEqual(["src/app.js"]);
  });

  it("accepts .htm, and does not treat it as code", () => {
    const { page, scripts } = splitDomFiles([], [{ path: "page.htm", content: "<body>hi</body>" }]);

    expect(page).toContain("hi");
    expect(scripts).toEqual([]);
  });

  /** An author's `.HTML` would otherwise be concatenated into the program. */
  it("matches the extension case-insensitively", () => {
    const { scripts } = splitDomFiles([{ path: "Page.HTML", content: "<body></body>" }], []);
    expect(scripts).toEqual([]);
  });

  /**
   * An exercise that builds its own nodes supplies no page. An empty body is
   * right for it — not an error.
   */
  it("falls back to an empty body", () => {
    const { page } = splitDomFiles([{ path: "src/app.js", content: "// code" }], []);

    expect(page).toContain("<body></body>");
  });
});

/**
 * **The trust boundary, and the reason `fixtures` exists.**
 *
 * The markup a DOM assertion measures against is part of the exercise, not part
 * of the answer. If it came from the submission, "shows 2 tasks" would be
 * passable by typing `<p id="count">2 tasks</p>` into the page and writing no
 * code — the browser deciding its own result, which is what §6 rule 4 forbids.
 */
describe("a learner cannot supply the page", () => {
  const theirs = {
    path: "index.html",
    content: '<body><p id="count">2 tasks</p></body>',
  };
  const exercises = { path: "index.html", content: "<body><p id=\"count\"></p></body>" };

  it("ignores a learner's .html and uses the exercise's", () => {
    const { page } = splitDomFiles([theirs], [exercises]);

    expect(page).toBe(exercises.content);
    expect(page).not.toContain("2 tasks");
  });

  /** Not rendered, and not concatenated into the program either. */
  it("does not run a learner's .html as code", () => {
    const { scripts } = splitDomFiles([theirs, { path: "app.js", content: "// code" }], [exercises]);

    expect(scripts.map((f) => f.path)).toEqual(["app.js"]);
  });

  /**
   * With no fixture, an empty body — **not** the learner's page. An exercise
   * that forgot its markup must fail honestly rather than hand the learner
   * control of what the assertions read.
   */
  it("falls back to an empty body rather than to the learner's page", () => {
    const { page } = splitDomFiles([theirs], []);

    expect(page).not.toContain("2 tasks");
    expect(page).toContain("<body></body>");
  });

  it("keeps the learner's page out of the generated program entirely", () => {
    const source = domSource({
      files: [theirs],
      fixtures: [exercises],
      cases: oneCase,
    });

    expect(source).not.toContain("2 tasks");
  });
});

describe("the generated program", () => {
  it("builds a document before the learner's code runs", () => {
    const source = domSource({
      files: [{ path: "src/app.js", content: "var marker = 1;" }],
      cases: oneCase,
    });

    expect(source.indexOf("new __fcJsdom.JSDOM")).toBeLessThan(source.indexOf("var marker = 1;"));
  });

  it("runs the learner's code before the assertions", () => {
    const source = domSource({
      files: [{ path: "src/app.js", content: "var marker = 1;" }],
      cases: oneCase,
    });

    expect(source.indexOf("var marker = 1;")).toBeLessThan(source.indexOf("run(0,"));
  });

  /**
   * **A fixture must not be able to end the string it is injected into.** The
   * page is a JSON literal, so a quote, a backslash or a line break in an
   * author's markup is data. Interpolating it raw would let a fixture containing
   * `");` append statements to the program.
   */
  it("escapes the page rather than interpolating it", () => {
    const source = domSource({
      files: [],
      fixtures: [
        {
          path: "index.html",
          content: '<body data-x="\\" onload="require(\'child_process\')"></body>',
        },
      ],
      cases: oneCase,
    });

    // The whole page sits inside one JSON string argument.
    const literal = /new __fcJsdom\.JSDOM\((".*?"), \{/.exec(source);
    expect(literal).not.toBeNull();
    expect(JSON.parse(literal![1])).toContain("child_process");
  });

  /**
   * jsdom will execute `<script>` tags in the markup if asked. The learner's
   * file is the only script that should run, and it runs because the platform
   * concatenated it — not because a page asked for it.
   */
  it("does not let the page run its own scripts", () => {
    const source = domSource({ files: [], cases: oneCase });

    expect(source).not.toContain("runScripts");
  });

  /**
   * **Every case starts from the exercise's page.**
   *
   * All cases run in one program against one document, so a case that empties a
   * list would otherwise change what every later case sees. `exercises:check`
   * caught exactly that against a real container: a correct reference solution
   * failed its last case because an earlier one had left one item behind.
   *
   * A learner whose case 7 fails because of case 5 is reading a result that is
   * not about their code, which is the opposite of what §5.11 promises.
   */
  it("restores the page before every case", () => {
    const source = domSource({
      files: [],
      fixtures: [{ path: "index.html", content: "<body><ul id='tasks'><li>a</li></ul></body>" }],
      cases: oneCase,
    });

    expect(source).toContain("__fcResetPage()");
    // Captured once, before the learner's file can change anything.
    expect(source.indexOf("__fcOriginalPage =")).toBeLessThan(source.indexOf("function run("));
  });

  it("resets before the case body, not after", () => {
    const source = domSource({ files: [], fixtures: [], cases: oneCase });
    const run = source.slice(source.indexOf("function run("));

    expect(run.indexOf("__fcResetPage()")).toBeLessThan(run.indexOf("body()"));
  });

  it("prints one marker line per case", () => {
    const source = domSource({
      files: [],
      cases: [
        { id: "a", name: "one", code: "expect(1).toBe(1);", visible: true },
        { id: "b", name: "two", code: "expect(2).toBe(2);", visible: false },
      ],
    });

    expect(source).toContain("run(0,");
    expect(source).toContain("run(1,");
    expect(source).toContain(RESULT_MARKER);
  });

  /**
   * AGENT.md: "No database id or case name goes into the generated program."
   * The learner's code runs in that container and can read it, so a hidden
   * case's name there is a §6 rule 2 leak.
   */
  it("puts no database id or case name in the program", () => {
    const source = domSource({
      files: [],
      cases: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          name: "the hidden case nobody may read",
          code: "expect(1).toBe(1);",
          visible: false,
        },
      ],
    });

    expect(source).not.toContain("11111111-1111-4111-8111-111111111111");
    expect(source).not.toContain("the hidden case nobody may read");
  });
});

describe("buildHarness", () => {
  it("builds a jsdom harness and keeps the hidden flag", () => {
    const harness = buildHarness({
      runtime: "jsdom",
      files: [],
      fixtures: [{ path: "index.html", content: "<body></body>" }],
      cases: [
        { id: "a", name: "visible", code: "expect(1).toBe(1);", visible: true },
        { id: "b", name: "hidden", code: "expect(2).toBe(2);", visible: false },
      ],
    });

    expect(harness.source).toContain("new __fcJsdom.JSDOM");
    // `redact()` in submissions.ts keys on this; it was dropped once already.
    expect(harness.cases.map((c) => c.hidden)).toEqual([false, true]);
    expect(harness.cases.map((c) => c.id)).toEqual(["a", "b"]);
  });

  /**
   * `react` and `vue` have their own harness now (§13.4, `component-harness.ts`).
   * A runtime with no harness still throws, which is what makes the worker
   * record an honest error rather than blaming the result on the learner.
   */
  it("still refuses a runtime with no harness", () => {
    for (const runtime of ["ruby", "svelte"]) {
      expect(() => buildHarness({ runtime, files: [], cases: [] })).toThrow(UnsupportedRuntime);
    }
  });
});

describe("the container", () => {
  it("runs the locally built image for jsdom", () => {
    const args = containerArgs("jsdom", "fc-run-test", 5);

    // Tag 2 adds React and Vue, which §13.4's component runtimes share.
    expect(args).toContain("first-commit/jsdom:2");
  });

  /**
   * A program read from stdin has no directory, so it cannot resolve
   * `node_modules`. Without this, `require("jsdom")` is MODULE_NOT_FOUND and the
   * learner reads a message about their own code.
   */
  it("sets NODE_PATH so a stdin program can require jsdom", () => {
    const args = containerArgs("jsdom", "fc-run-test", 5);

    expect(args.join(" ")).toContain("--env NODE_PATH=/app/node_modules");
  });

  it("sets NODE_PATH for nothing else", () => {
    for (const runtime of ["javascript", "python"]) {
      expect(containerArgs(runtime, "fc-run-test", 5).join(" ")).not.toContain("NODE_PATH");
    }
  });

  /**
   * **The flags are the security boundary**, and a new runtime must not acquire
   * a weaker container by having been added in a different place. Every limit
   * the JavaScript runtime gets, this one gets.
   */
  it("gives jsdom every isolation flag the other runtimes get", () => {
    const args = containerArgs("jsdom", "fc-run-test", 5).join(" ");

    for (const flag of [
      "--init",
      "--network none",
      "--read-only",
      "--cap-drop ALL",
      "--security-opt no-new-privileges",
      "--user 1000:1000",
      "--pids-limit",
      "--rm",
    ]) {
      expect(args).toContain(flag);
    }
    // Swap equal to memory, or a program swaps its way around the cap.
    expect(args).toContain("--memory 128m --memory-swap 128m");
  });

  /**
   * The image has no ENTRYPOINT and no CMD, so the runner supplies the whole
   * command. `timeout` has to be the **first** thing after the image rather than
   * something `node` is asked to respect: the in-container limit is the first
   * line of defence against a loop that never ends, and with `--init` it is what
   * makes a 631-second run impossible.
   */
  it("puts the time limit ahead of node in the process tree", () => {
    const args = containerArgs("jsdom", "fc-run-test", 7);

    expect(args.slice(-6)).toEqual([
      "first-commit/jsdom:2",
      "timeout",
      "-s",
      "KILL",
      "7",
      "node",
    ]);
  });
});

describe("supports()", () => {
  const runner = new DockerRunner();

  it.each(DOCKER_RUNTIMES)("runs %s", (runtime) => {
    expect(runner.supports(runtime)).toBe(true);
  });

  /** An honest refusal, so the worker does not blame a learner for it. */
  it.each(["ruby", "svelte"])("refuses %s", (runtime) => {
    expect(runner.supports(runtime)).toBe(false);
  });
});

describe("a missing image is an operator problem", () => {
  /**
   * `first-commit/jsdom:2` exists on no registry, so Docker's failure is about
   * pull access to a repository — operator language, in a place the learner
   * reads as feedback on their code.
   */
  it.each([
    "Error response from daemon: pull access denied for first-commit/jsdom",
    "repository does not exist or may require 'docker login'",
    "Unable to find image 'first-commit/jsdom:2' locally",
    "manifest unknown",
  ])("recognises %s", (stderr) => {
    expect(isImageMissing(stderr)).toBe(true);
  });

  it("does not mistake an ordinary failure for a missing image", () => {
    expect(isImageMissing("SyntaxError: Unexpected token )")).toBe(false);
    expect(isImageMissing("")).toBe(false);
  });
});

describe("the two shims stay in step", () => {
  /**
   * `harness.ts` and `dom-harness.ts` each carry their own `expect`, because a
   * program arriving on stdin has no directory to `require` a shared module
   * from. That is a real duplication, so this asserts the DOM shim is a
   * superset: an assertion an author writes for a JavaScript exercise must mean
   * the same thing in a DOM one.
   */
  it("offers every matcher the javascript shim does", () => {
    const javascript = buildHarness({
      runtime: "javascript",
      files: [],
      cases: oneCase,
    }).source;

    const matchers = [...javascript.matchAll(/^\s{4}(\w+): function/gm)].map((m) => m[1]);
    expect(matchers.length).toBeGreaterThan(0);

    for (const matcher of matchers) {
      expect(DOM_MATCHERS).toContain(matcher);
    }
  });

  it("declares every matcher it actually generates", () => {
    const source = domSource({ files: [], cases: oneCase });
    const generated = [...source.matchAll(/^\s{4}(\w+): function/gm)].map((m) => m[1]);

    expect([...generated].sort()).toEqual([...DOM_MATCHERS].sort());
  });
});
