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
