import type { RunRequest } from "./types.js";

/**
 * Turning an exercise into one program Judge0 can run.
 *
 * **Judge0 runs a single source file and compares stdout.** It was built for
 * competitive programming: source in, stdin in, stdout out. Our exercises are
 * shaped differently — `test_cases.test_code` holds an assertion
 * (`expect(sumEven([2, 4, 6])).toBe(12)`), and §5.11's screen wants a per-case
 * pass or fail with an expected and an actual.
 *
 * So the cases are compiled **into** the program. One submission runs one
 * container, the program prints one line of JSON per case, and the runner
 * parses those lines back into `TestOutcome`s. The alternative — one Judge0
 * call per case — would spin six containers for the seeded exercise and give
 * no more information.
 *
 * ### Why the results come out as JSON on stdout
 *
 * Judge0 reports one status for the whole run. If the program exited non-zero
 * on the first failed assertion, a learner would see "the first thing that
 * broke" and nothing else — and §5.11 shows the whole list, ticks included.
 * So **every case runs, the program always exits 0**, and the outcome of each
 * is data rather than an exit code.
 *
 * ### What a learner's code can still do to this
 *
 * Print to stdout, for one. A `console.log` in their solution lands in the same
 * stream as the results, so the runner reads only lines that parse as a result
 * object with the marker below and ignores everything else. It cannot be
 * trusted further than that: a learner could print a forged result line. That
 * is not a hole in the sandbox — the sandbox is what stops their code reaching
 * the database — but it is why `runSubmission` treats a *missing* case as a
 * failure rather than assuming a pass, and why the marker is checked.
 */

/** Prefixes a result line, so a learner's own output is not mistaken for one. */
export const RESULT_MARKER = "__fc_result__";

export interface HarnessCase {
  /** Index into the request's case list, not the database id — see below. */
  i: number;
  id: string;
  name: string;
  /**
   * **Carried through, because redaction depends on it.** `is_visible = false`
   * decides what a learner may read; the outcome has to say so or
   * `submissions.ts` cannot strip the values. This field was missing at first,
   * so every outcome came back `hidden: false` and a failing hidden case would
   * have sent its expected and actual straight to the learner's screen — the
   * §6 rule 2 leak that hidden cases exist to prevent.
   *
   * It is **not** in the generated source. The container never learns which
   * cases are hidden, only their index.
   */
  hidden: boolean;
}

export interface Harness {
  source: string;
  /**
   * The cases in the order the program reports them.
   *
   * **Database ids never enter the source.** A learner's own output cannot then
   * name a real test case id, so a forged result line has nothing to attach to.
   * The program reports an index; the runner maps it back here.
   */
  cases: HarnessCase[];
}

export class UnsupportedRuntime extends Error {
  constructor(runtime: string) {
    super(`Judge0 has no harness for ${runtime} exercises.`);
  }
}

export function buildHarness(request: RunRequest): Harness {
  const cases = request.cases.map((c, i) => ({
    i,
    id: c.id,
    name: c.name,
    hidden: !c.visible,
  }));

  switch (request.runtime) {
    case "javascript":
      return { source: javascriptSource(request), cases };
    case "python":
      return { source: pythonSource(request), cases };
    default:
      /**
       * `react` and `vue` are deliberately not here. They need a component
       * test run — Vitest with jsdom, and node_modules — which Judge0 does not
       * provide. AGENT.md §6 rule 4 names them separately for that reason.
       */
      throw new UnsupportedRuntime(request.runtime);
  }
}

/**
 * The learner's files, concatenated, then the assertions.
 *
 * Concatenated rather than `require`d, because Judge0 takes one file. The
 * starter files are CommonJS (`module.exports = { sumEven }`), and a top-level
 * `function sumEven` is in scope for the assertions that follow it in the same
 * file — so the export is harmless and the tests see the function either way.
 */
function javascriptSource(request: RunRequest): string {
  const learner = request.files.map((f) => `// ${f.path}\n${f.content}`).join("\n\n");

  const cases = request.cases
    .map(
      (c, i) => `
run(${i}, function () {
${indent(c.code, 2)}
});`,
    )
    .join("");

  return `${learner}

// ---- test harness (added by the platform) ----
${JS_SHIM}
${cases}
`;
}

/**
 * A minimum `expect`, not a test framework.
 *
 * Only the matchers the seeded content uses, plus the two an author reaches for
 * next. Adding one here means adding it to the Python shim too, so the same
 * assertion reads the same way in both — and it means an author cannot write a
 * matcher that silently passes because the runtime did not have it.
 */
const JS_SHIM = `
function __fcEq(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null || typeof a !== "object") return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

function __fcShow(v) {
  if (typeof v === "string") return JSON.stringify(v);
  if (v === undefined) return "undefined";
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
  };
}

function run(i, body) {
  var out = { i: i, passed: true };
  try {
    body();
  } catch (err) {
    out.passed = false;
    if (err && err.__fc) {
      out.expected = err.expected;
      out.actual = err.actual;
    } else {
      // Their code threw rather than failing an assertion. §9: say what
      // happened; the message is the most useful thing we have.
      out.error = String((err && err.message) || err);
    }
  }
  // Always exit 0 and always print every case — see the note at the top.
  console.log("${RESULT_MARKER} " + JSON.stringify(out));
}
`;

/** The same contract in Python, so an author writes the same assertion twice. */
function pythonSource(request: RunRequest): string {
  const learner = request.files.map((f) => `# ${f.path}\n${f.content}`).join("\n\n");

  const cases = request.cases
    .map(
      (c, i) => `
def __fc_case_${i}():
${indent(c.code, 4) || "    pass"}
__fc_run(${i}, __fc_case_${i})`,
    )
    .join("");

  return `${learner}

# ---- test harness (added by the platform) ----
${PY_SHIM}
${cases}
`;
}

const PY_SHIM = `
import json as __fc_json


class __FcFail(Exception):
    def __init__(self, expected, actual):
        self.expected = expected
        self.actual = actual


def __fc_show(v):
    try:
        return __fc_json.dumps(v)
    except Exception:
        return repr(v)


class __FcExpect:
    def __init__(self, actual):
        self._actual = actual

    def toBe(self, want):
        if self._actual != want:
            raise __FcFail(__fc_show(want), __fc_show(self._actual))

    def toEqual(self, want):
        if self._actual != want:
            raise __FcFail(__fc_show(want), __fc_show(self._actual))

    def toBeCloseTo(self, want, digits=2):
        if abs(self._actual - want) >= (10 ** -digits) / 2:
            raise __FcFail(__fc_show(want), __fc_show(self._actual))

    def toThrow(self):
        try:
            self._actual()
        except Exception:
            return
        raise __FcFail("a thrown error", "no error")


def expect(actual):
    return __FcExpect(actual)


def __fc_run(i, body):
    out = {"i": i, "passed": True}
    try:
        body()
    except __FcFail as fail:
        out["passed"] = False
        out["expected"] = fail.expected
        out["actual"] = fail.actual
    except Exception as err:
        out["passed"] = False
        out["error"] = str(err) or type(err).__name__
    print("${RESULT_MARKER} " + __fc_json.dumps(out))
`;

/** Python needs the assertion inside a function body, so indentation matters. */
function indent(code: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return code
    .split("\n")
    .map((line) => (line.trim() === "" ? "" : pad + line))
    .join("\n");
}
