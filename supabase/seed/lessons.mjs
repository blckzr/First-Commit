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
  "what-are-components": [
    {
      title: "One description, many uses",
      blocks: [
        p("You have built a page by finding elements and changing them. That works until the same piece of interface appears in four places, and a change has to be made four times."),
        p("A component is the answer every framework landed on: describe a piece of interface once, as a function of its inputs, and use it wherever you need it."),
        code(
          "javascript",
          `function card(shark) {
  const el = document.createElement("article");
  el.innerHTML = "";
  el.append(heading(shark.name), paragraph(shark.summary));
  return el;
}

list.append(card(greatWhite), card(hammerhead));`,
          "The idea in plain JavaScript, before any framework",
        ),
        h("Why this shape"),
        p("Because the same input always produces the same output, you can look at one function and know what it draws. No hunting through the page for the other three places that also set that heading."),
        h("Components nest"),
        p("A page is a component made of components. A card holds a heading and a button; a list holds cards; a screen holds the list and a sidebar. Each level only knows about the one below it."),
        note("This is the same instinct as a function in the last module. A component is a function whose return value happens to be a piece of interface."),
      ],
    },
    {
      title: "Props: what a component is told",
      blocks: [
        p("A component takes inputs. They are conventionally called props, short for properties, and they come from whoever is using the component."),
        code(
          "javascript",
          `card({ name: "Great white", summary: "Older than trees." });
card({ name: "Hammerhead", summary: "Eyes on stalks." });`,
        ),
        p("One description, two cards. The component does not know or care where the data came from."),
        h("Props flow one way"),
        p("A parent passes props down to a child. The child does not reach back up and change them. This is the single rule that makes a large interface possible to reason about: if a value looks wrong on screen, it came from above, so you only have to look in one direction."),
        h("A child asks, it does not take"),
        p("When a child needs something to change, it tells the parent — usually by calling a function the parent passed down:"),
        code(
          "javascript",
          `card({
  name: "Great white",
  onSelect: () => open("great-white"),
});`,
        ),
        p("The parent owns the decision. The child owns the button."),
        note("If you find yourself wanting a child to edit a prop directly, the value probably belongs to the parent and the child needs a callback instead. Every framework in this course makes props read-only for exactly this reason.", "notice"),
      ],
    },
    {
      title: "State: what a component remembers",
      blocks: [
        p("Props are what a component is told. State is what it remembers between one moment and the next — whether a panel is open, what someone has typed, which tab is selected."),
        p("The difference decides your design, so it is worth a clear test:"),
        list([
          "Can it be worked out from props? Then it is not state — calculate it.",
          "Does it survive being re-drawn, and does the component own it? Then it is state.",
          "Do two components need it? Then it belongs to their nearest shared parent, not to either of them.",
        ]),
        h("Lifting state up"),
        p("That third case is the one people meet first. Two cards both need to know which card is selected, so neither of them can own it — the list above them does, and passes it down:"),
        code(
          "javascript",
          `// the list remembers
let selected = null;

// each card is told
card({ name: "Great white", isSelected: selected === "great-white" });`,
        ),
        h("Derived values are not state"),
        p("A total, a filtered list, a formatted date — all of these can be worked out when needed. Storing them means two things to keep in step, and one day they will not be:"),
        code(
          "javascript",
          `const total = items.reduce((n, i) => n + i.price, 0);   // derive it
// not: let total = 0; and remember to update it everywhere`,
        ),
        note("Everything in this lesson is true of React, Vue, Svelte and the rest. Only the syntax changes after this — which is why this module sits before you choose one."),
      ],
    },
  ],

  "http-basics": [
    {
      title: "A request and a response",
      blocks: [
        p("Opening a page is a conversation. Your browser sends a request; a server sends back a response. Everything else in this module is detail on those two messages."),
        code(
          "text",
          `GET /sharks/great-white HTTP/1.1
Host: example.com
Accept: text/html`,
          "A request: a method, a path, and some headers",
        ),
        code(
          "text",
          `HTTP/1.1 200 OK
Content-Type: text/html; charset=utf-8

<!doctype html>…`,
          "A response: a status, some headers, a blank line, then the body",
        ),
        h("Each request stands alone"),
        p("HTTP is stateless: the server does not remember your last request. Anything that has to persist — who you are signed in as — travels with every request, usually in a cookie or an Authorization header."),
        h("A page is many requests"),
        p("One page is rarely one request. The HTML arrives first, and the browser then requests every stylesheet, script, font and image it mentions. Open the Network tab and watch it happen once; it explains most performance advice you will ever read."),
        note("You can read a real request and response in your browser's Network tab, on any page, right now. Nothing in this module is hidden from you."),
      ],
    },
    {
      title: "Methods, and what they promise",
      blocks: [
        p("The method says what kind of thing the request is. There are many; four carry almost all the traffic."),
        list([
          "`GET` — read something. Changes nothing.",
          "`POST` — create something, or ask the server to do something.",
          "`PUT` / `PATCH` — replace or amend something that exists.",
          "`DELETE` — remove something.",
        ]),
        h("Safe and idempotent"),
        p("`GET` is *safe*: it must not change anything. Browsers, caches and crawlers all assume this, so a link that deletes a record will eventually be followed by something that is not a person."),
        p("`PUT` and `DELETE` are *idempotent*: sending the same one twice leaves the same result as sending it once. `POST` is not, which is why a double-click on a form can create two orders."),
        code(
          "text",
          `GET  /orders/42      → the order
POST /orders         → a new order, every time it is sent`,
        ),
        h("The method is a promise to everyone else"),
        p("Nothing forces a `GET` handler to behave. But proxies cache `GET`, browsers re-send it on a back button, and prefetchers follow it before anyone clicks. Breaking the promise breaks things you do not control."),
        note("This is why a sign-out link should be a form with a `POST`, not an `<a href>`. A link-prefetcher can sign your users out.", "notice"),
      ],
    },
    {
      title: "Status codes, headers, and the body",
      blocks: [
        p("The status code is the response in one number. The first digit is the category, and knowing the five is enough to debug most things."),
        list([
          "`2xx` — it worked. `200 OK`, `201 Created`, `204 No Content`.",
          "`3xx` — look elsewhere. `301` permanent, `302`/`303` temporary.",
          "`4xx` — the request was wrong. `400`, `401`, `403`, `404`, `409`, `429`.",
          "`5xx` — the server was wrong. `500`, `502`, `503`.",
        ]),
        h("401 and 403 are different"),
        p("`401 Unauthorized` means *we do not know who you are* — sign in. `403 Forbidden` means *we know, and you still cannot* — signing in again will not help. Sending the wrong one sends people round a loop."),
        h("404 over 403, sometimes"),
        p("Telling someone a record exists but is not theirs is itself a leak — it confirms the record exists. For another person's data, `404` is often the honest answer."),
        h("Headers carry the metadata"),
        p("`Content-Type` says what the body is, and the browser believes it. `Cache-Control` says how long it may be reused. `Set-Cookie` asks the browser to remember something and send it back."),
        code(
          "text",
          `Content-Type: application/json
Cache-Control: no-store`,
        ),
        note("`Content-Type: application/json` on an HTML body does not make it JSON. The header is a claim, and everything downstream acts on the claim rather than on the bytes."),
      ],
    },
  ],

  "fetching-data": [
    {
      title: "Waiting without freezing the page",
      blocks: [
        p("Asking a server for data takes time — tens of milliseconds on a good day, several seconds on a train. JavaScript does not wait; it starts the request and carries on, and deals with the answer when it arrives."),
        p("A promise is that future answer. `await` is how you read it:"),
        code(
          "javascript",
          `async function loadSharks() {
  const response = await fetch("/api/sharks");
  const sharks = await response.json();
  return sharks;
}`,
        ),
        p("`await` pauses this function, not the page. Everything else — clicks, animations, other requests — keeps running."),
        h("await only works inside async"),
        p("A function containing `await` must be marked `async`, and calling it gives you a promise rather than the value:"),
        code(
          "javascript",
          `const sharks = loadSharks();          // a Promise
const sharks = await loadSharks();    // the array`,
        ),
        h("Two requests that do not depend on each other"),
        p("Awaiting one after the other makes the second wait for no reason. Start both, then wait:"),
        code(
          "javascript",
          `const [sharks, rays] = await Promise.all([
  fetch("/api/sharks").then((r) => r.json()),
  fetch("/api/rays").then((r) => r.json()),
]);`,
        ),
        note("An `async` function always returns a promise, even when its body has no `await` and returns a plain number. That surprises people once, usually in a test."),
      ],
    },
    {
      title: "fetch, and what can go wrong",
      blocks: [
        p("`fetch` makes the request. Reading the response takes a second step, because the body arrives separately from the headers:"),
        code(
          "javascript",
          `const response = await fetch("/api/sharks");
const sharks = await response.json();`,
        ),
        h("fetch does not throw on 404"),
        p("This is the one that catches everyone. A `404` or a `500` is a *successful* request — the server answered. `fetch` only rejects when it could not ask at all: no network, bad host, request blocked."),
        code(
          "javascript",
          `const response = await fetch("/api/sharks");
if (!response.ok) {
  throw new Error("The server said " + response.status);
}`,
        ),
        p("`response.ok` is true for any `2xx`. Without that check, a `500` returning an HTML error page reaches `.json()` and fails with a parse error that says nothing about the real problem."),
        h("Sending data"),
        code(
          "javascript",
          `await fetch("/api/sharks", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ name: "Nurse shark" }),
});`,
        ),
        p("The body must be a string, and the header has to say what kind — the server has no other way to know."),
        note("Two things are not the same: `response.ok` is about the status code, and `try/catch` around `fetch` is about whether the request happened at all. Real code needs both.", "notice"),
      ],
    },
    {
      title: "Loading, loaded, failed",
      blocks: [
        p("Every request has three outcomes and a page has to show all three. Interfaces that only draw the happy one are the most common bug in this whole area."),
        code(
          "javascript",
          `let state = { status: "loading", data: null, error: null };

try {
  const response = await fetch("/api/sharks");
  if (!response.ok) throw new Error("Status " + response.status);
  state = { status: "loaded", data: await response.json(), error: null };
} catch (err) {
  state = { status: "failed", data: null, error: err.message };
}`,
        ),
        p("Modelling it as one `status` rather than two booleans means you cannot end up loading *and* failed at once — a state that should not exist should not be representable."),
        h("Loaded and empty is not failed"),
        p("A successful request that returns zero results is a fourth thing. \"No sharks match that search\" is a normal answer; \"Something went wrong\" is not, and saying the second when you mean the first sends people looking for a problem that is not there."),
        h("What an error message should say"),
        p("Not the status code. Say what happened, whether their work is safe, and what they can do:"),
        code(
          "text",
          `We could not load your sharks. Nothing you have saved is lost —
try again in a moment.`,
        ),
        note("Announce the result in a live region so it reaches a screen reader. A spinner that is replaced by content silently is an update nobody was told about."),
      ],
    },
  ],
  "components-in-react": [
    {
      title: "A component is a function that returns markup",
      blocks: [
        p("In React a component is a function. It takes props and returns a description of what should be on screen."),
        code(
          "jsx",
          `function Card({ name, summary }) {
  return (
    <article className="card">
      <h2>{name}</h2>
      <p>{summary}</p>
    </article>
  );
}`,
        ),
        p("That markup is JSX. It is not HTML and it is not a string — it compiles to function calls, which is why a component name must start with a capital letter: lowercase means an HTML element."),
        h("Braces switch to JavaScript"),
        p("Anything inside `{ }` is an expression. That is how a value gets into the markup, and it is why there is no templating language to learn:"),
        code("jsx", `<h2>{name.toUpperCase()}</h2>`),
        h("Two names that are not HTML"),
        p("`class` and `for` are reserved words in JavaScript, so JSX uses `className` and `htmlFor`. Everything else is close enough to HTML that you will forget these two once and then remember forever."),
        h("Using a component"),
        code(
          "jsx",
          `<Card name="Great white" summary="Older than trees." />`,
        ),
        note("A component returns one element. If you need two side by side with no wrapper, use a fragment: `<>…</>`."),
      ],
    },
    {
      title: "Props, and children",
      blocks: [
        p("Props arrive as one object. Destructuring it in the parameter list names what this component actually uses, which doubles as documentation:"),
        code(
          "jsx",
          `function Card({ name, summary, onSelect }) { … }`,
        ),
        p("Anything can be a prop — a string, a number, an array, another component, a function. Non-strings go in braces:"),
        code(
          "jsx",
          `<Card name="Great white" lengthM={4.6} onSelect={() => open("gw")} />`,
        ),
        h("Props are read-only"),
        p("A component must not assign to its props. React does not stop you, but the parent owns that value and will overwrite it on the next render — so the change appears to work and then vanishes."),
        h("children is whatever you wrapped"),
        p("Content between the tags arrives as the `children` prop, which is how you write a component that wraps other things:"),
        code(
          "jsx",
          `function Panel({ title, children }) {
  return (
    <section>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

<Panel title="Sharks">
  <Card name="Great white" />
</Panel>`,
        ),
        note("A default for a missing prop goes in the destructuring: `function Card({ summary = \"No description yet.\" })`."),
      ],
    },
    {
      title: "Lists and conditionals",
      blocks: [
        p("There is no `v-if` or `{% for %}` in React — the markup is JavaScript, so you use JavaScript."),
        h("A list is map"),
        code(
          "jsx",
          `<ul>
  {sharks.map((shark) => (
    <li key={shark.id}>{shark.name}</li>
  ))}
</ul>`,
        ),
        h("key is not decoration"),
        p("`key` tells React which item is which between renders. Without it, React matches by position — so inserting at the top makes every row appear to change, and any typing inside them follows the wrong item."),
        p("Use a stable id from your data. **Not the array index**, which is the position you were trying not to rely on:"),
        code(
          "jsx",
          `{sharks.map((shark, i) => <li key={i}>…</li>)}   // no better than nothing`,
        ),
        h("Showing something conditionally"),
        code(
          "jsx",
          `{error && <p role="alert">{error}</p>}
{isLoading ? <Spinner /> : <List items={sharks} />}`,
        ),
        h("The zero trap"),
        p("`&&` returns the left value when it is falsy, and React renders `0` as the number zero. An empty list then puts a stray \"0\" on the page:"),
        code(
          "jsx",
          `{sharks.length && <List />}        // renders 0 when empty
{sharks.length > 0 && <List />}    // renders nothing`,
        ),
        note("`false`, `null` and `undefined` all render as nothing. `0` and `NaN` do not, which is why that first line is a real bug and not a style preference.", "notice"),
      ],
    },
  ],

  "components-in-vue": [
    {
      title: "A single-file component",
      blocks: [
        p("In Vue a component is a `.vue` file with up to three blocks: the logic, the markup, and the styles that belong to it."),
        code(
          "vue",
          `<script setup>
defineProps({ name: String, summary: String });
</script>

<template>
  <article class="card">
    <h2>{{ name }}</h2>
    <p>{{ summary }}</p>
  </article>
</template>

<style scoped>
.card { padding: 16px; }
</style>`,
        ),
        p("The template is real HTML with additions, so `class` and `for` are spelled the way they are in HTML."),
        h("Two braces interpolate"),
        p("`{{ }}` puts a value into the text. It takes an expression, not a statement:"),
        code("vue", `<h2>{{ name.toUpperCase() }}</h2>`),
        h("scoped styles"),
        p("`<style scoped>` applies only inside this component. That is the whole answer to \"which stylesheet is this rule in\" — it is in the file you are already looking at."),
        h("Using a component"),
        code(
          "vue",
          `<script setup>
import Card from "./Card.vue";
</script>

<template>
  <Card name="Great white" summary="Older than trees." />
</template>`,
        ),
        note("`<script setup>` is the modern form. Older tutorials show `export default { … }` with an `components: { }` list — the same ideas, more ceremony."),
      ],
    },
    {
      title: "Props, and slots",
      blocks: [
        p("`defineProps` declares what a component takes. Declaring the type is not optional decoration — it is how Vue warns you when a parent passes the wrong thing:"),
        code(
          "vue",
          `<script setup>
defineProps({
  name: { type: String, required: true },
  lengthM: { type: Number, default: 0 },
});
</script>`,
        ),
        h("Binding a non-string"),
        p("A plain attribute passes a string. `:` (short for `v-bind:`) passes the value:"),
        code(
          "vue",
          `<Card name="Great white" :length-m="4.6" />`,
        ),
        p("Props are written `kebab-case` in the template and read `camelCase` in the script. Vue converts between them."),
        h("Props are read-only"),
        p("Assigning to a prop is a warning in development and a bug in production — the parent owns the value and will overwrite it on the next update."),
        h("slots are whatever you wrapped"),
        code(
          "vue",
          `<!-- Panel.vue -->
<template>
  <section>
    <h2>{{ title }}</h2>
    <slot />
  </section>
</template>

<!-- using it -->
<Panel title="Sharks">
  <Card name="Great white" />
</Panel>`,
        ),
        note("A slot is Vue's `children`. Named slots — `<slot name=\"footer\" />` — let one component take content in several places, which props cannot do cleanly."),
      ],
    },
    {
      title: "Lists and conditionals",
      blocks: [
        p("Vue puts these in the template as directives, which keeps the markup readable as markup."),
        h("A list is v-for"),
        code(
          "vue",
          `<ul>
  <li v-for="shark in sharks" :key="shark.id">
    {{ shark.name }}
  </li>
</ul>`,
        ),
        h("key is not decoration"),
        p("`:key` tells Vue which item is which between updates. Without it, Vue matches by position — so inserting at the top makes every row appear to change, and any typing inside them follows the wrong item."),
        p("Use a stable id from your data. **Not the loop index**, which is the position you were trying not to rely on."),
        h("Showing something conditionally"),
        code(
          "vue",
          `<p v-if="error" role="alert">{{ error }}</p>
<Spinner v-else-if="isLoading" />
<List v-else :items="sharks" />`,
        ),
        h("v-if and v-show are different"),
        p("`v-if` removes the element from the page entirely. `v-show` leaves it there with `display: none`. Use `v-if` unless you are toggling often enough that rebuilding it costs more than keeping it."),
        code(
          "vue",
          `<Panel v-if="isOpen" />      <!-- not in the DOM when closed -->
<Panel v-show="isOpen" />    <!-- in the DOM, hidden -->`,
        ),
        note("Do not put `v-if` and `v-for` on the same element — the precedence between them is a known trap. Wrap with a `<template v-if>` instead.", "notice"),
      ],
    },
  ],
  "state-and-props-react": [
    {
      title: "useState: what a component remembers",
      blocks: [
        p("A plain variable inside a component is thrown away on every render. State is the value that survives, and changing it is what asks for the next render."),
        code(
          "jsx",
          `import { useState } from "react";

function Counter() {
  const [count, setCount] = useState(0);

  return (
    <button onClick={() => setCount(count + 1)}>
      Clicked {count} times
    </button>
  );
}`,
        ),
        p("`useState` gives back the current value and a function to replace it. `0` is only the starting value — it is ignored on every render after the first."),
        h("Never assign to state"),
        code(
          "jsx",
          `count = count + 1;        // nothing re-renders
setCount(count + 1);      // correct`,
        ),
        h("Updates are not immediate"),
        p("`setCount` schedules a render; it does not change `count` in the line below. Reading it straight after gives the old value, which is the single most reported \"bug\" in React:"),
        code(
          "jsx",
          `setCount(count + 1);
console.log(count);       // still the old number`,
        ),
        h("Base a new value on the old one safely"),
        p("Two updates in the same event both read the same stale `count`, so the second overwrites the first. Pass a function instead and each one gets the latest:"),
        code(
          "jsx",
          `setCount((n) => n + 1);
setCount((n) => n + 1);   // now definitely +2`,
        ),
        note("Treat state as read-only. `items.push(x)` then `setItems(items)` changes nothing on screen, because it is the same array — React compares identities. Use `setItems([...items, x])`.", "notice"),
      ],
    },
    {
      title: "Lifting state up",
      blocks: [
        p("When two components need the same value, neither can own it. It moves to their nearest shared parent, and comes back down as props."),
        code(
          "jsx",
          `function Filters() {
  const [query, setQuery] = useState("");

  return (
    <>
      <SearchField value={query} onChange={setQuery} />
      <Results query={query} />
    </>
  );
}`,
        ),
        p("`SearchField` is told the value and given a way to ask for a new one. `Results` is told the same value. Neither remembers anything, and they cannot disagree."),
        h("Controlled inputs"),
        p("An input whose value comes from state is controlled — React owns what is in the box:"),
        code(
          "jsx",
          `<input value={query} onChange={(e) => setQuery(e.target.value)} />`,
        ),
        p("Pass `value` without `onChange` and the field is frozen: every keystroke re-renders it back to the state that never changed. React warns about this in development."),
        h("Do not copy props into state"),
        p("This looks harmless and is a common bug:"),
        code(
          "jsx",
          `const [name, setName] = useState(props.name);   // frozen at the first render`,
        ),
        p("`useState` ignores its argument after the first render, so when the prop changes the copy does not. If a value comes from above, read it from above."),
        note("A good check: if two components ever show different answers to the same question, the value is stored in two places and one of them should be a prop."),
      ],
    },
    {
      title: "Effects, and when you do not need one",
      blocks: [
        p("`useEffect` runs code after a render, for things outside React — a network request, a subscription, a timer."),
        code(
          "jsx",
          `useEffect(() => {
  let cancelled = false;

  fetch("/api/sharks")
    .then((r) => r.json())
    .then((data) => { if (!cancelled) setSharks(data); });

  return () => { cancelled = true; };
}, []);`,
        ),
        p("The array is the dependency list: `[]` means run once after the first render. Leave it out entirely and the effect runs after *every* render — including the one it caused, which is an infinite loop."),
        h("The cleanup function"),
        p("The returned function runs before the next effect and when the component goes away. It is what stops a slow response arriving after the learner has navigated elsewhere and setting state on nothing."),
        h("Most effects should not exist"),
        p("If a value can be worked out from props and state, calculate it during render — no effect, no extra state, nothing to keep in step:"),
        code(
          "jsx",
          `const visible = sharks.filter((s) => s.name.includes(query));   // just do it`,
        ),
        p("An effect that sets state from other state is the shape to watch for. It renders twice and can drift."),
        note("Effects are for reaching outside React. If nothing outside React is involved, there is usually a simpler answer one line up."),
      ],
    },
  ],

  "state-and-props-vue": [
    {
      title: "ref: what a component remembers",
      blocks: [
        p("A plain variable in `<script setup>` is not reactive — changing it updates nothing. `ref` wraps a value so Vue can watch it."),
        code(
          "vue",
          `<script setup>
import { ref } from "vue";

const count = ref(0);
</script>

<template>
  <button @click="count++">Clicked {{ count }} times</button>
</template>`,
        ),
        h(".value in script, not in the template"),
        p("A `ref` holds its value in `.value`. The template unwraps it for you; your script does not:"),
        code(
          "vue",
          `count.value++;        // in <script>
{{ count }}           // in <template> — no .value`,
        ),
        p("Forgetting `.value` in script is the mistake everyone makes first. It fails quietly: you are incrementing an object, not a number."),
        h("reactive, for objects"),
        code(
          "vue",
          `import { reactive } from "vue";

const filters = reactive({ query: "", onlyBig: false });
filters.query = "hammer";     // no .value`,
        ),
        p("`reactive` takes an object and needs no `.value`, but it cannot be reassigned wholesale and does not survive destructuring. Most code uses `ref` for everything and accepts the `.value`."),
        h("Updates are batched"),
        p("Changing a ref schedules an update rather than applying it immediately. If you need the DOM after it lands, wait for it:"),
        code(
          "vue",
          `import { nextTick } from "vue";

count.value++;
await nextTick();
// the DOM now reflects the new count`,
        ),
        note("`ref` replaces the whole value and tracks it. `reactive` tracks properties of one object. Mixing both in one component is legal and usually confusing — pick one per file.", "notice"),
      ],
    },
    {
      title: "Lifting state up, and emits",
      blocks: [
        p("When two components need the same value, it moves to their nearest shared parent and comes back down as props."),
        code(
          "vue",
          `<script setup>
import { ref } from "vue";
const query = ref("");
</script>

<template>
  <SearchField :value="query" @change="query = $event" />
  <Results :query="query" />
</template>`,
        ),
        h("A child asks with emit"),
        p("A child cannot write to a prop, so it emits an event and the parent decides what to do:"),
        code(
          "vue",
          `<script setup>
defineProps({ value: String });
const emit = defineEmits(["change"]);
</script>

<template>
  <input :value="value" @input="emit('change', $event.target.value)">
</template>`,
        ),
        h("v-model is those two together"),
        p("`v-model` is shorthand for passing a value down and listening for the update coming back:"),
        code(
          "vue",
          `<input v-model="query">                  <!-- on an element -->
<SearchField v-model="query" />          <!-- on a component -->`,
        ),
        p("On a component it passes `modelValue` and listens for `update:modelValue`, which is worth knowing the first time you write one yourself."),
        h("Do not copy a prop into a ref"),
        code(
          "vue",
          `const local = ref(props.name);   // frozen at setup`,
        ),
        p("`setup` runs once, so the copy never hears about the prop changing. If a value comes from above, read it from above — or use `computed`."),
        note("If two components ever show different answers to the same question, the value is stored twice and one of them should be a prop."),
      ],
    },
    {
      title: "computed, and watch when you need it",
      blocks: [
        p("A value worked out from other values is `computed`. It caches, and recalculates only when something it reads has changed."),
        code(
          "vue",
          `import { computed } from "vue";

const visible = computed(() =>
  sharks.value.filter((s) => s.name.includes(query.value)),
);`,
        ),
        p("Read it like a ref — `visible.value` in script, `{{ visible }}` in the template. It is read-only, which is the point: it has no state of its own to drift."),
        h("computed, not watch"),
        p("Watching one ref to set another is the shape to avoid. It runs after the fact, stores a second copy, and can disagree with the first:"),
        code(
          "vue",
          `// avoid
watch(query, () => { visible.value = filter(query.value); });

// prefer
const visible = computed(() => filter(query.value));`,
        ),
        h("What watch is actually for"),
        p("Reaching outside Vue — a request, a timer, writing to storage:"),
        code(
          "vue",
          `watch(query, async (next) => {
  results.value = await search(next);
});`,
        ),
        h("Side effects on mount"),
        code(
          "vue",
          `import { onMounted, onUnmounted } from "vue";

onMounted(() => { timer = setInterval(tick, 1000); });
onUnmounted(() => { clearInterval(timer); });`,
        ),
        note("Every subscription, interval and listener started in `onMounted` needs undoing in `onUnmounted`. A timer left running on a component that is gone is a leak that only shows up after a while."),
      ],
    },
  ],
  "routing-in-express": [
    {
      title: "A route is a method plus a path",
      blocks: [
        p("A server's job is to turn a request into a response. A route says which requests one piece of code is responsible for — the method and the path together."),
        code(
          "javascript",
          `import express from "express";

const app = express();

app.get("/sharks", (req, res) => {
  res.json([{ name: "Great white" }]);
});

app.listen(3000);`,
        ),
        p("`app.get` matches only `GET`. `POST /sharks` is a different route with different code, which is exactly the separation the method promised in the last module."),
        h("Order matters"),
        p("Express tries routes top to bottom and stops at the first match. A general pattern above a specific one swallows it:"),
        code(
          "javascript",
          `app.get("/sharks/:id", …);      // matches /sharks/new too
app.get("/sharks/new", …);      // never reached`,
        ),
        p("Put the specific route first. This is the cause of most \"my route does nothing\" questions."),
        h("res ends the request"),
        p("`res.json`, `res.send` and `res.status(…).end()` all finish it. Sending twice throws, and sending nothing leaves the browser waiting until it times out:"),
        code(
          "javascript",
          `app.get("/sharks/:id", (req, res) => {
  if (!shark) {
    res.status(404).json({ error: "Not found" });
    return;                                        // without this, both send
  }
  res.json(shark);
});`,
        ),
        note("Returning after sending is a habit worth forming early. `if (!x) res.status(404)…` with no `return` is a bug that only appears on the unhappy path, which is the path nobody tests by hand.", "notice"),
      ],
    },
    {
      title: "Parameters, queries, and bodies",
      blocks: [
        p("Three places data arrives from, and they are not interchangeable."),
        h("Path parameters name a thing"),
        code(
          "javascript",
          `app.get("/sharks/:id", (req, res) => {
  req.params.id;        // "42"
});`,
        ),
        p("Always a string, even when it looks like a number. `/sharks/42` gives you `\"42\"`."),
        h("The query string modifies a request"),
        code(
          "javascript",
          `// GET /sharks?big=true&sort=name
req.query.big;        // "true" — a string, not a boolean
req.query.sort;       // "name"`,
        ),
        p("Use the path for *which* resource and the query for *how* you want it — filtering, sorting, paging."),
        h("The body carries what you are sending"),
        p("Express does not parse a body unless you ask it to. Without this line `req.body` is `undefined`, which is the second most common Express surprise:"),
        code(
          "javascript",
          `app.use(express.json());

app.post("/sharks", (req, res) => {
  req.body.name;
});`,
        ),
        h("Nothing that arrives is trustworthy"),
        p("Every one of these comes from outside. Validate before you use any of it, and never build SQL by concatenating it:"),
        code(
          "javascript",
          `const id = Number(req.params.id);
if (!Number.isInteger(id)) {
  return res.status(400).json({ error: "id must be a number" });
}`,
        ),
        note("A path parameter that looks like a number is still a string. `req.params.id === 42` is false for `/sharks/42`, and it fails silently."),
      ],
    },
    {
      title: "Middleware, and the order it runs in",
      blocks: [
        p("Middleware is a function that sees the request before the route does. Everything in Express is built out of it — body parsing, sessions, logging, authentication."),
        code(
          "javascript",
          `function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Sign in first" });
  }
  next();
}`,
        ),
        p("`next()` hands on to whatever comes after. Not calling it — and not responding — leaves the request hanging forever."),
        h("It runs in the order you add it"),
        code(
          "javascript",
          `app.use(express.json());          // every route gets a parsed body
app.get("/sharks", handler);      // public
app.post("/sharks", requireAuth, handler);   // this one is not`,
        ),
        p("A middleware added *after* a route does not apply to it. If a guard is not firing, check whether it is registered below the thing it was meant to protect."),
        h("Errors"),
        p("An error handler takes four arguments, and that signature is how Express recognises it:"),
        code(
          "javascript",
          `app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Something went wrong" });
});`,
        ),
        p("It goes last. Send the client a short, honest message and keep the detail in the log — a stack trace in a response tells an attacker about your dependencies."),
        note("In Express 5 a rejected promise in an async handler reaches this automatically. In Express 4 it does not, and the request hangs — which is why so much Express 4 code wraps every handler."),
      ],
    },
  ],

  "routing-in-django": [
    {
      title: "urls.py maps a path to a view",
      blocks: [
        p("A server's job is to turn a request into a response. In Django the mapping lives in `urls.py`, and the code that answers is a view."),
        code(
          "python",
          `# urls.py
from django.urls import path
from . import views

urlpatterns = [
    path("sharks/", views.shark_list),
    path("sharks/<int:pk>/", views.shark_detail),
]`,
        ),
        code(
          "python",
          `# views.py
from django.http import JsonResponse

def shark_list(request):
    return JsonResponse({"sharks": [{"name": "Great white"}]})`,
        ),
        h("One view, every method"),
        p("Unlike Express, a path maps to one view whatever the method. The view decides:"),
        code(
          "python",
          `def shark_list(request):
    if request.method == "POST":
        return create(request)
    return JsonResponse({"sharks": []})`,
        ),
        h("Order matters"),
        p("Django tries patterns top to bottom and stops at the first match, so a general pattern above a specific one swallows it:"),
        code(
          "python",
          `path("sharks/<str:slug>/", views.detail),   # matches "new" too
path("sharks/new/", views.new),            # never reached`,
        ),
        h("Including another file"),
        p("Each app keeps its own `urls.py`, and the project's file mounts them:"),
        code(
          "python",
          `path("api/", include("sharks.urls")),`,
        ),
        note("Django's trailing slash is a convention it takes seriously: with `APPEND_SLASH` on, a request to `/sharks` is redirected to `/sharks/`. A `POST` does not survive that redirect, which is a confusing five minutes the first time.", "notice"),
      ],
    },
    {
      title: "Parameters and query strings",
      blocks: [
        p("Two places data arrives from in a URL, and Django treats them differently."),
        h("Path converters name a thing, and type it"),
        code(
          "python",
          `path("sharks/<int:pk>/", views.shark_detail)

def shark_detail(request, pk):
    pk    # already an int`,
        ),
        p("`<int:…>` converts and also refuses to match anything that is not a number, so a bad URL is a 404 rather than a crash inside your view. `<str:…>`, `<slug:…>` and `<uuid:…>` work the same way."),
        h("The query string modifies a request"),
        code(
          "python",
          `# GET /sharks/?big=true&sort=name
request.GET.get("big")            # "true" — a string
request.GET.get("sort", "name")   # with a default`,
        ),
        p("Use `.get()` rather than `request.GET[\"big\"]`: a missing key raises, and a missing query parameter is normal."),
        h("The body"),
        code(
          "python",
          `import json

def create(request):
    data = json.loads(request.body)
    data["name"]`,
        ),
        h("Naming a route"),
        p("Give a path a name and build URLs from the name, so changing the path does not mean finding every string that mentioned it:"),
        code(
          "python",
          `path("sharks/<int:pk>/", views.shark_detail, name="shark-detail")

from django.urls import reverse
reverse("shark-detail", args=[42])   # "/sharks/42/"`,
        ),
        note("A path converter is validation you get for free. `<int:pk>` means no view ever has to check that `pk` is a number."),
      ],
    },
    {
      title: "Returning a response",
      blocks: [
        p("A view must return a response object. Returning nothing raises — Django will not guess."),
        code(
          "python",
          `from django.http import JsonResponse, HttpResponse

JsonResponse({"name": "Great white"})
JsonResponse({"sharks": [...]}, safe=False)     # a list needs safe=False
HttpResponse(status=204)`,
        ),
        h("Status codes are an argument"),
        code(
          "python",
          `JsonResponse({"error": "Not found"}, status=404)`,
        ),
        h("404 without the if"),
        p("The common case has a shortcut that raises the right response for you:"),
        code(
          "python",
          `from django.shortcuts import get_object_or_404

shark = get_object_or_404(Shark, pk=pk)`,
        ),
        h("POST needs the CSRF token"),
        p("Django rejects an unauthenticated `POST` without a CSRF token — that is a feature, and the first thing people disable when they should not. For a form, include the tag:"),
        code(
          "python",
          `<form method="post">
  {% csrf_token %}
  …
</form>`,
        ),
        p("For a JSON API called from your own front end, send the token in the `X-CSRFToken` header. `@csrf_exempt` removes the protection rather than satisfying it."),
        h("Middleware wraps every request"),
        p("Sessions, authentication and CSRF are all middleware, listed in `settings.py` and applied in order. A request passes down the list and the response comes back up it."),
        note("If a POST returns 403 with no obvious reason, it is the CSRF check nine times out of ten. Send the token; do not exempt the view."),
      ],
    },
  ],
};
