/**
 * What a sandbox program prints, as a constant.
 *
 * **This file imports nothing, and that is its whole purpose** — the same
 * reason `types.ts` imports nothing.
 *
 * `RESULT_MARKER` lived in `harness.ts` until `dom-harness.ts` needed it.
 * `harness.ts` imports `domSource` to dispatch on runtime, so importing the
 * marker back made a cycle: `harness` -> `dom-harness` -> `harness`. Both
 * modules build their shim as a **module-level `const` that interpolates the
 * marker**, so the half-evaluated module hands back `undefined` — and under ESM
 * that is not a quiet `undefined` but a hard `ReferenceError: Cannot access
 * 'RESULT_MARKER' before initialization`.
 *
 * **It was order-dependent, which is what made it dangerous.** Importing
 * `dom-harness` first \u2014 which the unit tests happen to do \u2014 resolves cleanly, so
 * the whole suite passed. Importing `harness` first, which `check.ts` does,
 * throws before a single line runs. A test that only ever enters through one
 * door cannot see it, so `cycle.test.ts` enters through the other.
 */

/**
 * Prefixes a result line, so a learner's own output is not mistaken for one.
 *
 * A learner's code shares stdout with the harness. `results.ts` reads only
 * lines carrying this marker and ignores the rest.
 */
export const RESULT_MARKER = "__fc_result__";
