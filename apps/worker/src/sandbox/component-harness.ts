import type { RunRequest } from "./types.js";
import { RESULT_MARKER } from "./protocol.js";

/**
 * The harness for component exercises (`code_runtime` of `react` or `vue`).
 *
 * **Same results contract as every other runtime**: one program on stdin, one
 * `RESULT_MARKER` line per case, always exit 0, so `readOutcomes` reads it and
 * the `hidden` path is untouched. The contract an *author* writes against is
 * design.md §13.4.
 *
 * Three things here are not in the other harnesses, and each one is forced:
 *
 * 1. **The cases are `async`.** React batches state updates and Vue defers to
 *    `nextTick`, so a bare assertion after a click reads the old DOM in both.
 *    `run()` awaits, `click` and `type` return promises, and awaiting them is
 *    the whole discipline §13.4 asks of an author.
 * 2. **The learner's files are compiled and linked.** JSX and `.vue` are not
 *    JavaScript, and a component usually imports another one. So there is a
 *    small module registry rather than the concatenation the plain runtimes use.
 * 3. **Order matters in the preamble.** `react-dom` reads `navigator.userAgent`
 *    *at module load*, and Node 20 has no global `navigator` — measured: it
 *    throws `ReferenceError: navigator is not defined` before a line of the
 *    learner's code runs. So every jsdom global is installed before any
 *    framework is required.
 */

export interface ComponentHarnessInput {
  runtime: string;
  files: RunRequest["files"];
  fixtures?: RunRequest["fixtures"];
  cases: RunRequest["cases"];
}

/** A component exercise mounts into a container the harness makes. */
const MOUNT_PAGE = "<!doctype html><html><body></body></html>";

export function componentSource(request: ComponentHarnessInput): string {
  const page =
    request.fixtures?.find((file) => /\.html?$/i.test(file.path))?.content ?? MOUNT_PAGE;

  /*
   * The learner's files as data, not as code. Each is compiled inside the
   * container, so nothing here has to parse JSX on the worker — and a file whose
   * name or contents would otherwise have to be escaped into source is simply a
   * JSON string.
   */
  const modules = request.files
    .filter((file) => !/\.html?$/i.test(file.path))
    .map((file) => `  ${JSON.stringify(file.path)}: ${JSON.stringify(file.content)}`)
    .join(",\n");

  const cases = request.cases
    .map(
      (c, i) => `
  await run(${i}, async function () {
${indent(c.code, 4)}
  });`,
    )
    .join("");

  return `${preamble(page, request.runtime)}

// ---- the learner's files ----
var __fcSources = {
${modules}
};

${REGISTRY}
${renderFor(request.runtime)}
${SHIM}

// ---- the cases ----
// Sequential and awaited: a case may be async, and they share one document.
(async function () {
${cases}
})();
`;
}

/**
 * jsdom, then the globals, then nothing else.
 *
 * **Every global is installed before any framework is required.** `react-dom`
 * reads `navigator.userAgent` at module load; without a global `navigator` it
 * throws before the learner's code is even compiled, and the learner would read
 * that as a fault in their component.
 *
 * `runScripts` is left off, as in the DOM harness: the learner's own files are
 * the only code that runs, and they run because the platform compiled them.
 */
function preamble(page: string, runtime: string): string {
  return `// ---- environment (added by the platform) ----
var __fcJsdom = require("jsdom");
var __fcDom = new __fcJsdom.JSDOM(${JSON.stringify(page)}, { pretendToBeVisual: true });

global.window = __fcDom.window;
global.document = __fcDom.window.document;
// Required before react-dom is loaded. See the note above.
global.navigator = __fcDom.window.navigator;

/*
 * A named list, not a copy of everything on \`window\`.
 *
 * Copying wholesale would shadow Node's own globals — \`console\`, \`process\`,
 * \`setTimeout\` — with jsdom's, and a learner's \`console.log\` would then print
 * into a window nobody reads. So these are listed, and each one is here because
 * a framework asked for it at module load: react-dom reads \`navigator\`, and
 * Vue's runtime-dom reads \`SVGElement\`. Both throw a \`ReferenceError\` before the
 * learner's code runs, which reads as a fault in their component.
 *
 * Assigned only when jsdom has it, so a name this version does not provide is
 * simply absent rather than \`undefined\` — \`typeof X === "undefined"\` is what
 * framework feature checks actually test.
 */
[
  "Node", "Element", "HTMLElement", "HTMLInputElement", "HTMLTextAreaElement",
  "HTMLSelectElement", "SVGElement", "MathMLElement", "DocumentFragment",
  "Text", "Comment", "Event", "CustomEvent", "MouseEvent", "KeyboardEvent",
  "InputEvent", "FocusEvent", "DOMParser", "MutationObserver",
].forEach(function (name) {
  if (__fcDom.window[name] !== undefined) global[name] = __fcDom.window[name];
});

global.getComputedStyle = __fcDom.window.getComputedStyle.bind(__fcDom.window);
global.requestAnimationFrame = __fcDom.window.requestAnimationFrame.bind(__fcDom.window);
global.cancelAnimationFrame = __fcDom.window.cancelAnimationFrame.bind(__fcDom.window);

${
  runtime === "react"
    ? `// React only flushes effects inside act() when it is told this is a test.
global.IS_REACT_ACT_ENVIRONMENT = true;`
    : "// Vue needs no act() flag; nextTick is its flush."
}

var __fcOriginalPage = __fcDom.window.document.documentElement.innerHTML;`;
}

/**
 * Compiling and linking the learner's files.
 *
 * **sucrase, not esbuild.** esbuild is a native binary that spawns a child
 * process for its API; sucrase is plain JavaScript. Under `--cap-drop ALL`,
 * `--read-only` and a `noexec` tmpfs, that is one less thing that has to be
 * allowed to work.
 *
 * The **automatic** JSX runtime, so a learner writes a component without
 * `import React` — which is how React has been written since 17, and what they
 * will meet in any project they join.
 */
const REGISTRY = `
var __fcSucrase = require("sucrase");
var __fcSfc = require("@vue/compiler-sfc");
var __fcCache = {};

function __fcCompile(path, source) {
  if (/\\.vue$/i.test(path)) {
    var parsed = __fcSfc.parse(source, { filename: path });
    if (parsed.errors && parsed.errors.length) {
      throw new Error(String(parsed.errors[0].message || parsed.errors[0]));
    }
    // inlineTemplate puts the render function on the component object, so one
    // compiled file is one module with one default export.
    var compiled = __fcSfc.compileScript(parsed.descriptor, {
      id: path,
      inlineTemplate: true,
    });
    return __fcSucrase.transform(compiled.content, {
      transforms: ["imports"],
      filePath: path,
    }).code;
  }

  return __fcSucrase.transform(source, {
    transforms: ["jsx", "imports"],
    jsxRuntime: "automatic",
    filePath: path,
  }).code;
}

/** Resolves './TaskItem' against the files the learner submitted. */
function __fcResolve(from, request) {
  if (request.charAt(0) !== ".") return null;

  var base = from.replace(/[^/]*$/, "");
  var target = (base + request).replace(/\\/\\.\\//g, "/");
  while (/[^/]+\\/\\.\\.\\//.test(target)) {
    target = target.replace(/[^/]+\\/\\.\\.\\//, "");
  }

  var tries = [target, target + ".jsx", target + ".js", target + ".vue"];
  for (var i = 0; i < tries.length; i++) {
    if (Object.prototype.hasOwnProperty.call(__fcSources, tries[i])) return tries[i];
  }
  return null;
}

function __fcLoad(path) {
  if (__fcCache[path]) return __fcCache[path].exports;

  var module = { exports: {} };
  __fcCache[path] = module;

  var compiled = __fcCompile(path, __fcSources[path]);
  var localRequire = function (request) {
    var resolved = __fcResolve(path, request);
    // A bare specifier is a real dependency from the image: react, vue, and
    // the JSX runtime. Nothing else is installed, so nothing else can be asked for.
    return resolved ? __fcLoad(resolved) : require(request);
  };

  new Function("require", "module", "exports", compiled)(
    localRequire,
    module,
    module.exports,
  );
  return module.exports;
}

/*
 * §13.4: a file's default export is available to the test code under the file's
 * base name, so \`TaskList.jsx\` is \`TaskList\`.
 *
 * Every file is loaded up front rather than on demand, so a syntax error in a
 * file nothing imports is still reported as a compilation failure instead of
 * passing silently.
 */
Object.keys(__fcSources).forEach(function (path) {
  var name = path.replace(/^.*\\//, "").replace(/\\.(jsx|js|vue)$/i, "");
  var exports = __fcLoad(path);
  global[name] = exports && exports.__esModule ? exports.default : exports;
});
`;

/**
 * `render`, and the helpers scoped to it (§13.4).
 *
 * **Scoped, not global.** Cases share one program and one document, so a global
 * `screen` left pointing at a previous render is the same cross-case bug a
 * shared document already caused once in the DOM harness. Returning the helpers
 * bound to this container makes it structurally impossible rather than a rule
 * an author has to remember.
 */
function renderFor(runtime: string): string {
  const mount =
    runtime === "react"
      ? `var __fcReact = require("react");
var __fcReactDom = require("react-dom/client");

function __fcMount(container, Component, props) {
  var root = __fcReactDom.createRoot(container);
  __fcReact.act(function () {
    root.render(__fcReact.createElement(Component, props || {}));
  });
  return {
    unmount: function () { __fcReact.act(function () { root.unmount(); }); },
    // act() both applies the change and flushes the effects it caused.
    flush: function (fn) { return __fcReact.act(function () { return fn(); }); },
  };
}`
      : `var __fcVue = require("vue");

function __fcMount(container, Component, props) {
  var app = __fcVue.createApp(Component, props || {});
  app.mount(container);
  return {
    unmount: function () { app.unmount(); },
    // Vue applies the change synchronously and renders on the next tick.
    flush: function (fn) { fn(); return __fcVue.nextTick(); },
  };
}`;

  return `
${mount}

var __fcMounted = [];

function render(Component, props) {
  if (!Component) {
    throw new Error(
      "render() was given nothing to mount. Check that your component file has a default export.",
    );
  }

  var container = document.createElement("div");
  document.body.appendChild(container);

  var mounted = __fcMount(container, Component, props);
  __fcMounted.push(mounted);

  var find = function (selector) { return container.querySelector(selector); };

  return {
    container: container,
    find: find,
    findAll: function (selector) {
      return Array.prototype.slice.call(container.querySelectorAll(selector));
    },
    click: function (element) {
      if (!element) {
        throw new Error("click() was given nothing. The element it should click was not found.");
      }
      return Promise.resolve(mounted.flush(function () { element.click(); }));
    },
    type: function (element, text) {
      if (!element) {
        throw new Error("type() was given nothing. The input it should type into was not found.");
      }
      return Promise.resolve(
        mounted.flush(function () {
          /*
           * **Not just \`element.value = text\`.** React tracks the value on the
           * DOM node and skips an input event whose value it thinks it already
           * set, so a plain assignment updates the box and never reaches the
           * component. Going through the prototype's setter is what makes the
           * change look like a person typing.
           */
          var proto = Object.getPrototypeOf(element);
          var setter = Object.getOwnPropertyDescriptor(proto, "value");
          if (setter && setter.set) setter.set.call(element, text);
          else element.value = text;

          element.dispatchEvent(new window.Event("input", { bubbles: true }));
          element.dispatchEvent(new window.Event("change", { bubbles: true }));
        }),
      );
    },
  };
}
`;
}

/**
 * The assertions, and the per-case reset.
 *
 * The matchers match `dom-harness.ts` exactly; §13.4 promises an author the
 * same `expect` whichever runtime they are writing for.
 */
const SHIM = `
function __fcEq(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null || typeof a !== "object") return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

function __fcShow(v) {
  if (typeof v === "string") return JSON.stringify(v);
  if (v === undefined) return "undefined";
  if (v && v.nodeType === 1) return "<" + String(v.tagName).toLowerCase() + ">";
  try { return JSON.stringify(v); } catch (e) { return String(v); }
}

function expect(actual) {
  return {
    toBe: function (want) {
      if (actual !== want) throw { __fc: true, expected: __fcShow(want), actual: __fcShow(actual) };
    },
    toEqual: function (want) {
      if (!__fcEq(actual, want)) throw { __fc: true, expected: __fcShow(want), actual: __fcShow(actual) };
    },
    toBeCloseTo: function (want, digits) {
      var d = digits === undefined ? 2 : digits;
      if (Math.abs(actual - want) >= Math.pow(10, -d) / 2) {
        throw { __fc: true, expected: __fcShow(want), actual: __fcShow(actual) };
      }
    },
    toThrow: function () {
      var threw = false;
      try { actual(); } catch (e) { threw = true; }
      if (!threw) throw { __fc: true, expected: "a thrown error", actual: "no error" };
    },
    toHaveTextContent: function (want) {
      var text = actual && actual.textContent ? actual.textContent.trim() : "";
      if (text !== want) throw { __fc: true, expected: __fcShow(want), actual: __fcShow(text) };
    },
    toExist: function () {
      if (actual === null || actual === undefined) {
        throw { __fc: true, expected: "an element", actual: "null" };
      }
    },
    toHaveClass: function (want) {
      var has = !!(actual && actual.classList && actual.classList.contains(want));
      if (!has) {
        throw {
          __fc: true,
          expected: 'class "' + want + '"',
          actual: actual && actual.className ? '"' + actual.className + '"' : "no class",
        };
      }
    },
  };
}

/*
 * Every case starts from a clean page with nothing mounted.
 *
 * Unmounting matters as much as resetting the markup: a React root left
 * attached to a removed container keeps its effects and timers alive, and a
 * later case's assertion can then see a component the previous case rendered.
 */
function __fcResetPage() {
  while (__fcMounted.length) {
    try { __fcMounted.pop().unmount(); } catch (e) { /* already gone */ }
  }
  document.documentElement.innerHTML = __fcOriginalPage;
}

async function run(i, body) {
  var out = { i: i, passed: true };
  try {
    __fcResetPage();
    await body();
  } catch (err) {
    out.passed = false;
    if (err && err.__fc) {
      out.expected = err.expected;
      out.actual = err.actual;
    } else {
      out.error = String((err && err.message) || err);
    }
  }
  console.log("${RESULT_MARKER} " + JSON.stringify(out));
}
`;

function indent(code: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return code
    .split("\n")
    .map((line) => (line.trim() === "" ? "" : pad + line))
    .join("\n");
}
