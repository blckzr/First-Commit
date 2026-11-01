import { describe, expect, it } from "vitest";

/**
 * Module-evaluation order in the sandbox.
 *
 * **This file imports `harness.js` first, on purpose.** Every other test here
 * reaches the sandbox through `dom-harness.js`, and that order happens to
 * resolve the `harness` <-> `dom-harness` cycle cleanly. Entering through
 * `harness` does not: it threw `ReferenceError: Cannot access 'RESULT_MARKER'
 * before initialization` before a single line of `sandbox:check` ran, while all
 * 251 tests passed.
 *
 * A suite that only ever enters through one door cannot see a cycle. So this
 * one enters through the other, and does it in a file of its own so an import
 * added above it later cannot quietly change the order being tested.
 *
 * `protocol.ts` is the fix — a leaf holding the marker, importing nothing, the
 * same shape and the same reason as `types.ts`.
 */

// The first sandbox import in this file. Do not add one above it.
import { buildHarness, RESULT_MARKER } from "./harness.js";
import { domSource } from "./dom-harness.js";
import { readOutcomes } from "./results.js";

describe("entering through harness.ts", () => {
  it("has a defined marker", () => {
    expect(RESULT_MARKER).toBe("__fc_result__");
  });

  /**
   * The cycle's real symptom: a shim built at module-evaluation time with an
   * `undefined` marker. Under ESM that is a `ReferenceError`, but if it ever
   * degrades to a quiet `undefined` the generated program would print
   * `undefined {...}` and `readOutcomes` would ignore every line — which reads
   * as "every case failed" rather than as a broken build.
   */
  it("builds both shims with the marker in them", () => {
    const javascript = buildHarness({
      runtime: "javascript",
      files: [],
      cases: [{ id: "a", name: "one", code: "expect(1).toBe(1);", visible: true }],
    }).source;

    const dom = domSource({
      files: [],
      cases: [{ id: "a", name: "one", code: "expect(1).toBe(1);", visible: true }],
    });

    for (const source of [javascript, dom]) {
      expect(source).toContain(RESULT_MARKER);
      expect(source).not.toContain("undefined {");
    }
  });

  /** The reader agrees with what the generators print. */
  it("reads back a line the shim would have printed", () => {
    const outcomes = readOutcomes(`${RESULT_MARKER} {"i":0,"passed":true}`, [
      { i: 0, id: "a", name: "one", hidden: false },
    ]);

    expect(outcomes.outcomes[0].passed).toBe(true);
  });
});
