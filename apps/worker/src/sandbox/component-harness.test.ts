import { describe, expect, it } from "vitest";
import { componentSource } from "./component-harness.js";
import { buildHarness, RESULT_MARKER } from "./harness.js";
import { containerArgs, DOCKER_RUNTIMES, DockerRunner } from "./docker.js";

/**
 * The component harness (design.md §13.4), for `react` and `vue`.
 *
 * **These test the program that is generated, not what it does.** Generating it
 * is a pure function; whether React actually renders is a question about a
 * container, and it belongs to `npm run sandbox:check` and
 * `npm run exercises:check` — measured on this machine, the same relationship
 * `AI_JSON_MODE` has with `npm run check`. Nothing here is evidence that a
 * component exercise passes.
 */

const oneCase = [
  { id: "c1", name: "renders", code: 'expect(find("p")).toExist();', visible: true },
];

const reactFile = { path: "Counter.jsx", content: "export default function Counter() {}" };
const vueFile = { path: "Counter.vue", content: "<template><p/></template>" };

describe("the generated program", () => {
  /**
   * **react-dom reads `navigator.userAgent` at module load**, and Node 20 has no
   * global `navigator` — measured: `ReferenceError: navigator is not defined`,
   * thrown before the learner's code is even compiled, which they would read as
   * a fault in their component.
   */
  it("installs the globals before requiring any framework", () => {
    const source = componentSource({ runtime: "react", files: [reactFile], cases: oneCase });

    expect(source.indexOf("global.navigator")).toBeLessThan(
      source.indexOf('require("react-dom/client")'),
    );
  });

  /** Vue's runtime-dom reads `SVGElement` the same way. */
  it("provides the constructors each framework reads at load", () => {
    const source = componentSource({ runtime: "vue", files: [vueFile], cases: oneCase });

    expect(source).toContain("SVGElement");
    expect(source.indexOf("SVGElement")).toBeLessThan(source.indexOf('require("vue")'));
  });

  /**
   * Copying every `window` member would shadow Node's own `console`, `process`
   * and `setTimeout` with jsdom's, and a learner's `console.log` would print
   * into a window nobody reads.
   */
  it("lists the globals rather than copying the window", () => {
    const source = componentSource({ runtime: "react", files: [reactFile], cases: oneCase });

    expect(source).not.toMatch(/Object\.assign\(global,\s*__fcDom\.window\)/);
    expect(source).not.toContain("global.console");
  });

  it("only sets the React act flag for React", () => {
    const react = componentSource({ runtime: "react", files: [reactFile], cases: oneCase });
    const vue = componentSource({ runtime: "vue", files: [vueFile], cases: oneCase });

    expect(react).toContain("IS_REACT_ACT_ENVIRONMENT");
    expect(vue).not.toContain("IS_REACT_ACT_ENVIRONMENT");
  });

  /**
   * §13.4: a case may be async, and after an event it must be. React batches
   * state updates and Vue defers to `nextTick`, so a bare assertion after a
   * click reads the old DOM in both.
   */
  it("awaits every case", () => {
    const source = componentSource({
      runtime: "react",
      files: [reactFile],
      cases: [
        { id: "a", name: "one", code: "expect(1).toBe(1);", visible: true },
        { id: "b", name: "two", code: "expect(2).toBe(2);", visible: true },
      ],
    });

    expect(source).toContain("await run(0,");
    expect(source).toContain("await run(1,");
    expect(source).toContain("async function run(");
  });

  /**
   * **Unmounting matters as much as resetting the markup.** A React root left
   * attached to a removed container keeps its effects and timers alive, so a
   * later case can see a component an earlier one rendered.
   */
  it("unmounts and resets the page before each case", () => {
    const source = componentSource({ runtime: "react", files: [reactFile], cases: oneCase });
    const run = source.slice(source.indexOf("async function run("));

    expect(run.indexOf("__fcResetPage()")).toBeLessThan(run.indexOf("await body()"));
    expect(source).toContain("__fcMounted.pop().unmount()");
  });

  /** The learner's files are data, so nothing has to be escaped into source. */
  it("passes the learner's files as JSON, not as code", () => {
    const content = 'const s = "`${}";';
    const source = componentSource({
      runtime: "react",
      files: [{ path: "Odd.jsx", content }],
      cases: oneCase,
    });

    expect(source).toContain(JSON.stringify(content));
  });

  it("prints one marker line per case", () => {
    const source = componentSource({ runtime: "react", files: [reactFile], cases: oneCase });
    expect(source).toContain(RESULT_MARKER);
  });

  /**
   * AGENT.md: no database id or case name reaches the container. The learner's
   * code runs there and can read it, so a hidden case's name is a §6 rule 2 leak.
   */
  it("puts no database id or case name in the program", () => {
    const source = componentSource({
      runtime: "react",
      files: [reactFile],
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

describe("compiling the learner's files", () => {
  /**
   * esbuild is a native binary that spawns a child process for its API; sucrase
   * is plain JavaScript. Under `--cap-drop ALL`, `--read-only` and a `noexec`
   * tmpfs that is one less thing that has to be allowed to work.
   */
  it("compiles JSX with sucrase, not esbuild", () => {
    const source = componentSource({ runtime: "react", files: [reactFile], cases: oneCase });

    expect(source).toContain('require("sucrase")');
    expect(source).not.toContain("esbuild");
  });

  /** The modern runtime, so a learner writes a component without `import React`. */
  it("uses the automatic JSX runtime", () => {
    const source = componentSource({ runtime: "react", files: [reactFile], cases: oneCase });
    expect(source).toContain('jsxRuntime: "automatic"');
  });

  it("compiles .vue through the SFC compiler", () => {
    const source = componentSource({ runtime: "vue", files: [vueFile], cases: oneCase });
    expect(source).toContain('require("@vue/compiler-sfc")');
  });

  /** §13.4: a file's default export is available under its base name. */
  it("exposes a component under its file's base name", () => {
    const source = componentSource({
      runtime: "react",
      files: [{ path: "src/TaskList.jsx", content: "export default function TaskList() {}" }],
      cases: oneCase,
    });

    expect(source).toContain("src/TaskList.jsx");
    // The name is derived in the container, from the path above.
    expect(source).toContain("global[name] =");
  });
});

describe("buildHarness", () => {
  it.each(["react", "vue"])("builds a %s harness and keeps the hidden flag", (runtime) => {
    const harness = buildHarness({
      runtime,
      files: [runtime === "react" ? reactFile : vueFile],
      cases: [
        { id: "a", name: "visible", code: "expect(1).toBe(1);", visible: true },
        { id: "b", name: "hidden", code: "expect(2).toBe(2);", visible: false },
      ],
    });

    expect(harness.source).toContain("function render(");
    // `redact()` in submissions.ts keys on this; it was dropped once already.
    expect(harness.cases.map((c) => c.hidden)).toEqual([false, true]);
  });
});

describe("the container", () => {
  it.each(["react", "vue"])("runs %s out of the jsdom image", (runtime) => {
    expect(containerArgs(runtime, "fc-run-test", 5)).toContain("first-commit/jsdom:2");
  });

  /** A program on stdin has no directory to resolve `node_modules` against. */
  it.each(["react", "vue", "jsdom"])("sets NODE_PATH for %s", (runtime) => {
    expect(containerArgs(runtime, "fc-run-test", 5).join(" ")).toContain(
      "--env NODE_PATH=/app/node_modules",
    );
  });

  /**
   * The flags are the security boundary. A runtime added in a different place
   * must not quietly get a weaker container than the others.
   */
  it.each(["react", "vue"])("gives %s every isolation flag", (runtime) => {
    const args = containerArgs(runtime, "fc-run-test", 5).join(" ");

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
    expect(args).toContain("--memory 128m --memory-swap 128m");
  });
});

describe("supports()", () => {
  const runner = new DockerRunner();

  it.each(DOCKER_RUNTIMES)("runs %s", (runtime) => {
    expect(runner.supports(runtime)).toBe(true);
  });

  it("now claims react and vue", () => {
    expect(runner.supports("react")).toBe(true);
    expect(runner.supports("vue")).toBe(true);
  });

  /** An honest refusal, so the worker does not blame a learner for it. */
  it.each(["ruby", "svelte", ""])("still refuses %s", (runtime) => {
    expect(runner.supports(runtime)).toBe(false);
  });
});
