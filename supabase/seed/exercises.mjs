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
 *
 * ### Why only the JavaScript modules have one
 *
 * An exercise needs a `runtime` from `code_runtime`, and the sandbox runs
 * `javascript` and `python`. That rules most modules out, and it is worth writing
 * down so the gaps do not read as oversights:
 *
 * | Modules | Why not |
 * |---|---|
 * | `html-basics`, `forms-and-semantics`, `css-basics`, `css-layout` | Markup and styling. A quiz checks these; a program cannot |
 * | `git-basics`, `git-branching` | Git operations, not a program. The capstone is where Git is actually exercised |
 *  * | `what-are-components`, `http-basics`, `fetching-data` | Concept modules. An exercise here would be a contrivance dressed as practice |
 * | React, Vue | Component tests. A DOM is necessary and not sufficient — they also need JSX or SFC compilation and a render call, which is a harness of its own |
 * | Express, Django | Would need the framework installed in the image, and testing a hand-rolled imitation of a router teaches the imitation |
 *
 * So four of ten core modules have one: `js-basics`, `js-functions`,
 * `js-arrays-objects` on the `javascript` runtime, and **`js-dom` on `jsdom`**
 * (migration 0004) — the runtime that gives the program a real `document`
 * before the learner's code runs.
 *
 * The four technology modules are still waiting. They share the `jsdom` image,
 * so the dependency is there; what they need is the component harness.
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

  "js-basics": {
    title: "Count the long words",
    runtime: "javascript",
    passingScore: 100,
    instructions:
      "Write `countLongWords(sentence, minLength)` so it returns how many words in the sentence are at least `minLength` characters long. Words are separated by single spaces. An empty sentence has no words.",
    /**
     * The starter uses `>` where the instructions say "at least", which is the
     * off-by-one every beginner meets. It fails the case named for the boundary
     * and passes the others, so the failing test names the idea rather than
     * just reporting a number.
     */
    starterFiles: [
      {
        path: "script.js",
        content: `function countLongWords(sentence, minLength) {
  let count = 0;
  const words = sentence.split(" ");
  for (const word of words) {
    if (word.length > minLength) {
      count += 1;
    }
  }
  return count;
}

module.exports = { countLongWords };
`,
      },
    ],
    testCases: [
      {
        name: "Counts words longer than the limit",
        visible: true,
        code: `expect(countLongWords("the quick brown fox", 4)).toBe(2);`,
      },
      {
        name: "Counts a word exactly at the limit",
        visible: true,
        code: `expect(countLongWords("code is fun", 4)).toBe(1);`,
      },
      {
        name: "Counts nothing in an empty sentence",
        visible: true,
        code: `expect(countLongWords("", 3)).toBe(0);`,
      },
      {
        name: "Counts every word when the limit is 1",
        visible: true,
        code: `expect(countLongWords("a bb ccc", 1)).toBe(3);`,
      },
      // Hidden: a solution that hard-codes the visible answers fails here.
      {
        name: "Works on a longer sentence",
        visible: false,
        code: `expect(countLongWords("learning to write software takes practice", 6)).toBe(3);`,
      },
      {
        name: "Does not change the sentence it was given",
        visible: false,
        code: `const sentence = "keep me as i am";
countLongWords(sentence, 2);
expect(sentence).toBe("keep me as i am");`,
      },
    ],
    referenceSolution: [
      {
        path: "script.js",
        content: `function countLongWords(sentence, minLength) {
  if (sentence === "") {
    return 0;
  }
  return sentence.split(" ").filter((word) => word.length >= minLength).length;
}

module.exports = { countLongWords };
`,
      },
    ],
  },

  "js-functions": {
    title: "Build a greeting",
    runtime: "javascript",
    passingScore: 100,
    instructions:
      "Write `greet(name, greeting)` so it returns `\"Hello, Ada!\"`. When `greeting` is left out it should use \"Hello\". When `name` is empty, return \"Hello, friend!\" instead — using whichever greeting was given.",
    /**
     * The starter has no default for `greeting`, so calling `greet("Ada")` puts
     * the word `undefined` in the output. That is the lesson of the module —
     * default parameters — and the failing case shows it as text a learner can
     * read rather than as a number.
     */
    starterFiles: [
      {
        path: "script.js",
        content: `function greet(name, greeting) {
  return greeting + ", " + name + "!";
}

module.exports = { greet };
`,
      },
    ],
    testCases: [
      {
        name: "Uses the greeting it was given",
        visible: true,
        code: `expect(greet("Ada", "Hi")).toBe("Hi, Ada!");`,
      },
      {
        name: "Falls back to Hello when no greeting is given",
        visible: true,
        code: `expect(greet("Ada")).toBe("Hello, Ada!");`,
      },
      {
        name: "Calls an empty name friend",
        visible: true,
        code: `expect(greet("")).toBe("Hello, friend!");`,
      },
      {
        name: "Keeps the given greeting for an empty name",
        visible: true,
        code: `expect(greet("", "Welcome")).toBe("Welcome, friend!");`,
      },
      // Hidden, so a lookup table of the visible answers does not pass.
      {
        name: "Works for any name",
        visible: false,
        code: `expect(greet("Grace", "Good morning")).toBe("Good morning, Grace!");`,
      },
      {
        name: "Returns a string, not something printed",
        visible: false,
        code: `expect(typeof greet("Ada")).toBe("string");`,
      },
    ],
    referenceSolution: [
      {
        path: "script.js",
        content: `function greet(name, greeting = "Hello") {
  const who = name === "" ? "friend" : name;
  return greeting + ", " + who + "!";
}

module.exports = { greet };
`,
      },
    ],
  },
  "js-dom": {
    title: "Show the task count",
    runtime: "jsdom",
    passingScore: 100,
    instructions:
      "The page has a list of tasks and an empty `<p id=\"count\">`. Write `updateCount()` so it counts the `<li>` items inside `#tasks` and writes \"3 tasks\" into `#count`. One task reads \"1 task\", and an empty list reads \"No tasks yet\".",
    /**
     * **The first exercise on the `jsdom` runtime** (migration 0004). The page is
     * a starter file ending in `.html`, which the harness turns into the
     * document; everything else is concatenated as code, exactly as the
     * `javascript` runtime does.
     */
    starterFiles: [
      {
        path: "index.html",
        content: `<!doctype html>
<html>
  <body>
    <ul id="tasks">
      <li>Write the plan</li>
      <li>Read the brief</li>
    </ul>
    <p id="count"></p>
  </body>
</html>
`,
      },
      {
        path: "script.js",
        content: `function updateCount() {
  const list = document.getElementById("tasks");
  const items = list.querySelectorAll("li");
  const label = document.getElementById("count");

  label.textContent = items.length + " tasks";
}

module.exports = { updateCount };
`,
      },
    ],
    /**
     * The starter carries the mistake this module teaches: it reads the count
     * correctly and then writes one label for every case, so plural text appears
     * for a single task and for none. Two visible cases fail on it, both with a
     * readable difference ("expected \\"1 task\\", got \\"1 tasks\\"").
     *
     * Nothing tells the learner that. The failing tests do, which is what §5.11
     * and the Code Review AI both rely on.
     */
    testCases: [
      {
        name: "Counts the tasks already on the page",
        visible: true,
        code: `updateCount();
expect(document.getElementById("count")).toHaveTextContent("2 tasks");`,
      },
      {
        name: "Counts a task added to the list",
        visible: true,
        code: `const li = document.createElement("li");
li.textContent = "Ship it";
document.getElementById("tasks").appendChild(li);

updateCount();
expect(document.getElementById("count")).toHaveTextContent("3 tasks");`,
      },
      {
        name: "Says \"1 task\" for a single task",
        visible: true,
        code: `const list = document.getElementById("tasks");
list.innerHTML = "<li>Only this one</li>";

updateCount();
expect(document.getElementById("count")).toHaveTextContent("1 task");`,
      },
      {
        name: "Says \"No tasks yet\" for an empty list",
        visible: true,
        code: `document.getElementById("tasks").innerHTML = "";

updateCount();
expect(document.getElementById("count")).toHaveTextContent("No tasks yet");`,
      },
      /*
       * Hidden, for the reason every hidden case here exists: a solution that
       * writes the four visible answers as literals passes everything above.
       */
      {
        name: "Counts a longer list",
        visible: false,
        code: `const list = document.getElementById("tasks");
list.innerHTML = "<li>a</li><li>b</li><li>c</li><li>d</li><li>e</li><li>f</li><li>g</li>";

updateCount();
expect(document.getElementById("count")).toHaveTextContent("7 tasks");`,
      },
      {
        name: "Reads the list rather than remembering it",
        visible: false,
        code: `const list = document.getElementById("tasks");
list.innerHTML = "<li>a</li><li>b</li><li>c</li>";
updateCount();

list.innerHTML = "<li>a</li>";
updateCount();

expect(document.getElementById("count")).toHaveTextContent("1 task");`,
      },
      /*
       * Only `<li>` inside `#tasks` counts. A solution reaching for
       * `document.querySelectorAll("li")` passes every case above and fails
       * here, which is the mistake this one exists to catch.
       */
      {
        name: "Ignores list items outside the task list",
        visible: false,
        code: `const other = document.createElement("ul");
other.innerHTML = "<li>not a task</li><li>nor this</li>";
document.body.appendChild(other);

updateCount();
expect(document.getElementById("count")).toHaveTextContent("2 tasks");`,
      },
    ],
    referenceSolution: [
      {
        path: "script.js",
        content: `function updateCount() {
  const list = document.getElementById("tasks");
  const items = list.querySelectorAll("li");
  const label = document.getElementById("count");

  if (items.length === 0) {
    label.textContent = "No tasks yet";
  } else if (items.length === 1) {
    label.textContent = "1 task";
  } else {
    label.textContent = items.length + " tasks";
  }
}

module.exports = { updateCount };
`,
      },
    ],
  },
};
