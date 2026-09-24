/**
 * Placement checks, one per skill.
 *
 * design.md §5.4: a learner rates what they already know, and anything they
 * rate "comfortable" is checked before the platform believes it. Passing writes
 * `module_completions` with `method = 'tested_out'` for that skill's modules on
 * their roadmap — the same evidence testing out of a single module produces,
 * and it counts the same toward the certificate.
 *
 * **Sized to what a pass buys.** Roughly 2.5 questions per module cleared, so a
 * skill with four modules asks ten and a skill with two asks five. Twenty-five
 * in total, which is short enough to sit before a learner has seen anything and
 * long enough that a pass means something. Batching each module's own quiz
 * instead would be 51 questions before the roadmap opens.
 *
 * **Answerable from knowing the skill, not from reading our lessons.** Someone
 * who learned HTML somewhere else must be able to pass this. No question
 * refers to a First Commit lesson, uses our wording, or depends on a
 * convention only this platform follows.
 *
 * The pass mark is 80, not the 70 a module quiz uses: one pass here clears
 * several modules at once, so it should cost more to earn. Options are rotated
 * before storage by the loader, so the first one is not the answer.
 *
 * Keyed by skill slug.
 */

export const placement = {
  html: {
    title: "HTML placement check",
    instructions:
      "Five questions across the HTML modules on your roadmap. Pass and they are marked as tested out. There is no time limit.",
    passingScore: 80,
    questions: [
      {
        prompt: "Which of these is the strongest reason to use <article> instead of <div>?",
        explanation:
          "<div> carries no meaning. A semantic element tells assistive technology and search engines what the content is, which a class name cannot do.",
        options: [
          "It tells assistive technology what the content is",
          "It applies default spacing that <div> does not",
          "It loads faster than a <div>",
          "It is required for CSS Grid to work",
        ],
        correct: 0,
      },
      {
        prompt: 'When is alt="" the correct choice on an image?',
        explanation:
          "An empty alt marks the image as decorative, so a screen reader skips it. A missing alt is different — the file name gets read aloud instead.",
        options: [
          "When the image is decorative and conveys nothing",
          "When the image has a caption nearby",
          "When the image is a logo",
          "Never — alt must always describe the image",
        ],
        correct: 0,
      },
      {
        prompt: "Which markup correctly associates a label with its input?",
        explanation:
          "for on the label must match id on the input. Wrapping also works, but matching for and id is the form that survives being restyled.",
        options: [
          '<label for="email">Email</label><input id="email">',
          '<label name="email">Email</label><input name="email">',
          '<label>Email</label><input placeholder="Email">',
          '<label id="email">Email</label><input for="email">',
        ],
        correct: 0,
      },
      {
        prompt: "What decides which heading level an element should use?",
        explanation:
          "The document's outline. Heading levels describe structure; how large the text looks is a styling decision and belongs in CSS.",
        options: [
          "Its place in the page's outline",
          "How large the text should appear",
          "How important the content is to the business",
          "The order the elements were written in",
        ],
        correct: 0,
      },
      {
        prompt: "Where does the <title> element belong, and what is it for?",
        explanation:
          "In the <head>. It names the document — the browser tab, a bookmark, and what a screen reader announces when the page opens.",
        options: [
          "In <head>; it names the document",
          "In <body>; it is the page's main heading",
          "In <head>; it sets the text shown at the top of the page",
          "Anywhere; it is only used by search engines",
        ],
        correct: 0,
      },
    ],
  },

  css: {
    title: "CSS placement check",
    instructions:
      "Five questions across the CSS modules on your roadmap. Pass and they are marked as tested out. There is no time limit.",
    passingScore: 80,
    questions: [
      {
        prompt:
          "Two rules both set colour on the same element: one selector is .intro, the other is p. Which applies?",
        explanation:
          "The class wins. Specificity decides before source order does, and only when specificity ties does the later rule apply.",
        options: [
          "The .intro rule, because a class is more specific",
          "Whichever appears later in the file",
          "The p rule, because it targets the element itself",
          "Neither — the conflict makes both invalid",
        ],
        correct: 0,
      },
      {
        prompt: "With box-sizing: border-box, an element has width: 200px and padding: 20px. How wide is it on screen?",
        explanation:
          "200px. border-box counts padding and border inside the declared width, which is why most stylesheets set it globally.",
        options: ["200px", "240px", "220px", "180px"],
        correct: 0,
      },
      {
        prompt: "Which layout tool fits arranging items along a single row or column?",
        explanation:
          "Flexbox works along one axis. Grid places items in rows and columns at once, which is more than that job needs.",
        options: [
          "Flexbox",
          "Grid",
          "Floats",
          "Absolute positioning",
        ],
        correct: 0,
      },
      {
        prompt: "What happens to two stacked block elements that each have margin: 20px?",
        explanation:
          "Their vertical margins collapse into the larger of the two, so the gap is 20px and not 40px. Padding never collapses, and neither does gap.",
        options: [
          "They end up 20px apart — the margins collapse",
          "They end up 40px apart",
          "They overlap by 20px",
          "The second element's margin is ignored entirely",
        ],
        correct: 0,
      },
      {
        prompt: "An element is set to display: none. What does a screen reader announce?",
        explanation:
          "Nothing — display: none removes it from the accessibility tree as well as from view. To hide something visually but keep it announced, clip it instead.",
        options: [
          "Nothing — it is removed from the accessibility tree",
          "Its text, because it is still in the HTML",
          "Its text, if it has an aria-label",
          "A note that content is hidden",
        ],
        correct: 0,
      },
    ],
  },

  javascript: {
    title: "JavaScript placement check",
    instructions:
      "Ten questions across the JavaScript modules on your roadmap. Pass and they are marked as tested out. There is no time limit.",
    passingScore: 80,
    questions: [
      {
        prompt: "What does const prevent?",
        explanation:
          "Reassigning the variable. The value itself can still change — the contents of a const array or object are not frozen.",
        options: [
          "Reassigning the variable, but not changing its contents",
          "Any change to the value, including array contents",
          "Using the variable before it is declared",
          "Declaring the variable outside a function",
        ],
        correct: 0,
      },
      {
        prompt: 'Why does "2" == 2 return true while "2" === 2 returns false?',
        explanation:
          "== converts the operands to a common type before comparing; === compares type and value. Using === avoids a whole category of surprises.",
        options: [
          "== converts the types first; === does not",
          "=== only compares numbers",
          '=== treats "2" as NaN',
          "They behave the same; the result depends on the engine",
        ],
        correct: 0,
      },
      {
        prompt: "What does a function with no return statement give back?",
        explanation:
          "undefined. It is a value, so calling the function in an expression does not fail — it quietly gives you undefined, which surfaces later.",
        options: ["undefined", "null", "0", "It throws a TypeError"],
        correct: 0,
      },
      {
        prompt: "Which array method returns a new array of the same length?",
        explanation:
          "map — one result for each item. filter can return fewer, reduce returns a single value, and forEach returns nothing at all.",
        options: ["map", "filter", "reduce", "forEach"],
        correct: 0,
      },
      {
        prompt: "Which of these changes the array it is called on?",
        explanation:
          "sort works in place. map, filter and slice each return a new array and leave the original alone.",
        options: ["sort", "map", "filter", "slice"],
        correct: 0,
      },
      {
        prompt: "Reading user.address.city throws when address is missing. What avoids it?",
        explanation:
          "Optional chaining — user.address?.city gives undefined rather than throwing, stopping at the first missing link.",
        options: [
          "user.address?.city",
          "user.address!.city",
          "user.address.city ?? null",
          "typeof user.address.city",
        ],
        correct: 0,
      },
      {
        prompt: "Where can a variable declared with let inside an if block be read?",
        explanation:
          "Only inside that block. let and const are block-scoped, which is the main thing that separates them from var.",
        options: [
          "Only inside that block",
          "Anywhere in the enclosing function",
          "Anywhere in the file after it runs",
          "Only after the if statement finishes",
        ],
        correct: 0,
      },
      {
        prompt: "What does document.querySelector return when nothing matches?",
        explanation:
          "null. The next line then throws while reading a property of null, which almost always means the selector matched nothing.",
        options: ["null", "undefined", "An empty NodeList", "It throws immediately"],
        correct: 0,
      },
      {
        prompt: "Why prefer textContent over innerHTML for a string a person typed?",
        explanation:
          "innerHTML parses the string as markup, so anything in it becomes real elements. That is how a cross-site scripting bug gets in.",
        options: [
          "innerHTML parses it as markup and can run it",
          "textContent renders faster on long strings",
          "innerHTML strips whitespace",
          "There is no practical difference",
        ],
        correct: 0,
      },
      {
        prompt: "What does await do inside an async function?",
        explanation:
          "It pauses that function until the promise settles. The rest of the page keeps running — clicks, animations and other requests are unaffected.",
        options: [
          "Pauses that function, not the page",
          "Pauses everything until the value arrives",
          "Converts a promise into a synchronous call",
          "Retries the operation until it succeeds",
        ],
        correct: 0,
      },
    ],
  },

  git: {
    title: "Git placement check",
    instructions:
      "Five questions across the Git modules on your roadmap. Pass and they are marked as tested out. There is no time limit.",
    passingScore: 80,
    questions: [
      {
        prompt: "What does git add do?",
        explanation:
          "Stages a change for the next commit. Staging is what lets you commit part of what you changed rather than all of it.",
        options: [
          "Stages a change to be included in the next commit",
          "Saves the change permanently to the repository",
          "Uploads the change to the remote",
          "Creates a new branch for the change",
        ],
        correct: 0,
      },
      {
        prompt: "Which of these can Git not recover for you?",
        explanation:
          "Changes that were never committed. Almost everything else survives somewhere, which is why committing early matters more than any other habit.",
        options: [
          "Changes that were never committed",
          "A commit you reverted",
          "A commit on a branch you deleted",
          "A file deleted in an earlier commit",
        ],
        correct: 0,
      },
      {
        prompt: "What is a branch?",
        explanation:
          "A pointer to a commit that moves forward as you add more. Nothing is copied, which is why creating one is instant.",
        options: [
          "A movable pointer to a commit",
          "A copy of the project's files",
          "A folder holding your uncommitted changes",
          "A snapshot taken when the branch was created",
        ],
        correct: 0,
      },
      {
        prompt: "Git reports a merge conflict. What has happened?",
        explanation:
          "Both branches changed the same lines, so Git stops and asks which version to keep. It is a question, not a failure.",
        options: [
          "Both branches changed the same lines",
          "The branches have drifted too far apart to merge",
          "One branch has commits the other does not",
          "The remote rejected the merge",
        ],
        correct: 0,
      },
      {
        prompt: "You committed a file containing a real API key. What actually fixes it?",
        explanation:
          "Rotating the key. Deleting the file in a later commit leaves the old commit — and the key — in the history for anyone who clones the repository.",
        options: [
          "Rotate the key, then ignore the file",
          "Delete the file and commit again",
          "Add the file to .gitignore",
          "Amend the previous commit",
        ],
        correct: 0,
      },
    ],
  },
};
