import { describe, expect, it } from "vitest";
import { noUnearnedPass, type MilestoneReview } from "../schemas.js";
import {
  buildMilestoneReviewMessages,
  trimDiff,
  type MilestoneReviewInput,
} from "./milestone-review.js";

/**
 * The capstone milestone review (design.md §5.14).
 *
 * Two things are worth testing and the rest is prompt text. **The guard**,
 * because a review that congratulates a learner over a failing check would
 * contradict the row beside it on screen and be believed anyway — it reads more
 * kindly. And **the diff budget**, because one generated lockfile can push the
 * checks and the checklist out of the context window, and a review written
 * without them sounds just as confident.
 */

const review = (over: Partial<MilestoneReview> = {}): MilestoneReview => ({
  summary: "Adding and editing work. The empty-input case still lets a task through.",
  checklist: [{ criterion: "Each task has a stable id", met: true, note: "You use crypto.randomUUID." }],
  nextStep: "Look at the submit handler in TaskForm — what does it do with a blank value?",
  ...over,
});

describe("a review must not claim more than the checks proved", () => {
  it("accepts an honest summary when a check failed", () => {
    expect(noUnearnedPass(review(), true)).toBeNull();
  });

  /**
   * §1: the Code Review AI "never states correctness the tests did not prove".
   * The status comes from the checks; this is the model being asked not to
   * contradict it.
   */
  it.each([
    "All the checks pass — nice work.",
    "Everything works now.",
    "This milestone is complete.",
    "Nothing left to do here.",
    "Looks fully working to me.",
  ])("rejects %s when a check failed", (summary) => {
    const reason = noUnearnedPass(review({ summary }), true);
    expect(reason).not.toBeNull();
    expect(reason).toMatch(/must not say the milestone is complete/i);
  });

  /**
   * The same sentences are **fine** when everything passed. A guard that
   * rejected them outright would stop the model ever telling a learner they had
   * finished.
   */
  it.each(["All the checks pass — nice work.", "Everything works now."])(
    "allows %s when nothing failed",
    (summary) => {
      expect(noUnearnedPass(review({ summary }), false)).toBeNull();
    },
  );

  /**
   * Deliberately narrow: a partly working milestone is worth describing, and
   * "adding and editing work" is both true and useful.
   */
  it("allows a claim about part of the milestone working", () => {
    const summary = "Adding and editing work. Saving does not yet survive a reload.";
    expect(noUnearnedPass(review({ summary }), true)).toBeNull();
  });
});

describe("the next step must not be the fix", () => {
  /** Reuses `givesCode()`, so there is one definition across both halves. */
  it.each([
    "Change the comparison to `value !== \"\"`.",
    "Try `if (!value) return;` at the top of the handler.",
    "Add `event.preventDefault()` first.",
  ])("rejects %s", (nextStep) => {
    const reason = noUnearnedPass(review({ nextStep }), false);
    expect(reason).not.toBeNull();
    expect(reason).toMatch(/contains code/i);
  });

  it.each([
    "Look at the submit handler in TaskForm.",
    "Check what happens in `handleSubmit` when the input is blank.",
    "Read the Forms module again — the part about required fields.",
  ])("allows %s", (nextStep) => {
    expect(noUnearnedPass(review({ nextStep }), false)).toBeNull();
  });
});

describe("keeping the diff inside the context", () => {
  const file = (path: string, size: number) => ({ path, patch: "+".repeat(size) });

  it("drops generated files, which say nothing about the learner's work", () => {
    const { files } = trimDiff([
      file("src/TaskForm.jsx", 100),
      file("package-lock.json", 500_000),
      file("dist/bundle.js", 10_000),
      file("src/App.jsx", 100),
    ]);

    expect(files.map((f) => f.path)).toEqual(["src/TaskForm.jsx", "src/App.jsx"]);
  });

  /**
   * **The failure this prevents.** One enormous file would otherwise fill the
   * window, and the checks, the checklist and the criteria would never reach
   * the model — which would still write a confident review, about nothing.
   */
  it("caps a single huge file rather than letting it eat the budget", () => {
    const { files } = trimDiff([file("src/Big.jsx", 1_000_000), file("src/Small.jsx", 50)], 4000);

    expect(files).toHaveLength(2);
    expect(files[1].path).toBe("src/Small.jsx");
    const total = files.reduce((n, f) => n + f.patch.length, 0);
    expect(total).toBeLessThanOrEqual(4000 * 4 + 200);
  });

  /** Truncation is announced, so the model can say it saw only part. */
  it("says when a file was cut short", () => {
    const { files } = trimDiff([file("src/Big.jsx", 1_000_000)], 1000);
    expect(files[0].patch).toMatch(/showing the first part|truncated/i);
  });

  it("reports how many files it left out", () => {
    const { omitted } = trimDiff([file("src/a.jsx", 10), file("yarn.lock", 10)]);
    expect(omitted).toBe(1);
  });

  it("passes a small diff through untouched", () => {
    const original = [file("src/a.jsx", 10), file("src/b.jsx", 10)];
    const { files, omitted } = trimDiff(original);
    expect(files).toEqual(original);
    expect(omitted).toBe(0);
  });
});

describe("what the prompt tells the model", () => {
  const input: MilestoneReviewInput = {
    milestoneTitle: "Add and edit tasks",
    acceptanceCriteria: ["Typing a task and submitting adds it"],
    reviewChecklist: ["Each task is identified by something stable"],
    checks: [
      { name: "Test: adds a task", state: "passed", detail: '"adds a task" passed.' },
      { name: "Test: rejects empty input", state: "failed", detail: "did not pass." },
      { name: "Test: saves", state: "pending", detail: "still running." },
    ],
    commitSha: "a1b2c3d",
    files: [{ path: "src/TaskForm.jsx", patch: "+const [value, setValue] = useState('');" }],
  };

  const text = () => buildMilestoneReviewMessages(input)[1].content;

  it("states each check's outcome in words the model cannot misread", () => {
    expect(text()).toContain("PASSED");
    expect(text()).toContain("DID NOT PASS");
    // A pending check is not a failure, and the prompt must not imply it is.
    expect(text()).toContain("STILL RUNNING");
  });

  it("includes the criteria, the checklist and the diff", () => {
    expect(text()).toContain("Typing a task and submitting adds it");
    expect(text()).toContain("Each task is identified by something stable");
    expect(text()).toContain("src/TaskForm.jsx");
  });

  it("says so when the push changed nothing it can read", () => {
    const empty = buildMilestoneReviewMessages({ ...input, files: [] })[1].content;
    expect(empty).toMatch(/changed no files/i);
  });
});
