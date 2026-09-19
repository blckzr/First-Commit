/**
 * Runs the Code Review AI on the "Sum of even numbers" example from the design document.
 *
 *   npm run try:feedback
 */
import { chatJson } from "../ollama.js";
import { buildCodeFeedbackMessages } from "../prompts/code-feedback.js";
import { CodeFeedback, noSolutionLeak } from "../schemas.js";

const messages = buildCodeFeedbackMessages({
  exerciseTitle: "Sum of even numbers",
  instructions: "Write a function sumEven(nums) that returns the sum of all even numbers in the array.",
  language: "JavaScript",
  files: [
    {
      path: "script.js",
      content: `function sumEven(nums) {
  let total = 0;
  for (let i = 1; i < nums.length; i++) {
    if (nums[i] % 2 === 0) {
      total += nums[i];
    }
  }
  return total;
}`,
    },
  ],
  testResults: [
    { name: "Sums [2, 4, 6] to 12", passed: false, expected: "12", actual: "10" },
    { name: "Ignores odd numbers", passed: true },
    { name: "Handles negative numbers", passed: true },
    { name: "Includes the first item", passed: false, expected: "2", actual: "0" },
  ],
  lintResults: [],
  rubric: [
    { name: "Correctness", description: "All tests pass" },
    { name: "Readability", description: "Clear names and simple structure" },
    { name: "Edge cases", description: "Handles empty arrays and negative numbers" },
  ],
});

const result = await chatJson({ schema: CodeFeedback, messages, validate: noSolutionLeak });

console.log(JSON.stringify(result.data, null, 2));
console.log(`\n${result.model}, mode ${result.mode}, ${result.attempts} attempt(s), ${(result.durationMs / 1000).toFixed(1)}s`);
