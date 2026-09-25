/**
 * Coding exercises (design.md §5.11).
 *
 * An exercise is an `assessments` row with `type = 'code'`, a `runtime`, the
 * files the learner starts from, and a set of `test_cases`. A reference
 * solution sits beside it in `reference_solutions` — **admin-only, forever**.
 * §6 rule 2 puts three things on the never-send list that live here: hidden
 * test cases, reference solutions, and rubrics.
 *
 * **`is_visible` is the whole point of some of these cases.** A learner sees
 * the named cases so a failure is legible ("Includes the first item — expected
 * 2, got 0"). The hidden ones exist so a solution that special-cases the
 * visible inputs does not pass, which is the oldest trick in automated
 * marking. A learner endpoint filters on `is_visible = true`; nothing else may.
 *
 * Keyed by module slug.
 */

export const exercises = {
  "js-arrays-objects": {
    title: "Sum of even numbers",
    runtime: "javascript",
    passingScore: 100,
    instructions:
      "Write `sumEven(numbers)` so it adds up only the even numbers in the array and returns the total. An empty array totals 0.",
    /** §5.11: "Reset code" puts these back. */
    starterFiles: [
      {
        path: "script.js",
        content: `function sumEven(numbers) {
  let total = 0;
  for (let i = 1; i < numbers.length; i++) {
    if (numbers[i] % 2 === 0) {
      total += numbers[i];
    }
  }
  return total;
}

module.exports = { sumEven };
`,
      },
    ],
    /**
     * The starter deliberately contains §5.11's own bug — the loop starts at
     * index 1 — so the first run fails one visible case and the Code Review AI
     * has something real to explain. Nothing here tells the learner that;
     * the failing test does.
     */
    testCases: [
      {
        name: "Sums [2, 4, 6] to 12",
        visible: true,
        code: `expect(sumEven([2, 4, 6])).toBe(12);`,
      },
      {
        name: "Ignores odd numbers",
        visible: true,
        code: `expect(sumEven([1, 2, 3, 4])).toBe(6);`,
      },
      {
        name: "Handles negative numbers",
        visible: true,
        code: `expect(sumEven([-2, -3, -4])).toBe(-6);`,
      },
      {
        name: "Includes the first item",
        visible: true,
        code: `expect(sumEven([2, 1])).toBe(2);`,
      },
      {
        name: "Totals an empty array to zero",
        visible: true,
        code: `expect(sumEven([])).toBe(0);`,
      },
      // Hidden: a solution that hard-codes the visible answers fails here.
      {
        name: "Works on a longer list",
        visible: false,
        code: `expect(sumEven([5, 8, 13, 21, 34, 2])).toBe(44);`,
      },
      {
        name: "Leaves the input alone",
        visible: false,
        code: `const input = [2, 3, 4];
sumEven(input);
expect(input).toEqual([2, 3, 4]);`,
      },
    ],
    referenceSolution: [
      {
        path: "script.js",
        content: `function sumEven(numbers) {
  return numbers
    .filter((n) => n % 2 === 0)
    .reduce((total, n) => total + n, 0);
}

module.exports = { sumEven };
`,
      },
    ],
  },
};
