/**
 * Seed content: the Junior Web Developer career path.
 *
 * This is **admin-authored content expressed as data**, not fixtures. The
 * Roadmap AI picks modules, a track and a technology *from what an admin
 * defined* (AGENT.md §7) — so until an admin content editor exists, this file
 * is what "an admin defined" means. It is the curriculum the platform teaches.
 *
 * Everything is keyed by slug, so `npm run db:seed` upserts rather than
 * duplicates and can be re-run after an edit here.
 *
 * **Lessons are deliberately absent.** `lessons.content` is `jsonb` "rich text"
 * and nothing in `docs/` says what shape that is — block list, ProseMirror
 * document, or markdown. Picking one here would quietly decide it for the
 * module page and the admin editor both, so the format is recorded as an open
 * question in docs/task-tracker.md and lessons are seeded with the module page.
 * Quizzes have a real schema (`quiz_questions`, `quiz_options`,
 * `quiz_answer_keys`), so they are seeded.
 */

export const careerPath = {
  slug: "junior-web-developer",
  title: "Junior Web Developer",
  description:
    "Build and ship web applications. The first job most self-taught programmers aim for, and the one with the clearest portfolio.",
};

export const technologies = [
  {
    slug: "react",
    name: "React",
    description: "The most widely used way to build web interfaces, and the one most job postings ask for.",
  },
  {
    slug: "vue",
    name: "Vue",
    description: "A smaller, gentler framework. Less in demand than React, and quicker to get productive in.",
  },
  {
    slug: "express",
    name: "Express",
    description: "A small, unopinionated Node.js server framework. You assemble the pieces yourself.",
  },
  {
    slug: "django",
    name: "Django",
    description: "A Python framework that ships with an admin, an ORM and authentication already built.",
  },
];

/**
 * Skills are global and shared between career paths — passing Git counts on
 * every roadmap that includes it (AGENT.md §6 rule 7). Each skill appears in
 * exactly one place in this path: core, or one track's concept layer.
 */
export const skills = [
  { slug: "html", name: "HTML", description: "The structure of a page, and what each part means." },
  { slug: "css", name: "CSS", description: "How a page looks, and how it rearranges itself to fit." },
  { slug: "javascript", name: "JavaScript", description: "The language that makes a page do things." },
  { slug: "git", name: "Git", description: "Saving your work in a way you and other people can read back." },
  { slug: "components", name: "Components", description: "Building an interface out of pieces you can reuse." },
  { slug: "data-on-the-web", name: "Data on the web", description: "Asking a server for data and showing it." },
  { slug: "servers-and-http", name: "Servers and HTTP", description: "What happens between a browser and a server." },
  { slug: "routing", name: "Routing", description: "Turning a URL into a response." },
];

export const tracks = [
  {
    title: "Frontend",
    description: "The part of the product people see and click.",
    audience:
      "Learners who want to see their work immediately and care how things look and feel. The most common first job, and the easiest to show in a portfolio.",
    sortOrder: 0,
    decision: {
      title: "Choose your framework",
      options: [
        {
          technology: "react",
          comparison: {
            learningCurve: "Steeper. More to learn before your first working screen.",
            useCases: "Most product teams, most agencies, most job postings.",
            jobDemand: "High — the majority of frontend postings name it.",
          },
        },
        {
          technology: "vue",
          comparison: {
            learningCurve: "Gentler. You can build something real sooner.",
            useCases: "Smaller teams, and products that started with it.",
            jobDemand: "Lower than React, and steady.",
          },
        },
      ],
    },
  },
  {
    title: "Backend",
    description: "The part that stores the data and decides what is allowed.",
    audience:
      "Learners who prefer logic and data to layout, and who like knowing exactly what a system did and why.",
    sortOrder: 1,
    decision: {
      title: "Choose your framework",
      options: [
        {
          technology: "express",
          comparison: {
            learningCurve: "Small to start, but you assemble the pieces yourself.",
            useCases: "Node teams, and anywhere the frontend is already JavaScript.",
            jobDemand: "High, and often paired with a frontend role.",
          },
        },
        {
          technology: "django",
          comparison: {
            learningCurve: "More to read first, then a lot is already done for you.",
            useCases: "Data-heavy products, and teams that already write Python.",
            jobDemand: "Steady, and strong where Python is already in use.",
          },
        },
      ],
    },
  },
];

/**
 * Where each skill sits. `core` skills have no track — every learner in this
 * career path takes them, whichever track they end up on. `concept` skills
 * belong to one track, which the schema enforces with a check constraint.
 */
export const pathSkills = [
  { skill: "html", layer: "core", sortOrder: 0 },
  { skill: "css", layer: "core", sortOrder: 1 },
  { skill: "javascript", layer: "core", sortOrder: 2 },
  { skill: "git", layer: "core", sortOrder: 3 },

  { skill: "components", layer: "concept", track: "Frontend", sortOrder: 0 },
  { skill: "data-on-the-web", layer: "concept", track: "Frontend", sortOrder: 1 },

  { skill: "servers-and-http", layer: "concept", track: "Backend", sortOrder: 0 },
  { skill: "routing", layer: "concept", track: "Backend", sortOrder: 1 },
];

/**
 * A `technology` module is one framework's version of a concept — "Components
 * in React" and "Components in Vue" are two modules, which is what the schema's
 * `(kind = 'technology') = (technology_id is not null)` check expects. The
 * Roadmap AI includes only the ones matching the chosen technology.
 *
 * `requires` names other modules by slug and becomes `module_prerequisites`.
 * The Roadmap AI must not order a module before anything it requires.
 */
export const modules = [
  // --- Core: HTML ----------------------------------------------------------
  {
    slug: "html-basics",
    skill: "html",
    kind: "core",
    sortOrder: 0,
    requires: [],
    version: {
      title: "HTML basics",
      description:
        "The tags a page is built from, and how a browser reads them. By the end you can write a page from an empty file.",
      estimatedHours: 4,
    },
    quiz: {
      title: "HTML basics quiz",
      instructions: "Six questions on the tags and structure from this module. There is no time limit.",
      questions: [
        {
          prompt: "What does a <section> element tell a browser that a <div> does not?",
          explanation:
            "A <div> is a box with no meaning. A <section> says the content inside belongs together as one part of the page, which screen readers and search engines both use.",
          options: [
            "That the content inside is one part of the page",
            "That the content should be centred",
            "That the content loads after everything else",
            "Nothing — they are the same element with different names",
          ],
          lesson: 2,

          correct: 0,
        },
        {
          prompt: "Why does an <img> need an alt attribute?",
          explanation:
            "alt is the text a screen reader announces, and what shows if the image fails to load. An empty alt=\"\" is correct for a purely decorative image.",
          options: [
            "To describe the image to people who cannot see it",
            "To set the image's width",
            "To choose the file format",
            "To stop the image being cached",
          ],
          lesson: 3,

          correct: 0,
        },
        {
          prompt: "Where does a <title> element belong?",
          explanation:
            "<title> goes in the <head>. It is what the browser tab shows and what a screen reader announces when the page opens.",
          options: ["In the <head>", "In the <body>", "Inside the first <h1>", "Anywhere in the file"],
          lesson: 1,

          correct: 0,
        },
        {
          prompt: "How many <h1> elements should a page usually have?",
          explanation:
            "One. The heading levels describe the page's outline, and more than one <h1> leaves a screen reader user without a clear top of the page.",
          options: ["One", "One per section", "As many as you like", "None — <h1> is deprecated"],
          lesson: 2,

          correct: 0,
        },
        {
          prompt: "What is wrong with <p>A list:<br>one<br>two<br>three</p>?",
          explanation:
            "<br> only moves text to the next line. A <ul> with three <li> elements says these are three items, which is what the content actually is.",
          options: [
            "It looks like a list but is not marked up as one",
            "<br> is not valid HTML",
            "A <p> cannot contain text",
            "Nothing — this is the right way to write a list",
          ],
          lesson: 2,

          correct: 0,
        },
        {
          prompt: "What does the lang attribute on <html> do?",
          explanation:
            "It tells a screen reader which language to pronounce the page in. Without it, English text can be read aloud with the wrong accent and rules.",
          options: [
            "Tells assistive technology which language the page is in",
            "Translates the page automatically",
            "Sets the character encoding",
            "Chooses which font the browser uses",
          ],
          lesson: 1,

          correct: 0,
        },
      ],
    },
  },
  {
    slug: "forms-and-semantics",
    skill: "html",
    kind: "core",
    sortOrder: 1,
    requires: ["html-basics"],
    version: {
      title: "Forms and semantics",
      description:
        "Inputs, labels, and the elements that say what a part of the page is for. This is where most accessibility is won or lost.",
      estimatedHours: 5,
    },
    quiz: {
      title: "Forms and semantics quiz",
      instructions: "Five questions on labels, inputs, and landmarks. There is no time limit.",
      questions: [
        {
          prompt: "What joins a <label> to its input?",
          explanation:
            "Matching for and id. That join is what makes a screen reader announce the label, and what makes clicking the words focus the field.",
          options: [
            "A for attribute on the label matching the input's id",
            "Putting them next to each other in the HTML",
            "A matching class on both elements",
            "The name attribute on the input",
          ],
          lesson: 1,
          correct: 0,
        },
        {
          prompt: "Why is a placeholder not a substitute for a label?",
          explanation:
            "It disappears as soon as someone types, so the field is left with no name — for them and for anyone reviewing their answers. Use a placeholder for an example of the format instead.",
          options: [
            "It disappears once the field has been typed in",
            "It cannot be styled",
            "Screen readers read it twice",
            "It only works on text inputs",
          ],
          lesson: 1,
          correct: 0,
        },
        {
          prompt: "Which input type suits a phone number?",
          explanation:
            'type="tel" gives a number pad without the number-input behaviour. type="number" strips leading zeros and allows e, which is wrong for phone numbers, postcodes and card numbers.',
          options: ['type="tel"', 'type="number"', 'type="text" with a pattern', 'type="search"'],
          lesson: 2,
          correct: 0,
        },
        {
          prompt: "How many <main> elements should a page have?",
          explanation:
            "One. Two leaves a screen reader user with no reliable place to jump to, which is worse than having none at all.",
          options: ["One", "One per section", "As many as the layout needs", "None — main is optional"],
          lesson: 3,
          correct: 0,
        },
        {
          prompt: 'What is wrong with aria-label="Main navigation" on a <nav>?',
          explanation:
            'The role is already announced, so this is read as "Main navigation navigation". Name it "Main" and let the element supply the rest.',
          options: [
            'The word "navigation" is announced twice',
            "aria-label cannot be used on <nav>",
            "It stops the nav being a landmark",
            "Nothing — this is the recommended label",
          ],
          lesson: 3,
          correct: 0,
        },
      ],
    },
  },

  // --- Core: CSS -----------------------------------------------------------
  {
    slug: "css-basics",
    skill: "css",
    kind: "core",
    sortOrder: 0,
    requires: ["html-basics"],
    version: {
      title: "CSS basics",
      description:
        "Selectors, the box model, and why two rules can both apply. Enough to style a page deliberately rather than by trial and error.",
      estimatedHours: 6,
    },
    quiz: {
      title: "CSS basics quiz",
      instructions: "Five questions on selectors and the box model. There is no time limit.",
      questions: [
        {
          prompt: "Two rules set the same property on the same element. Which one wins?",
          explanation:
            "The more specific selector wins, whatever the order. Only when specificity ties does the later rule win.",
          options: [
            "The one with the more specific selector",
            "Always the last one in the file",
            "Always the first one in the file",
            "The one in the smaller stylesheet",
          ],
          lesson: 1,

          correct: 0,
        },
        {
          prompt: "With box-sizing: border-box, what does width: 200px include?",
          explanation:
            "border-box counts padding and border inside the width, so the element is 200px wide on screen. That is why most stylesheets set it globally.",
          options: [
            "The content, padding and border",
            "The content only",
            "The content and margin",
            "Everything including margin",
          ],
          lesson: 2,

          correct: 0,
        },
        {
          prompt: "What does margin: 0 auto do to a block element with a set width?",
          explanation:
            "auto splits the leftover horizontal space equally, which centres the element in its container.",
          options: [
            "Centres it horizontally in its container",
            "Centres it vertically",
            "Removes all spacing around it",
            "Makes it fill the container",
          ],
          lesson: 2,

          correct: 0,
        },
        {
          prompt: "Why is a CSS custom property (--space: 8px) better than repeating 8px?",
          explanation:
            "It is defined once and read everywhere, so a change happens in one place — and it can be redefined for dark mode or a breakpoint without touching every rule.",
          options: [
            "It is defined once and every use follows a change",
            "It renders faster",
            "It works in older browsers",
            "It stops other stylesheets overriding the value",
          ],
          lesson: 1,

          correct: 0,
        },
        {
          prompt: "An element has display: none. What does a screen reader announce?",
          explanation:
            "Nothing — display: none removes the element from the accessibility tree as well as from the screen. To hide something visually but keep it announced, clip it instead.",
          options: [
            "Nothing — it is removed from the accessibility tree",
            "Its text, since it is still in the HTML",
            "Its text, but only if it has an aria-label",
            "A warning that content is hidden",
          ],
          lesson: 3,

          correct: 0,
        },
      ],
    },
  },
  {
    slug: "css-layout",
    skill: "css",
    kind: "core",
    sortOrder: 1,
    requires: ["css-basics"],
    version: {
      title: "Layout with flex and grid",
      description:
        "Arranging a page in two dimensions, and letting it rearrange itself at different widths without a second set of pages.",
      estimatedHours: 7,
    },
    quiz: {
      title: "Layout quiz",
      instructions: "Five questions on flexbox, grid, and reflow. There is no time limit.",
      questions: [
        {
          prompt: "In a flex row, which property moves children along the main axis?",
          explanation:
            "justify-content works along the main axis and align-items across it. They swap meaning when flex-direction is column.",
          options: ["justify-content", "align-items", "align-content", "place-self"],
          lesson: 1,
          correct: 0,
        },
        {
          prompt: "What does repeat(auto-fit, minmax(240px, 1fr)) do?",
          explanation:
            "It fits as many columns as will hold 240px, each sharing the leftover space. The column count follows the container's width, so no media query has to name a screen size.",
          options: [
            "Fits as many columns as fit, each at least 240px",
            "Always makes exactly 240px columns",
            "Makes one column per child, 240px each",
            "Repeats the first column until the row is full",
          ],
          lesson: 2,
          correct: 0,
        },
        {
          prompt: "Why use minmax(0, 1fr) instead of 1fr for a grid column?",
          explanation:
            "A grid column will not shrink below its content by default, so one long word can push the layout wider than the screen. minmax(0, 1fr) lets it shrink.",
          options: [
            "It lets the column shrink below its content's width",
            "It makes the column exactly zero pixels wide",
            "It is required for gap to work",
            "It centres the content in the column",
          ],
          lesson: 2,
          correct: 0,
        },
        {
          prompt: "What does mobile-first mean in practice?",
          explanation:
            "The base rules are the narrow layout, and each min-width query adds to them. Going the other way, every query has to undo something.",
          options: [
            "The base rules are the narrow layout and queries add to it",
            "Phones get a separate stylesheet",
            "The page checks the device before loading",
            "Every rule is written twice",
          ],
          lesson: 3,
          correct: 0,
        },
        {
          prompt: "The page scrolls sideways at 320px. What is the usual cause?",
          explanation:
            "Something has a fixed width that should be a maximum. img, video { max-width: 100% } fixes the most common one.",
          options: [
            "An element with a fixed width wider than the screen",
            "Too many media queries",
            "Using grid instead of flexbox",
            "A missing viewport meta tag is the only possible cause",
          ],
          lesson: 3,
          correct: 0,
        },
      ],
    },
  },

  // --- Core: JavaScript ----------------------------------------------------
  {
    slug: "js-basics",
    skill: "javascript",
    kind: "core",
    sortOrder: 0,
    requires: [],
    version: {
      title: "JavaScript basics",
      description:
        "Values, variables, comparison and control flow. The parts every later module assumes you already have.",
      estimatedHours: 8,
    },
    quiz: {
      title: "JavaScript basics quiz",
      instructions: "Five questions on values and control flow. There is no time limit.",
      questions: [
        {
          prompt: "What is the difference between let and const?",
          explanation:
            "const stops the variable being reassigned. It does not freeze the value — the contents of a const array can still change.",
          options: [
            "const cannot be reassigned, but its contents can still change",
            "const values can never change in any way",
            "let is for numbers and const is for text",
            "There is no difference in modern JavaScript",
          ],
          lesson: 1,

          correct: 0,
        },
        {
          prompt: 'Why does "2" == 2 return true but "2" === 2 return false?',
          explanation:
            "== converts the operands to the same type before comparing; === does not. Comparing with === avoids a whole category of surprises.",
          options: [
            "== converts the types before comparing, === does not",
            "=== only works on numbers",
            "== is deprecated and always returns true",
            "They are the same; the result depends on the browser",
          ],
          lesson: 2,

          correct: 0,
        },
        {
          prompt: "What does a function return if it has no return statement?",
          explanation:
            "undefined. That is a value, so calling the function in an expression does not fail — it quietly gives you undefined.",
          options: ["undefined", "null", "0", "It throws an error"],
          lesson: 3,

          correct: 0,
        },
        {
          prompt: "Which of these is falsy?",
          explanation:
            'The falsy values are false, 0, -0, 0n, "", null, undefined and NaN. An empty array and the string "0" are both truthy, which surprises most people once.',
          options: ['The empty string ""', "The empty array []", "The empty object {}", 'The string "0"'],
          lesson: 2,

          correct: 0,
        },
        {
          prompt: "What does typeof null return?",
          explanation:
            '"object" — a bug from the first version of JavaScript that was never fixed because too much code relies on it. Use value === null to test for null.',
          options: ['"object"', '"null"', '"undefined"', "It throws a TypeError"],
          lesson: 2,

          correct: 0,
        },
      ],
    },
  },
  {
    slug: "js-functions",
    skill: "javascript",
    kind: "core",
    sortOrder: 1,
    requires: ["js-basics"],
    version: {
      title: "Functions",
      description:
        "Writing a piece of behaviour once and calling it by name: parameters, return values, and scope.",
      estimatedHours: 5,
    },
    quiz: {
      title: "Functions quiz",
      instructions: "Five questions on parameters, scope, and passing functions around. There is no time limit.",
      questions: [
        {
          prompt: "A function computes a value but has no return. What does the caller get?",
          explanation:
            "undefined. The value was computed and thrown away, and because undefined is a value nothing fails until it is used somewhere else.",
          options: ["undefined", "The computed value", "null", "A SyntaxError"],
          lesson: 1,
          correct: 0,
        },
        {
          prompt: "Where can a variable declared with const inside a function be read?",
          explanation:
            "Only inside that function. A function can see outwards to where it was written, but nothing can see inwards.",
          options: [
            "Only inside that function",
            "Anywhere in the file after it is declared",
            "Anywhere, since const is global",
            "Only inside the block it was declared in, never the whole function",
          ],
          lesson: 2,
          correct: 0,
        },
        {
          prompt: "Why is var no longer used?",
          explanation:
            "let and const are scoped to their block; var is not, so a variable declared inside an if or a loop leaks out of it.",
          options: [
            "It is not scoped to the block it is declared in",
            "It is slower than let",
            "It cannot hold objects",
            "It was removed from the language",
          ],
          lesson: 2,
          correct: 0,
        },
        {
          prompt: "What does (n) => { n * 3; } return?",
          explanation:
            "undefined. An arrow function returns its single expression only when there are no braces; with braces you need an explicit return.",
          options: ["undefined", "n * 3", "A function", "It is a syntax error"],
          lesson: 3,
          correct: 0,
        },
        {
          prompt: 'What does addEventListener("click", save()) do wrong?',
          explanation:
            "The parentheses call save immediately and register whatever it returned — usually undefined. Pass the function itself: addEventListener(\"click\", save).",
          options: [
            "It calls save straight away and registers its return value",
            "It registers the listener twice",
            "It only works on the first click",
            "Nothing — this is the correct form",
          ],
          lesson: 3,
          correct: 0,
        },
      ],
    },
  },
  {
    slug: "js-arrays-objects",
    skill: "javascript",
    kind: "core",
    sortOrder: 2,
    requires: ["js-functions"],
    version: {
      title: "Arrays and objects",
      description:
        "Storing and working with lists and grouped data, and the array methods you will use every day after this.",
      estimatedHours: 5,
    },
    quiz: {
      title: "Arrays and objects quiz",
      instructions: "Five questions on lists, records, and the array methods. There is no time limit.",
      questions: [
        {
          prompt: "An array has 3 items. What is at index 3?",
          explanation:
            "undefined — not an error. Positions start at zero, so the last item is at length - 1, and an off-by-one usually surfaces somewhere else entirely.",
          options: ["undefined", "The last item", "The first item", "It throws a RangeError"],
          lesson: 1,
          correct: 0,
        },
        {
          prompt: "Why does push() work on an array declared with const?",
          explanation:
            "const stops the variable being pointed at something else. It does not freeze the contents, so the array can still be changed.",
          options: [
            "const fixes the name, not the value it points at",
            "push is a special case allowed by const",
            "It does not — that throws a TypeError",
            "Arrays are always mutable because they are global",
          ],
          lesson: 1,
          correct: 0,
        },
        {
          prompt: "What does shark.habitat?.depth give when habitat is missing?",
          explanation:
            "undefined. Optional chaining stops at the first missing link instead of throwing, which is what shark.habitat.depth would do.",
          options: ["undefined", "null", "An empty object", "A TypeError"],
          lesson: 2,
          correct: 0,
        },
        {
          prompt: "How long is the array that map() returns?",
          explanation:
            "Always the same length as the original — one result for each item. filter is the one that can return fewer.",
          options: [
            "The same length as the original",
            "However many items passed a test",
            "One, since it reduces to a single value",
            "It depends on what the callback returns",
          ],
          lesson: 3,
          correct: 0,
        },
        {
          prompt: "Which of these changes the original array?",
          explanation:
            "sort works in place. map, filter and slice all return a new array and leave the original alone — copy first with [...list].sort() if that matters.",
          options: ["sort", "map", "filter", "slice"],
          lesson: 3,
          correct: 0,
        },
      ],
    },
  },
  {
    slug: "js-dom",
    skill: "javascript",
    kind: "core",
    sortOrder: 3,
    requires: ["js-arrays-objects", "css-basics"],
    version: {
      title: "DOM manipulation",
      description:
        "Reading and changing a live page from JavaScript, and responding when someone clicks or types.",
      estimatedHours: 6,
    },
    quiz: {
      title: "DOM quiz",
      instructions: "Five questions on finding elements, changing them, and handling events. There is no time limit.",
      questions: [
        {
          prompt: "querySelector finds nothing. What does it return?",
          explanation:
            "null. The next line then throws \"Cannot read properties of null\", which almost always means a selector matched nothing.",
          options: ["null", "undefined", "An empty NodeList", "It throws immediately"],
          lesson: 1,
          correct: 0,
        },
        {
          prompt: "A script in <head> cannot find any elements. Why?",
          explanation:
            "It runs before the body is parsed, so the elements do not exist yet. Put the script at the end of the body, or mark it defer.",
          options: [
            "It runs before the body has been parsed",
            "Scripts in <head> cannot use querySelector",
            "The DOM is not available until a user interacts",
            "It needs a type attribute",
          ],
          lesson: 1,
          correct: 0,
        },
        {
          prompt: "Why prefer textContent over innerHTML for text from a person?",
          explanation:
            "innerHTML parses the string as markup, so anything in it becomes real elements. That is how a cross-site scripting bug gets in. textContent shows the string exactly as typed.",
          options: [
            "innerHTML parses the string as markup and can run it",
            "textContent is faster on long strings",
            "innerHTML only works on form fields",
            "There is no difference in modern browsers",
          ],
          lesson: 2,
          correct: 0,
        },
        {
          prompt: "What does event.preventDefault() do on a form submit?",
          explanation:
            "It stops the browser's own behaviour — reloading the page to submit — so your code can handle it instead.",
          options: [
            "Stops the browser submitting and reloading the page",
            "Stops the event reaching other listeners",
            "Cancels the form's validation",
            "Clears the form's fields",
          ],
          lesson: 3,
          correct: 0,
        },
        {
          prompt: "Why use a <button> rather than a <div> with a click handler?",
          explanation:
            "A button is reachable by keyboard and its click fires for Enter, Space and a screen reader's activate command. A div reaches none of them without extra work that is easy to get wrong.",
          options: [
            "A button works for keyboard and screen reader users already",
            "A div cannot have a click handler",
            "Buttons are faster to render",
            "A div would need an id to be clickable",
          ],
          lesson: 3,
          correct: 0,
        },
      ],
    },
  },

  // --- Core: Git -----------------------------------------------------------
  {
    slug: "git-basics",
    skill: "git",
    kind: "core",
    sortOrder: 0,
    requires: [],
    version: {
      title: "Git basics",
      description:
        "Tracking changes, writing a commit message someone can read back, and pushing work to GitHub.",
      estimatedHours: 4,
    },
    quiz: {
      title: "Git basics quiz",
      instructions: "Five questions on commits, messages, and pushing. There is no time limit.",
      questions: [
        {
          prompt: "What are the three places a change moves through?",
          explanation:
            "The working tree is what you are editing, the staging area is what you have chosen to include, and the repository is what has been committed.",
          options: [
            "Working tree, staging area, repository",
            "Local, remote, branch",
            "Draft, review, published",
            "Editor, terminal, GitHub",
          ],
          lesson: 1,
          correct: 0,
        },
        {
          prompt: "Which of these can Git not get back for you?",
          explanation:
            "Uncommitted changes. git restore throws them away with no undo, which is why committing early and often matters more than any other habit.",
          options: [
            "Changes you never committed",
            "A commit you reverted",
            "A commit on a deleted branch",
            "A file deleted in an earlier commit",
          ],
          lesson: 1,
          correct: 0,
        },
        {
          prompt: 'Which subject line is the better commit message?',
          explanation:
            "Say what the commit does, in the present tense, without naming the file — the diff already shows which file changed. The body is where you explain why.",
          options: [
            "Fix the total on empty carts",
            "Updated cart.js",
            "changes",
            "Fixed the bug and also updated the footer",
          ],
          lesson: 2,
          correct: 0,
        },
        {
          prompt: "What belongs in the body of a commit message?",
          explanation:
            "Why the change was made. The diff shows what changed; it cannot show what was wrong, what else you tried, or what you decided against.",
          options: [
            "Why the change was made",
            "A list of the files you touched",
            "The line numbers you edited",
            "Nothing — a subject line is always enough",
          ],
          lesson: 2,
          correct: 0,
        },
        {
          prompt: "You committed a .env file with a real key. What actually fixes it?",
          explanation:
            "Rotating the key. Deleting the file in a later commit leaves the old commit — and the key — in the history for anyone who clones the repository.",
          options: [
            "Rotate the key, then add .env to .gitignore",
            "Delete the file and commit again",
            "Add it to .gitignore and push",
            "Force push over the branch",
          ],
          lesson: 3,
          correct: 0,
        },
      ],
    },
  },
  {
    slug: "git-branching",
    skill: "git",
    kind: "core",
    sortOrder: 1,
    requires: ["git-basics"],
    version: {
      title: "Branching and merging",
      description:
        "Working on something without breaking what already works, and putting it back together afterwards.",
      estimatedHours: 4,
    },
    quiz: {
      title: "Branching and merging quiz",
      instructions: "Five questions on branches, conflicts, and sharing work. There is no time limit.",
      questions: [
        {
          prompt: "What is a branch?",
          explanation:
            "A label pointing at one commit, which moves forward as you add more. Nothing is copied, which is why creating one is instant however large the repository.",
          options: [
            "A pointer to a commit that moves as you add more",
            "A full copy of the project files",
            "A folder inside .git holding your changes",
            "A snapshot taken when you branched",
          ],
          lesson: 1,
          correct: 0,
        },
        {
          prompt: "Why keep work on a branch instead of committing straight to main?",
          explanation:
            "So main stays something you could ship. A branch lets you leave something half-finished without anyone else seeing a broken page.",
          options: [
            "So main always stays in a working state",
            "Because commits on main cannot be undone",
            "Because Git will not allow two people on main",
            "It makes the repository smaller",
          ],
          lesson: 1,
          correct: 0,
        },
        {
          prompt: "In a conflict, what is the part above the ======= line?",
          explanation:
            "What is already on the branch you are merging into. Below it is what is coming in from the branch being merged.",
          options: [
            "What is on the branch you are merging into",
            "What is coming in from the other branch",
            "The version Git recommends keeping",
            "The oldest of the two versions",
          ],
          lesson: 2,
          correct: 0,
        },
        {
          prompt: "A merge is going badly and you want to stop. What do you run?",
          explanation:
            "git merge --abort puts everything back as it was. Nothing is lost while a merge is in progress.",
          options: ["git merge --abort", "git reset --hard", "git revert HEAD", "git checkout main"],
          lesson: 2,
          correct: 0,
        },
        {
          prompt: "Why use --force-with-lease instead of --force?",
          explanation:
            "It refuses if someone else has pushed since you last looked, so you cannot overwrite work you have not seen. A plain --force deletes it without asking.",
          options: [
            "It refuses if someone else has pushed since you last looked",
            "It is faster on large repositories",
            "It keeps a backup branch automatically",
            "It is the only one that works over HTTPS",
          ],
          lesson: 3,
          correct: 0,
        },
      ],
    },
  },

  // --- Frontend: Components ------------------------------------------------
  {
    slug: "what-are-components",
    skill: "components",
    kind: "concept",
    sortOrder: 0,
    requires: ["js-dom"],
    version: {
      title: "What are components",
      description:
        "The idea every framework shares: describe a piece of interface once, then use it wherever you need it. Framework-independent.",
      estimatedHours: 3,
    },
  },
  {
    slug: "components-in-react",
    skill: "components",
    kind: "technology",
    technology: "react",
    sortOrder: 1,
    requires: ["what-are-components"],
    version: {
      title: "Components in React",
      description: "Writing components with JSX, passing props, and composing them into a screen.",
      estimatedHours: 6,
    },
  },
  {
    slug: "components-in-vue",
    skill: "components",
    kind: "technology",
    technology: "vue",
    sortOrder: 1,
    requires: ["what-are-components"],
    version: {
      title: "Components in Vue",
      description: "Writing single-file components, passing props, and composing them into a screen.",
      estimatedHours: 6,
    },
  },
  {
    slug: "state-and-props-react",
    skill: "components",
    kind: "technology",
    technology: "react",
    sortOrder: 2,
    requires: ["components-in-react"],
    version: {
      title: "State and props in React",
      description: "What a component remembers, what it is told, and why the difference decides your design.",
      estimatedHours: 6,
    },
  },
  {
    slug: "state-and-props-vue",
    skill: "components",
    kind: "technology",
    technology: "vue",
    sortOrder: 2,
    requires: ["components-in-vue"],
    version: {
      title: "State and props in Vue",
      description: "What a component remembers, what it is told, and why the difference decides your design.",
      estimatedHours: 6,
    },
  },

  // --- Frontend: Data on the web -------------------------------------------
  {
    slug: "fetching-data",
    skill: "data-on-the-web",
    kind: "concept",
    sortOrder: 0,
    requires: ["js-arrays-objects"],
    version: {
      title: "Fetching data",
      description:
        "Asking a server for data, waiting for it without freezing the page, and showing the three states every request has: loading, loaded, failed.",
      estimatedHours: 5,
    },
  },

  // --- Backend: Servers and HTTP -------------------------------------------
  {
    slug: "http-basics",
    skill: "servers-and-http",
    kind: "concept",
    sortOrder: 0,
    requires: ["js-functions"],
    version: {
      title: "How the web talks",
      description:
        "Requests, responses, methods and status codes — what actually crosses the wire when you open a page.",
      estimatedHours: 4,
    },
  },

  // --- Backend: Routing ----------------------------------------------------
  {
    slug: "routing-in-express",
    skill: "routing",
    kind: "technology",
    technology: "express",
    sortOrder: 0,
    requires: ["http-basics"],
    version: {
      title: "Routing in Express",
      description: "Turning a URL and a method into a handler, and passing a request through middleware.",
      estimatedHours: 6,
    },
  },
  {
    slug: "routing-in-django",
    skill: "routing",
    kind: "technology",
    technology: "django",
    sortOrder: 0,
    requires: ["http-basics"],
    version: {
      title: "Routing in Django",
      description: "Mapping URLs to views, reading parameters, and returning a response.",
      estimatedHours: 6,
    },
  },
];
