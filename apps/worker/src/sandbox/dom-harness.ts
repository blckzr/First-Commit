import type { RunRequest } from "./types.js";
import { RESULT_MARKER } from "./protocol.js";

/**
 * The harness for exercises that need a `document` (`code_runtime = 'jsdom'`).
 *
 * **It is the same contract as the plain JavaScript harness**, deliberately: one
 * program on stdin, every case runs, each prints one `RESULT_MARKER` line, the
 * program always exits 0. So `readOutcomes()` reads it, `failAll()` fails it,
 * and the `hidden` flag travels the same path — one copy of the rule that a
 * case reporting nothing is a failure, exactly as AGENT.md requires. A second
 * results reader would be a second place for that rule to be got wrong, and it
 * was got wrong once already.
 *
 * **What is different is only the preamble.** Before the learner's code runs,
 * the program builds a jsdom window and copies `document`, `window` and the
 * handful of constructors a DOM exercise touches onto the global object. The
 * learner's file then reads as it would in a browser.
 *
 * ### Why the program still arrives on stdin
 *
 * `node` reads a program from stdin, so there is no temporary file and no
 * Windows path translation — the part of Docker-on-Windows most likely to break,
 * and the reason the JavaScript runner avoids bind mounts. A program read from
 * stdin has no directory to resolve `node_modules` against, so the container
 * sets `NODE_PATH` to the image's module tree instead. That is the whole reason
 * `require("jsdom")` can work here with `--network none` and a `--read-only`
 * filesystem: the dependency is baked into the image, never fetched.
 *
 * ### Where the page comes from
 *
 * A DOM exercise needs markup to act on. The exercise supplies it as a starter
 * file ending in `.html`; the first one found becomes the document. With none,
 * the document is an empty body — which is right for an exercise that builds its
 * own nodes rather than querying given ones.
 *
 * The markup is injected as a **JSON string literal**, not interpolated raw, so
 * a quote or a backslash in an author's fixture cannot end the string and change
 * the program.
 *
 * ### Every case starts from that page
 *
 * All cases run in one program against one document, so the harness restores
 * the original markup before each one. Without it a case that empties a list
 * changes what every later case sees — and a learner whose case 7 fails because
 * of case 5 is reading a result that is not about their code.
 */

/** The parts of a `RunRequest` this harness reads. Narrow, so tests are small. */
export interface DomHarnessInput {
  files: RunRequest["files"];
  fixtures?: RunRequest["fixtures"];
  cases: RunRequest["cases"];
}

/** Markup an exercise did not supply. A body the learner's code can fill. */
const EMPTY_PAGE = "<!doctype html><html><body></body></html>";

/**
 * Splits the files into the page and the code.
 *
 * **The page comes from `fixtures` and never from `files`.** A learner's own
 * `.html` is dropped, not preferred-against: if the markup the assertions
 * measure against could be submitted, "shows 2 tasks" would be passable by
 * typing the answer into the page and writing no code. Dropping it is also why
 * this is not "whichever comes first" — an ordering rule would put the trust
 * boundary somewhere a reader has to infer, and a reorder would silently move
 * it.
 *
 * Exported because "which file is the page" is a content rule, and a test on it
 * is cheaper than discovering an author's `.HTML` was concatenated into the
 * program as JavaScript.
 */
export function splitDomFiles(
  files: RunRequest["files"],
  fixtures: RunRequest["fixtures"] = [],
): {
  page: string;
  scripts: RunRequest["files"];
} {
  const isPage = (path: string) => /\.html?$/i.test(path);

  const page = fixtures.find((file) => isPage(file.path));
  return {
    page: page?.content ?? EMPTY_PAGE,
    // A learner's `.html` is ignored entirely, not run and not rendered.
    scripts: files.filter((file) => !isPage(file.path)),
  };
}

export function domSource(request: DomHarnessInput): string {
  const { page, scripts } = splitDomFiles(request.files, request.fixtures);

  const learner = scripts.map((file) => `// ${file.path}\n${file.content}`).join("\n\n");

  const cases = request.cases
    .map(
      (c, i) => `
run(${i}, function () {
${indent(c.code, 2)}
});`,
    )
    .join("");

  return `${domPreamble(page)}

// ---- the learner's files ----
${learner}

// ---- test harness (added by the platform) ----
${DOM_SHIM}
${cases}
`;
}

/**
 * Builds the DOM and puts it on the global object.
 *
 * **`runScripts` is left off on purpose.** jsdom will execute `<script>` tags in
 * the supplied markup if asked to, which would let an author's fixture — or
 * anything a learner managed to write into it — run code outside the harness.
 * The learner's own file is the only script that runs here, and it runs because
 * the platform concatenated it, not because the page asked.
 *
 * The globals are listed rather than copied wholesale from `window`. Copying
 * everything would shadow Node's own `global` members (`console`, `process`,
 * `setTimeout`) with jsdom's, and a DOM exercise that printed something would
 * then print into a window nobody reads.
 */
function domPreamble(page: string): string {
  return `// ---- DOM setup (added by the platform) ----
var __fcJsdom = require("jsdom");
var __fcDom = new __fcJsdom.JSDOM(${JSON.stringify(page)}, { pretendToBeVisual: true });

var document = __fcDom.window.document;
var window = __fcDom.window;

// Only what a DOM exercise touches. See the note above on not copying wholesale.
var Node = __fcDom.window.Node;
var Element = __fcDom.window.Element;
var HTMLElement = __fcDom.window.HTMLElement;
var Event = __fcDom.window.Event;
var CustomEvent = __fcDom.window.CustomEvent;
var MouseEvent = __fcDom.window.MouseEvent;
var KeyboardEvent = __fcDom.window.KeyboardEvent;
var DocumentFragment = __fcDom.window.DocumentFragment;
var getComputedStyle = __fcDom.window.getComputedStyle.bind(__fcDom.window);

// \`navigator\` and \`location\` are read-only accessors on some Node versions,
// so they are exposed under names the harness controls rather than assigned.
var navigator = __fcDom.window.navigator;
var location = __fcDom.window.location;

/*
 * **Every case starts from the page the exercise supplied.**
 *
 * All cases run in one program against one document, so without this a case
 * that empties the list changes what every later case sees. \`exercises:check\`
 * caught exactly that: a correct reference solution failed its last case
 * because an earlier one had left one item behind.
 *
 * It has to be fixed here rather than by asking authors to tidy up. A learner
 * whose case 7 fails because of case 5 is reading a result that is not about
 * their code, and §5.11's whole claim is that a failing case names a real
 * problem.
 *
 * The same \`document\` object is kept and its markup replaced, so a reference
 * the learner's file captured at the top level still points at the live
 * document — as it would in a browser after the page was rewritten.
 */
var __fcOriginalPage = __fcDom.window.document.documentElement.innerHTML;

function __fcResetPage() {
  document.documentElement.innerHTML = __fcOriginalPage;
}`;
}

/**
 * The same `expect` the JavaScript harness provides, plus what a DOM assertion
 * needs.
 *
 * **Kept in step with `harness.ts` by hand, and that is a known cost.** The two
 * shims are separate files because this one runs in a different image, and a
 * shared module cannot be `require`d by a program that arrives on stdin with no
 * directory to resolve from. `dom-harness.test.ts` asserts that every matcher
 * the JavaScript shim offers exists here too, so the two cannot drift silently.
 */
const DOM_SHIM = `
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
    // ---- DOM matchers ----
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

function run(i, body) {
  var out = { i: i, passed: true };
  try {
    // A fresh page per case. See the note in the preamble.
    __fcResetPage();
    body();
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

/** Exported so the shim-parity test can read the matcher list. */
export const DOM_MATCHERS = [
  "toBe",
  "toEqual",
  "toBeCloseTo",
  "toThrow",
  "toHaveTextContent",
  "toExist",
  "toHaveClass",
] as const;

function indent(code: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return code
    .split("\n")
    .map((line) => (line.trim() === "" ? "" : pad + line))
    .join("\n");
}
