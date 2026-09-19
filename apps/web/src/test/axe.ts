import axe from "axe-core";
import { expect } from "vitest";

/**
 * Run axe against a rendered container and fail with the violations listed.
 *
 * design.md §13.1 names axe as part of the stack; §12 sets the target at
 * WCAG 2.2 AA. Automated checks catch perhaps a third of real accessibility
 * problems, so this supplements the explicit assertions in each test rather
 * than replacing them.
 */
export async function expectNoAxeViolations(container: HTMLElement) {
  const results = await axe.run(container, {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
  });

  if (results.violations.length > 0) {
    const detail = results.violations
      .map(
        (v) =>
          `  ${v.id} (${v.impact}): ${v.help}\n` +
          v.nodes.map((n) => `    ${n.html}`).join("\n"),
      )
      .join("\n");
    expect.fail(`axe found ${results.violations.length} violation(s):\n${detail}`);
  }
}
