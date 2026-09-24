/**
 * Lesson content for the seeded modules.
 *
 * The shape is `LessonContent` from design.md §13.3: a block list, where `text`
 * is plain except for `backticks` marking inline code. Nothing here can inject
 * markup into the page, which is why the format has no raw HTML escape hatch.
 *
 * A lesson and its quiz have to agree — a question about something no lesson
 * taught is the kind of thing a learner rightly complains about — so a module
 * gets both or neither.
 *
 * Written: the **core spine**, the nine modules the Roadmap AI puts in front of
 * a learner first. The technology modules (React, Vue, Express, Django) and the
 * later concept modules have published versions and no lessons yet; the module
 * page says so rather than showing an empty reading column.
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

  "forms-and-semantics": [
    {
      title: "Every input needs a label",
      blocks: [
        p("A form is where a page stops talking and starts listening. It is also where accessibility is most often lost, and almost always for the same reason: an input with no label."),
        p("A label is joined to its input by matching `for` and `id`:"),
        code(
          "html",
          `<label for="email">Email address</label>
<input id="email" type="email" name="email">`,
        ),
        p("That join does three things. A screen reader announces \"Email address, edit text\" instead of \"edit text\". Clicking the words focuses the field. And the field now has a name, which every automated accessibility check looks for."),
        h("Placeholder is not a label"),
        p("A placeholder disappears the moment someone types. If it was the only thing naming the field, they are now filling in a box with no name — and so is anyone who came back to check their answers."),
        code(
          "html",
          `<input type="email" placeholder="Email address">`,
          "Wrong: nothing names this field once typing starts",
        ),
        p("Use a placeholder for an example of the format, not for the name:"),
        code(
          "html",
          `<label for="phone">Phone number</label>
<input id="phone" type="tel" placeholder="07700 900123">`,
        ),
        note("If the design has no room for a visible label, the label still exists — clip it to a pixel with the `.visually-hidden` pattern from CSS basics. Hiding it from sight is fine; removing it is not."),
      ],
    },
    {
      title: "The right input for the job",
      blocks: [
        p("`<input>` changes behaviour completely depending on `type`. Picking the right one is the difference between a form that works on a phone and one that fights you."),
        list([
          "`type=\"email\"` — a keyboard with `@` on it, and free format checking",
          "`type=\"tel\"` — a number pad",
          "`type=\"number\"` — for quantities, not for phone numbers or card numbers",
          "`type=\"date\"` — the platform's own date picker, which people already know",
          "`type=\"password\"` — masked, and offered to the password manager",
        ]),
        p("`type=\"number\"` is the one people reach for wrongly. It strips leading zeros and allows `e`, so a phone number or a postcode goes in as `type=\"tel\"` with an `inputmode`."),
        h("Required, and saying why"),
        p("`required` stops submission and the browser explains. You can improve the message, but never remove the explanation:"),
        code(
          "html",
          `<label for="name">Full name</label>
<input id="name" name="name" required aria-describedby="name-hint">
<p id="name-hint">As it appears on your ID.</p>`,
        ),
        p("`aria-describedby` attaches the hint to the field, so it is announced after the label rather than being stranded text nobody hears."),
        h("A button says what it does"),
        p("`<button type=\"submit\">Create account</button>` — not \"Submit\". The word on the button is the last thing someone reads before committing, so it should name the thing they are committing to."),
        note("`<button>` inside a form submits by default. If a button is doing something else, say so with `type=\"button\"`, or it will submit the form the first time someone presses Enter.", "notice"),
      ],
    },
    {
      title: "Landmarks, and saying what a region is",
      blocks: [
        p("A screen reader user can jump between regions of a page the way a sighted user's eye skips to the navigation. That only works if the regions are marked."),
        code(
          "html",
          `<header>…</header>
<nav aria-label="Main">…</nav>
<main>…</main>
<footer>…</footer>`,
        ),
        p("Each of those is a landmark. `<div class=\"header\">` is not — it is a box with a class name only the stylesheet can read."),
        h("One main per page"),
        p("`<main>` is the page's content, and there is exactly one. Two `<main>` elements leave a reader with no reliable place to jump to, which is worse than none."),
        h("Name a landmark when there are two"),
        p("If a page has two `<nav>` elements, they need telling apart:"),
        code(
          "html",
          `<nav aria-label="Main">…</nav>
<nav aria-label="Breadcrumb">…</nav>`,
        ),
        p("Do not put the word \"navigation\" in the label. The role is already announced, so `aria-label=\"Main navigation\"` is read as \"Main navigation navigation\"."),
        note("Test this without a screen reader: unplug the mouse and press Tab through the page. If you cannot tell where you are, or focus disappears behind something, that is a real bug and you just found it in thirty seconds."),
      ],
    },
  ],

  "css-layout": [
    {
      title: "Flexbox lays out one direction",
      blocks: [
        p("Flexbox arranges children along a single axis — a row or a column. Most of the layout you write is this, and grid is for the cases it cannot do."),
        code(
          "css",
          `.toolbar {
  display: flex;
  gap: 12px;
  align-items: center;
}`,
        ),
        p("`gap` is the space between children. It replaces the old habit of putting a margin on every child and then removing it from the last one."),
        h("Two axes, two properties"),
        p("`justify-content` moves children along the main axis; `align-items` moves them across it. In a row, that is horizontal and vertical respectively — and they swap when `flex-direction: column`."),
        code(
          "css",
          `.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}`,
          "Logo left, actions right, both vertically centred",
        ),
        h("Pushing one item away"),
        p("`margin-left: auto` on a single child absorbs all the leftover space before it, which pushes that child and everything after it to the end:"),
        code("css", `.actions { margin-left: auto; }`),
        p("That is often clearer than `space-between`, because it says which element is doing the pushing."),
        note("`flex: 1` means \"take a share of the leftover space\". `flex: 1 1 0` is the same thing written out: grow, shrink, and start from zero rather than from the content's width."),
      ],
    },
    {
      title: "Grid lays out rows and columns together",
      blocks: [
        p("Grid places children in two dimensions at once. Use it when the layout is a grid — a page's columns, a card gallery — and flexbox for everything in a line."),
        code(
          "css",
          `.gallery {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}`,
        ),
        p("`1fr` is one share of the free space. Three equal columns, whatever the container's width."),
        h("Columns that decide their own count"),
        p("This is the line that removes most media queries from a card layout:"),
        code(
          "css",
          `.gallery {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 12px;
}`,
        ),
        p("It reads as: fit as many columns as you can, each at least 240px, sharing what is left. Three columns on a laptop, one on a phone, and nothing in the stylesheet mentions a screen size."),
        h("Naming the regions"),
        p("For a page layout, you can draw it:"),
        code(
          "css",
          `.page {
  display: grid;
  grid-template-columns: 220px 1fr;
  grid-template-areas:
    "sidebar content";
}

.sidebar { grid-area: sidebar; }
.content { grid-area: content; }`,
        ),
        note("`minmax(0, 1fr)` instead of `1fr` is worth knowing: a grid column will not shrink below its content by default, so one long word can push the whole layout wider than the screen. `minmax(0, 1fr)` lets it.", "notice"),
      ],
    },
    {
      title: "One layout that reflows",
      blocks: [
        p("A page should rearrange itself at different widths. It should not become a second page — no separate mobile site, no \"desktop version\" button, no checking what device someone is on."),
        p("Write the narrow layout first, then add what wider screens can afford:"),
        code(
          "css",
          `.page {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

@media (min-width: 640px) {
  .page {
    flex-direction: row;
  }
}`,
          "Mobile first: the stacked version needs no query",
        ),
        p("Mobile-first means the base rules are the simplest ones, and each query adds rather than undoes. Going the other way, every query has to reverse something."),
        h("Let the content decide where it breaks"),
        p("A breakpoint chosen from a phone model is out of date next year. Pick the width where *this* layout starts to look wrong, and put the query there."),
        h("Check at 320px"),
        p("320px is the narrowest width worth supporting, and it is also where a 200%-zoomed laptop lands. If the page scrolls sideways there, something has a fixed width that should be a maximum:"),
        code("css", `img, video { max-width: 100%; }`),
        note("Test by resizing the browser rather than by using the device toolbar. Real reflow bugs show up between the preset sizes, not at them."),
      ],
    },
  ],

  "js-functions": [
    {
      title: "Parameters and return values",
      blocks: [
        p("A function is a piece of behaviour with a name. You write it once and call it wherever you need it."),
        code(
          "javascript",
          `function total(price, quantity) {
  return price * quantity;
}

total(4.5, 3);   // 13.5`,
        ),
        p("`price` and `quantity` are parameters — names for whatever gets passed in. `4.5` and `3` are the arguments."),
        h("Return hands a value back"),
        p("`return` ends the function and gives a value to whoever called it. A function without `return` gives back `undefined`, which is a value, so nothing fails until much later:"),
        code(
          "javascript",
          `function total(price, quantity) {
  price * quantity;          // computed, then thrown away
}

const cost = total(4.5, 3);  // undefined`,
        ),
        h("Defaults for what is usually true"),
        code(
          "javascript",
          `function total(price, quantity = 1) {
  return price * quantity;
}

total(4.5);   // 4.5`,
        ),
        h("One job each"),
        p("A function that fetches data, formats it, and writes it to the page is three functions wearing a coat. Split them and each one can be understood, reused, and tested on its own."),
        note("A good name makes the call site readable without opening the function. `total(price, quantity)` says what comes back; `handleData(x)` says nothing at all."),
      ],
    },
    {
      title: "Scope, and what a function can see",
      blocks: [
        p("A variable declared inside a function exists only inside it. This is what stops two parts of a program quietly overwriting each other's values."),
        code(
          "javascript",
          `function greet() {
  const name = "Ada";
  return "Hi " + name;
}

greet();
console.log(name);   // ReferenceError: name is not defined`,
        ),
        p("A function can see outwards, to the scope it was written in, but nothing can see inwards."),
        h("Blocks have scope too"),
        p("`let` and `const` are scoped to their block — anything between `{` and `}`, including the body of an `if` or a loop:"),
        code(
          "javascript",
          `if (true) {
  const message = "inside";
}

console.log(message);   // ReferenceError`,
        ),
        p("`var` is not block-scoped, which is the main reason it is no longer used."),
        h("Shadowing"),
        p("An inner name hides an outer one of the same name for the length of the inner scope. It is legal and it is usually a mistake — if two things mean different things, give them different names."),
        note("Closures follow from this: a function written inside another keeps access to the outer variables even after the outer function has returned. That is not a special feature, it is just scope outliving the call."),
      ],
    },
    {
      title: "Functions are values",
      blocks: [
        p("A function can be stored in a variable, passed to another function, and returned from one. This is what makes array methods and event handlers work."),
        code(
          "javascript",
          `const double = function (n) {
  return n * 2;
};

const triple = (n) => n * 3;`,
          "The same thing twice: a function stored in a variable",
        ),
        p("An arrow function with a single expression returns it without writing `return`. With braces, you are back to needing one:"),
        code(
          "javascript",
          `const triple = (n) => n * 3;          // returns n * 3
const quiet  = (n) => { n * 3; };    // returns undefined`,
        ),
        h("Passing a function to a function"),
        p("This is why arrow functions are everywhere. The second argument here *is* a function:"),
        code(
          "javascript",
          `[1, 2, 3].map((n) => n * 2);   // [2, 4, 6]`,
        ),
        h("Pass the function, do not call it"),
        p("A common slip: writing `()` after the name hands over the *result* instead of the function."),
        code(
          "javascript",
          `button.addEventListener("click", save);     // correct
button.addEventListener("click", save());   // calls save immediately`,
        ),
        note("The second line runs `save` once, at the moment the listener is attached, and then registers whatever it returned — usually `undefined`. The button then appears to do nothing.", "notice"),
      ],
    },
  ],

  "js-arrays-objects": [
    {
      title: "Making and reading an array",
      blocks: [
        p("An array is an ordered list of values. It keeps them in order, and you reach them by position."),
        code(
          "javascript",
          `const sharks = ["great white", "hammerhead", "whale shark"];

sharks[0];        // "great white"
sharks.length;    // 3`,
        ),
        p("Positions start at zero, so the last item is always at `length - 1`. `sharks[3]` is `undefined`, not an error — which is why an off-by-one mistake tends to surface somewhere else entirely."),
        h("Adding and removing"),
        code(
          "javascript",
          `sharks.push("nurse shark");   // adds to the end
sharks.pop();                 // removes the last and returns it`,
        ),
        p("Both change the array in place. If you want a new array instead, spread the old one into it:"),
        code(
          "javascript",
          `const more = [...sharks, "nurse shark"];   // sharks is untouched`,
        ),
        h("const does not freeze the contents"),
        p("`const` stops the variable being pointed at something else. It does not stop the array changing:"),
        code(
          "javascript",
          `const sharks = ["great white"];
sharks.push("hammerhead");   // fine
sharks = [];                 // TypeError: assignment to constant`,
        ),
        note("This catches everyone once. `const` is about the name, not the value."),
      ],
    },
    {
      title: "Objects and keys",
      blocks: [
        p("An array holds things in order. An object holds them by name, which is what you want as soon as the values mean different things."),
        code(
          "javascript",
          `const shark = {
  name: "Great white",
  lengthM: 4.6,
  endangered: true,
};

shark.name;        // "Great white"
shark["name"];     // the same, when the key is in a variable`,
        ),
        h("Reading something that is not there"),
        p("A missing key is `undefined`, and reading a property *of* `undefined` throws:"),
        code(
          "javascript",
          `shark.colour;            // undefined
shark.habitat.depth;     // TypeError: Cannot read properties of undefined`,
        ),
        p("`?.` stops at the first missing link instead of throwing:"),
        code("javascript", `shark.habitat?.depth;    // undefined`),
        h("Arrays of objects"),
        p("This is the shape almost all real data arrives in — a list of records:"),
        code(
          "javascript",
          `const sharks = [
  { name: "Great white", lengthM: 4.6 },
  { name: "Hammerhead", lengthM: 3.4 },
];

sharks[1].name;   // "Hammerhead"`,
        ),
        h("Pulling values out by name"),
        code(
          "javascript",
          `const { name, lengthM } = shark;`,
          "Destructuring: two variables from one object",
        ),
        note("Objects and arrays are handed around by reference. Two variables pointing at the same object see each other's changes, which is useful right up until it is a bug.", "notice"),
      ],
    },
    {
      title: "map, filter, and reduce",
      blocks: [
        p("These three replace most loops you would otherwise write, and each says what it is doing in its name."),
        h("map: one out for each one in"),
        code(
          "javascript",
          `const names = sharks.map((shark) => shark.name);
// ["Great white", "Hammerhead"]`,
        ),
        p("The result is always the same length as the original. If you find yourself pushing into an array inside a loop, this is usually the line you wanted."),
        h("filter: keep the ones that pass"),
        code(
          "javascript",
          `const big = sharks.filter((shark) => shark.lengthM > 4);
// [{ name: "Great white", lengthM: 4.6 }]`,
        ),
        p("The test returns true or false. The result is a new array — never a shorter version of the old one."),
        h("reduce: many in, one out"),
        code(
          "javascript",
          `const totalLength = sharks.reduce((sum, shark) => sum + shark.lengthM, 0);
// 8`,
        ),
        p("The `0` is where the running total starts. Leave it out and the first item becomes the starting value, which breaks on an empty array."),
        h("They chain"),
        code(
          "javascript",
          `const bigNames = sharks
  .filter((shark) => shark.lengthM > 4)
  .map((shark) => shark.name);`,
        ),
        note("`map` and `filter` return new arrays and leave the original alone. `sort` and `reverse` do not — they change the array in place, so copy first with `[...sharks].sort()` if that matters."),
      ],
    },
  ],

  "js-dom": [
    {
      title: "Finding elements",
      blocks: [
        p("The DOM is the browser's live model of the page. JavaScript reads and changes that model, and the screen follows."),
        code(
          "javascript",
          `const title = document.querySelector("h1");
const cards = document.querySelectorAll(".card");`,
        ),
        p("`querySelector` takes a CSS selector and returns the first match, or `null`. `querySelectorAll` returns all of them."),
        h("null is the normal failure"),
        p("If nothing matches, you get `null` — and the next line is where it goes wrong:"),
        code(
          "javascript",
          `const title = document.querySelector(".titel");   // typo
title.textContent = "Sharks";
// TypeError: Cannot set properties of null`,
        ),
        p("That error message is the single most common one in browser JavaScript, and it almost always means a selector matched nothing."),
        h("The script has to run after the element exists"),
        p("A script in `<head>` runs before the body is parsed, so nothing it looks for is there yet. Either put the script at the end of the body, or mark it `defer`:"),
        code("html", `<script src="app.js" defer></script>`),
        h("A NodeList is not quite an array"),
        p("`querySelectorAll` returns a NodeList. It can be looped over with `forEach`, but it has no `map` or `filter` until you convert it:"),
        code("javascript", `const cards = [...document.querySelectorAll(".card")];`),
        note("Prefer selecting by something meaningful — a `data-` attribute or a role — over a styling class. A class is for the stylesheet, and renaming it should not break behaviour."),
      ],
    },
    {
      title: "Changing the page",
      blocks: [
        p("Once you have an element, you can change its text, its attributes, and its classes."),
        code(
          "javascript",
          `title.textContent = "Sharks";
image.setAttribute("alt", "A grey reef shark");
card.classList.add("is-open");`,
        ),
        h("textContent, not innerHTML"),
        p("`textContent` puts a string on the page as text. `innerHTML` parses it as markup — so any HTML inside it becomes real elements:"),
        code(
          "javascript",
          `name.textContent = userInput;   // safe: shown exactly as typed
name.innerHTML  = userInput;    // unsafe: markup in the input runs`,
        ),
        p("If the string came from a person, a database, or an API, `innerHTML` is how a cross-site scripting bug gets in. Use `textContent` unless you are certain, and you rarely are."),
        h("Building new elements"),
        code(
          "javascript",
          `const item = document.createElement("li");
item.textContent = shark.name;
list.append(item);`,
        ),
        h("Change classes, not styles"),
        p("Setting `element.style.color` scatters design decisions through your JavaScript. Toggle a class and let the stylesheet decide what it looks like:"),
        code("javascript", `panel.classList.toggle("is-open", isOpen);`),
        note("Every change to the DOM makes the browser do work. Building ten elements and appending them once is cheaper than appending ten times inside a loop."),
      ],
    },
    {
      title: "Events: responding to people",
      blocks: [
        p("An event is something that happened — a click, a keypress, a form submission. You react by attaching a listener."),
        code(
          "javascript",
          `button.addEventListener("click", () => {
  panel.classList.toggle("is-open");
});`,
        ),
        h("The event object"),
        p("The listener receives an object describing what happened:"),
        code(
          "javascript",
          `form.addEventListener("submit", (event) => {
  event.preventDefault();      // stop the page reloading
  console.log(event.target);   // the form
});`,
        ),
        p("`preventDefault()` stops the browser's own behaviour — submitting the form, following the link — so you can do it yourself."),
        h("Use click, not keydown"),
        p("A `click` listener on a `<button>` fires for a mouse, for Enter, for Space, and for a screen reader's activate command. Rebuilding that with `keydown` gets one of them wrong:"),
        code(
          "html",
          `<button type="button">Show details</button>`,
          "A real button. A <div> with a click handler reaches no keyboard.",
        ),
        h("One listener for many elements"),
        p("Events bubble up, so a listener on a container can handle all its children — including ones added later:"),
        code(
          "javascript",
          `list.addEventListener("click", (event) => {
  const item = event.target.closest("li");
  if (!item) return;
  open(item.dataset.id);
});`,
        ),
        note("If you find yourself adding a `tabindex` and a `keydown` handler to a `<div>`, stop and use a `<button>`. It is less code and it is correct for everyone."),
      ],
    },
  ],

  "git-basics": [
    {
      title: "Commits and history",
      blocks: [
        p("Git records your work as a series of snapshots. Each one is a commit: what the files looked like at that moment, who made it, and why."),
        p("A file moves through three places. The working tree is what you are editing; the staging area is what you have chosen to include; the repository is what has been committed."),
        code(
          "bash",
          `git status              # what changed, and what is staged
git add index.html      # stage one file
git commit -m "Add the shark list"`,
        ),
        h("Staging is a feature, not a chore"),
        p("Staging lets you commit part of what you changed. If you fixed a bug and also renamed a variable, they can be two commits, and a reader can follow each one."),
        code("bash", `git add -p              # choose hunk by hunk`),
        h("Reading the history"),
        code(
          "bash",
          `git log --oneline       # one line per commit
git show a1b2c3d        # everything one commit changed
git diff                # what you have changed but not staged`,
        ),
        h("Undoing, safely"),
        p("Almost everything in Git is recoverable once it is committed. The dangerous commands are the ones that touch work you have *not* committed:"),
        code(
          "bash",
          `git restore index.html          # throw away uncommitted changes — no undo
git revert a1b2c3d              # new commit that undoes an old one — safe`,
        ),
        note("Commit early and often. An uncommitted change is the only kind Git cannot get back for you.", "notice"),
      ],
    },
    {
      title: "A message someone can read back",
      blocks: [
        p("A commit message is written once and read many times — by a reviewer, by whoever bisects a bug next year, by you in three weeks with no memory of this afternoon."),
        p("Write the subject as an instruction, in the present tense, saying what the commit does:"),
        code(
          "text",
          `Add alt text to the species images

The gallery images had no alt, so a screen reader read out
the file names. Described what each photo shows instead.`,
        ),
        h("The subject line"),
        list([
          "Around 50 characters, so it is not truncated in a list",
          "Present tense: \"Add\", not \"Added\" or \"Adds\"",
          "No full stop — it is a title, not a sentence",
          "Say what changed, not which file: \"Fix the total on empty carts\", not \"Update cart.js\"",
        ]),
        h("The body explains why"),
        p("The diff already shows what changed. What it cannot show is why — what was wrong, what else you tried, what you decided not to do. That is what the body is for, and it is the part people thank you for."),
        h("One commit, one idea"),
        p("\"Fix login and update the footer and bump deps\" cannot be reviewed, reverted, or described. Three commits can be all three."),
        note("A useful test: if the subject needs the word \"and\", it is probably two commits."),
      ],
    },
    {
      title: "Pushing to GitHub",
      blocks: [
        p("So far everything is on your machine. A remote is a copy somewhere else — usually GitHub — that you push to and pull from."),
        code(
          "bash",
          `git remote -v                    # which remotes exist
git push origin main             # send your commits up
git pull                         # bring other people's down`,
        ),
        p("`origin` is the conventional name for the remote you cloned from. `main` is the branch."),
        h("Push does not save your work"),
        p("Pushing sends commits that already exist. Changes you have not committed stay on your machine, however many times you push — which is worth knowing before you rely on a push as a backup."),
        h("What not to commit"),
        p("A `.gitignore` lists what Git should leave alone:"),
        code(
          "text",
          `node_modules/
.env
dist/`,
        ),
        p("`.env` is the important line. A committed secret is in the history for good — rotating the key is the only real fix, because deleting the file in a later commit leaves the old one intact."),
        h("Your first commit"),
        code(
          "bash",
          `git init
git add .
git commit -m "First commit"
git remote add origin https://github.com/you/project.git
git push -u origin main`,
        ),
        note("`-u` sets the upstream once, so later pushes are just `git push`. You will use this exact sequence for your capstone repository."),
      ],
    },
  ],
  "git-branching": [
    {
      title: "A branch is a pointer",
      blocks: [
        p("A branch is not a copy of your project. It is a label pointing at one commit, and it moves forward as you add more."),
        p("That is why making one is instant, however large the repository:"),
        code(
          "bash",
          `git switch -c fix-empty-cart    # new branch, and move onto it
git switch main                 # back to where you were`,
        ),
        p("`main` still points where it did. Your commits went onto the new label, and the two histories share everything up to the point they parted."),
        h("Why bother"),
        p("Because `main` should always be something you could ship. A branch lets you write something half-finished, leave it overnight, and come back — without anyone else seeing a broken page."),
        h("Where am I"),
        code(
          "bash",
          `git branch                      # list, with a * on the current one
git switch -                    # back to the previous branch`,
        ),
        note("`git switch` and `git restore` replaced most of what `git checkout` used to do. `checkout` still works and still does both jobs, which is exactly why it confused people for a decade."),
      ],
    },
    {
      title: "Merging, and what a conflict really is",
      blocks: [
        p("Merging brings one branch's commits into another. You stand on the branch that should receive them:"),
        code(
          "bash",
          `git switch main
git merge fix-empty-cart`,
        ),
        p("If `main` has not moved since you branched, Git just slides the label forward — a fast-forward, with no merge commit."),
        h("A conflict is a question, not a failure"),
        p("If both branches changed the same lines, Git stops and asks. It marks the file with both versions:"),
        code(
          "text",
          `<<<<<<< HEAD
const total = items.length;
=======
const total = items.reduce((n, i) => n + i.qty, 0);
>>>>>>> fix-empty-cart`,
        ),
        p("Above the `=======` is what is on the branch you are merging into; below it is what is coming in. Delete the markers, leave the code you want — which may be a mix of both — then:"),
        code(
          "bash",
          `git add cart.js
git commit`,
        ),
        h("Backing out"),
        p("Nothing is lost while a merge is in progress. If it is going badly, stop:"),
        code("bash", `git merge --abort`),
        note("Conflicts get smaller the more often you merge. A branch left for three weeks conflicts with everything; a branch merged daily barely conflicts at all.", "notice"),
      ],
    },
    {
      title: "Working with other people",
      blocks: [
        p("On a shared project you rarely merge into `main` yourself. You push your branch and open a pull request, and someone reads it before it lands."),
        code(
          "bash",
          `git push -u origin fix-empty-cart`,
        ),
        p("GitHub then offers to open the pull request. The branch name and the commit messages are the first thing a reviewer sees, which is the practical reason both are worth writing carefully."),
        h("Keeping up with main"),
        p("While you work, `main` moves. Bring it into your branch rather than letting the gap grow:"),
        code(
          "bash",
          `git switch fix-empty-cart
git fetch origin
git merge origin/main`,
        ),
        p("`fetch` downloads without changing your files; `merge` is the step that touches them. `git pull` is the two together, which is convenient until you wanted to look first."),
        h("Never rewrite shared history"),
        p("`git rebase` and `git push --force` rewrite commits. On a branch only you have, that is tidy. On a branch someone else has pulled, it deletes history under them:"),
        code("bash", `git push --force-with-lease    # refuses if someone else pushed first`),
        note("`--force-with-lease` instead of `--force` is a small habit that has saved a lot of work. It checks the remote is where you last saw it before overwriting anything."),
      ],
    },
  ],
};
