/**
 * Lesson content for the seeded modules.
 *
 * The shape is `LessonContent` from design.md §13.3: a block list, where `text`
 * is plain except for `backticks` marking inline code. Nothing here can inject
 * markup into the page, which is why the format has no raw HTML escape hatch.
 *
 * Only the three modules with quizzes are written, because a lesson and its
 * quiz have to agree — a question about something no lesson taught is the kind
 * of thing a learner rightly complains about. The other sixteen modules have
 * published versions and no lessons yet; the module page says so rather than
 * showing an empty reading column.
 *
 * Keyed by module slug, then ordered.
 */

const p = (text) => ({ type: "paragraph", text });
const h = (text) => ({ type: "heading", text });
const code = (language, code, caption) => ({ type: "code", language, code, ...(caption ? { caption } : {}) });
const list = (items, ordered = false) => ({ type: "list", ordered, items });
const note = (text, tone = "info") => ({ type: "callout", tone, text });

export const lessons = {
  "html-basics": [
    {
      title: "What a page is made of",
      blocks: [
        p("An HTML file is a list of elements. Each element wraps some content and says what that content *is* — a heading, a paragraph, a link. The browser reads the file top to bottom and builds the page from it."),
        p("An element is written as an opening tag, the content, and a closing tag:"),
        code("html", "<p>Sharks have been around longer than trees.</p>"),
        p("A few elements have no content and so no closing tag. An image is one:"),
        code("html", '<img src="shark.jpg" alt="A grey reef shark">'),
        h("The shape of every page"),
        p("Every page has the same skeleton. `<head>` holds information about the page; `<body>` holds what you see."),
        code(
          "html",
          `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Sharks</title>
  </head>
  <body>
    <h1>Sharks</h1>
    <p>Older than trees.</p>
  </body>
</html>`,
        ),
        note("`lang=\"en\"` tells a screen reader which language to pronounce the page in. Without it, English can be read aloud with the wrong rules. It costs nine characters."),
      ],
    },
    {
      title: "Saying what content means",
      blocks: [
        p("A `<div>` is a box with no meaning. It is useful when you need somewhere to hang a style and nothing more. Most of the time you want an element that says what the content actually is."),
        p("Compare these two. They can look identical on screen:"),
        code(
          "html",
          `<div class="title">Sharks</div>
<div>Older than trees.</div>`,
          "No meaning: a box, then another box",
        ),
        code(
          "html",
          `<h1>Sharks</h1>
<p>Older than trees.</p>`,
          "Meaning: a top-level heading, then a paragraph",
        ),
        p("The second version tells a screen reader there is a heading, lets a keyboard user jump between headings, and tells a search engine what the page is about. The first tells nobody anything."),
        h("Headings describe an outline"),
        p("Use one `<h1>` for the page, then `<h2>` for its sections, `<h3>` inside those. Do not pick a level because of how big it looks — that is what CSS is for."),
        h("Lists are lists"),
        p("If the content is a list, mark it as one. Three `<br>` elements look like a list and are not:"),
        code(
          "html",
          `<ul>
  <li>Great white</li>
  <li>Hammerhead</li>
  <li>Whale shark</li>
</ul>`,
        ),
        note("A screen reader announces \"list, three items\" for the markup above, and reads three unrelated lines for the `<br>` version.", "notice"),
      ],
    },
    {
      title: "Images, links, and alt text",
      blocks: [
        p("A link goes somewhere. Its text should say where, because people navigating by link list hear the text with no surrounding sentence."),
        code("html", '<a href="/sharks/great-white">Read about great whites</a>'),
        p("\"Click here\" in a list of forty links is forty identical entries."),
        h("Every image needs alt"),
        p("`alt` is the text a screen reader announces, and what shows if the image fails to load. Describe what the image conveys, not what it is:"),
        code("html", '<img src="chart.png" alt="Shark sightings doubled between 2019 and 2024">'),
        p("If an image is purely decorative — a flourish that adds nothing — give it an empty `alt` so it is skipped rather than announced as a filename:"),
        code("html", '<img src="swirl.svg" alt="">'),
        note("An empty `alt=\"\"` and a missing `alt` are different. Missing means \"nobody thought about this\", and a screen reader falls back to reading the file name aloud."),
      ],
    },
  ],

  "css-basics": [
    {
      title: "Selectors and the cascade",
      blocks: [
        p("A CSS rule has a selector — what to style — and a block of declarations — how."),
        code("css", `p {\n  color: #333;\n  line-height: 1.6;\n}`),
        p("When two rules set the same property on the same element, the more specific selector wins, whatever order they are in:"),
        code(
          "css",
          `p { color: black; }
.intro { color: grey; }`,
          "A <p class=\"intro\"> is grey — the class is more specific",
        ),
        p("Only when specificity ties does the later rule win. This is why adding `!important` to fix a stubborn rule usually creates a worse problem a week later."),
        h("Custom properties"),
        p("A custom property is a value defined once and read everywhere:"),
        code(
          "css",
          `:root {
  --space: 8px;
}

.card {
  padding: var(--space);
}`,
        ),
        p("Change `--space` and every use follows. It can also be redefined inside a media query or for dark mode, which a repeated `8px` cannot."),
      ],
    },
    {
      title: "The box model",
      blocks: [
        p("Every element is a box: content, then padding around it, then a border, then margin outside that."),
        p("By default `width` sets the *content* width, so padding and border are added on top. An element with `width: 200px` and `padding: 20px` is 240px wide on screen, which is almost never what anyone wants."),
        code("css", `*, *::before, *::after {\n  box-sizing: border-box;\n}`, "Almost every stylesheet starts with this"),
        p("With `border-box`, `width: 200px` means 200px on screen, padding and border included."),
        h("Margin collapses, padding does not"),
        p("Two stacked elements with 20px margins end up 20px apart, not 40px. Vertical margins collapse into the larger of the two. Padding never does."),
        note("This surprises everyone once. If you need a guaranteed gap, use `gap` in a flex or grid container instead of relying on margins."),
      ],
    },
    {
      title: "Hiding things, and who can still see them",
      blocks: [
        p("There are several ways to hide an element and they are not interchangeable."),
        list([
          "`display: none` — removed from the page and from the accessibility tree. Nobody gets it.",
          "`visibility: hidden` — still takes up space, still not announced.",
          "`opacity: 0` — invisible, still takes up space, still announced, still clickable.",
          "Clipped to a pixel — invisible, announced normally.",
        ]),
        p("That last one is how you give a screen reader text that sighted users do not need:"),
        code(
          "css",
          `.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}`,
        ),
        note("Reach for `display: none` when you mean \"this is not part of the page right now\", and clipping when you mean \"this is for people who cannot see the layout\". Using the first where you meant the second silently removes content.", "notice"),
      ],
    },
  ],

  "js-basics": [
    {
      title: "Values and variables",
      blocks: [
        p("A variable is a name for a value. `let` makes one you can reassign; `const` makes one you cannot."),
        code(
          "javascript",
          `let count = 0;
count = 1;          // fine

const name = "Ada";
name = "Grace";     // TypeError: Assignment to constant variable.`,
        ),
        p("`const` stops the *name* being pointed at something else. It does not freeze the value — the contents of a `const` array can still change:"),
        code(
          "javascript",
          `const sharks = ["great white"];
sharks.push("hammerhead");   // fine — same array, new contents
sharks = [];                 // TypeError — new array`,
        ),
        note("Reach for `const` first and switch to `let` when you find you need to reassign. It makes the few variables that do change stand out."),
      ],
    },
    {
      title: "Comparison, and the two equals",
      blocks: [
        p("JavaScript has two equality operators. `==` converts the operands to the same type before comparing; `===` does not."),
        code(
          "javascript",
          `"2" == 2     // true  — the string is converted first
"2" === 2    // false — a string is not a number`,
        ),
        p("The conversion rules have enough corners that almost every codebase uses `===` everywhere and treats `==` as a mistake."),
        h("Truthy and falsy"),
        p("An `if` converts whatever you give it to true or false. These eight values are falsy; everything else is truthy:"),
        list(["`false`", "`0` and `-0`", "`0n`", "`\"\"` (the empty string)", "`null`", "`undefined`", "`NaN`"]),
        p("Notice what is *not* on that list. An empty array and an empty object are both truthy, and so is the string `\"0\"`:"),
        code(
          "javascript",
          `if ([]) console.log("runs");       // runs
if ("0") console.log("also runs"); // also runs`,
        ),
        note("`typeof null` returns `\"object\"`. That is a bug from the first version of the language, kept because too much code depends on it. Test for null with `value === null`.", "notice"),
      ],
    },
    {
      title: "Control flow",
      blocks: [
        p("`if` runs a block when a condition is truthy, and `else` covers the rest."),
        code(
          "javascript",
          `if (depth > 200) {
  console.log("deep water");
} else if (depth > 20) {
  console.log("open water");
} else {
  console.log("shallow");
}`,
        ),
        h("Loops"),
        p("A `for...of` loop walks the values of anything list-like, which is what you want most of the time:"),
        code(
          "javascript",
          `for (const shark of sharks) {
  console.log(shark);
}`,
        ),
        p("The older counting form is still worth recognising, because off-by-one mistakes live in it:"),
        code(
          "javascript",
          `for (let i = 0; i < sharks.length; i++) {
  console.log(sharks[i]);
}`,
          "Starts at 0, stops before length — both matter",
        ),
        h("Functions return undefined by default"),
        p("A function with no `return` gives back `undefined`. That is a value, so calling it in an expression does not fail — it quietly gives you `undefined`, which usually surfaces much later:"),
        code(
          "javascript",
          `function greet(name) {
  console.log("Hi " + name);
}

const message = greet("Ada");   // message is undefined`,
        ),
      ],
    },
  ],
};
