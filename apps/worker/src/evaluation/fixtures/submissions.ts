/**
 * The Code Review AI test set (`project-proposal.md` §9.1).
 *
 * §9.1 asks for "15 to 20 beginner submissions with known, documented bugs,
 * plus several correct submissions". There are 17 and 4 here.
 *
 * ### They are written against the three *seeded* exercises
 *
 * Not invented alongside them. The harness runs every one of these through the
 * **real Docker sandbox** against the **real test cases**, and hands the model
 * the outcomes that come back — because §7's rule is that tests run before any
 * model call, and a test set whose results were typed by hand would measure the
 * prompt against a fiction. It also means a mislabelled fixture is caught: the
 * harness refuses to run if a submission marked correct fails, or one marked
 * buggy passes.
 *
 * ### `bug` is prose, not a keyword list
 *
 * Bug detection is scored by a person (§9.1: "Rated by evaluators"). Matching
 * the model's words against a list of expected ones would produce a number that
 * looks rigorous and measures vocabulary — "off-by-one" and "starts counting
 * from the second item" are the same finding. The harness prints this sentence
 * beside the model's feedback in a sheet, and a human marks whether it was
 * found.
 *
 * ### Why several bugs fail only a hidden case
 *
 * `se-mutates-input` and the two hard-coded submissions pass everything the
 * learner can see. They are the cases where feedback is hardest and most
 * valuable, and they also exercise the redaction path — the model is given a
 * hidden case as a name and an outcome, never its expected value (§6 rule 2).
 */

export interface SubmissionFixture {
  /** Stable across runs, so two models can be compared case by case. */
  id: string;
  /** Module slug — the key into `supabase/seed/exercises.mjs`. */
  exercise: string;
  /** The documented defect, or null for a correct submission. */
  bug: string | null;
  files: { path: string; content: string }[];
}

const js = (content: string) => [{ path: "script.js", content }];

export const submissions: SubmissionFixture[] = [
  // ---------------------------------------------------------------- sumEven
  {
    id: "se-starts-at-one",
    exercise: "js-arrays-objects",
    bug: "The loop starts at index 1, so the first number in the array is never counted.",
    files: js(`function sumEven(numbers) {
  let total = 0;
  for (let i = 1; i < numbers.length; i++) {
    if (numbers[i] % 2 === 0) {
      total += numbers[i];
    }
  }
  return total;
}

module.exports = { sumEven };
`),
  },
  {
    id: "se-odd-not-even",
    exercise: "js-arrays-objects",
    bug: "Tests for a remainder of 1, so it adds up the odd numbers instead of the even ones.",
    files: js(`function sumEven(numbers) {
  let total = 0;
  for (let i = 0; i < numbers.length; i++) {
    if (numbers[i] % 2 === 1) {
      total += numbers[i];
    }
  }
  return total;
}

module.exports = { sumEven };
`),
  },
  {
    id: "se-assigns-not-adds",
    exercise: "js-arrays-objects",
    bug: "Uses = instead of +=, so the total is overwritten each time and only the last even number survives.",
    files: js(`function sumEven(numbers) {
  let total = 0;
  for (let i = 0; i < numbers.length; i++) {
    if (numbers[i] % 2 === 0) {
      total = numbers[i];
    }
  }
  return total;
}

module.exports = { sumEven };
`),
  },
  {
    id: "se-returns-inside-loop",
    exercise: "js-arrays-objects",
    bug: "The return is inside the loop, so it stops after the first even number.",
    files: js(`function sumEven(numbers) {
  let total = 0;
  for (let i = 0; i < numbers.length; i++) {
    if (numbers[i] % 2 === 0) {
      total += numbers[i];
      return total;
    }
  }
  return total;
}

module.exports = { sumEven };
`),
  },
  {
    id: "se-skips-negatives",
    exercise: "js-arrays-objects",
    bug: "Also requires the number to be positive, so negative even numbers are left out.",
    files: js(`function sumEven(numbers) {
  let total = 0;
  for (const n of numbers) {
    if (n % 2 === 0 && n > 0) {
      total += n;
    }
  }
  return total;
}

module.exports = { sumEven };
`),
  },
  {
    id: "se-mutates-input",
    exercise: "js-arrays-objects",
    bug: "Reverses the caller's array in place. Every visible case passes; only the hidden case that checks the input is unchanged fails.",
    files: js(`function sumEven(numbers) {
  numbers.reverse();
  let total = 0;
  for (const n of numbers) {
    if (n % 2 === 0) {
      total += n;
    }
  }
  return total;
}

module.exports = { sumEven };
`),
  },
  {
    id: "se-hardcoded",
    exercise: "js-arrays-objects",
    bug: "Returns the answers to the visible cases from a lookup instead of adding anything up. Passes everything shown and fails the hidden longer list.",
    files: js(`function sumEven(numbers) {
  const key = numbers.join(",");
  if (key === "2,4,6") return 12;
  if (key === "1,2,3,4") return 6;
  if (key === "-2,-3,-4") return -6;
  if (key === "2,1") return 2;
  return 0;
}

module.exports = { sumEven };
`),
  },
  {
    id: "se-correct-reduce",
    exercise: "js-arrays-objects",
    bug: null,
    files: js(`function sumEven(numbers) {
  return numbers
    .filter((n) => n % 2 === 0)
    .reduce((total, n) => total + n, 0);
}

module.exports = { sumEven };
`),
  },
  {
    id: "se-correct-loop",
    exercise: "js-arrays-objects",
    bug: null,
    files: js(`function sumEven(numbers) {
  let total = 0;
  for (let i = 0; i < numbers.length; i++) {
    if (numbers[i] % 2 === 0) {
      total += numbers[i];
    }
  }
  return total;
}

module.exports = { sumEven };
`),
  },

  // -------------------------------------------------------- countLongWords
  {
    id: "cw-strictly-greater",
    exercise: "js-basics",
    bug: "Uses > where the instructions say at least, so a word exactly at the limit is not counted.",
    files: js(`function countLongWords(sentence, minLength) {
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
`),
  },
  {
    id: "cw-splits-characters",
    exercise: "js-basics",
    bug: 'Splits on "" instead of " ", so it walks single characters rather than words.',
    files: js(`function countLongWords(sentence, minLength) {
  let count = 0;
  for (const word of sentence.split("")) {
    if (word.length >= minLength) {
      count += 1;
    }
  }
  return count;
}

module.exports = { countLongWords };
`),
  },
  {
    id: "cw-adds-lengths",
    exercise: "js-basics",
    bug: "Adds each long word's length to the count instead of adding one, so it returns a number of letters.",
    files: js(`function countLongWords(sentence, minLength) {
  let count = 0;
  for (const word of sentence.split(" ")) {
    if (word.length >= minLength) {
      count += word.length;
    }
  }
  return count;
}

module.exports = { countLongWords };
`),
  },
  {
    id: "cw-ignores-minlength",
    exercise: "js-basics",
    bug: "Counts every word and never looks at minLength.",
    files: js(`function countLongWords(sentence, minLength) {
  if (sentence === "") {
    return 0;
  }
  return sentence.split(" ").length;
}

module.exports = { countLongWords };
`),
  },
  {
    id: "cw-off-by-one-length",
    exercise: "js-basics",
    bug: "Compares word.length - 1 against the limit, so every word needs to be one character longer than it should.",
    files: js(`function countLongWords(sentence, minLength) {
  let count = 0;
  for (const word of sentence.split(" ")) {
    if (word.length - 1 >= minLength) {
      count += 1;
    }
  }
  return count;
}

module.exports = { countLongWords };
`),
  },
  {
    id: "cw-hardcoded",
    exercise: "js-basics",
    bug: "Returns the visible cases' answers from a lookup. Passes everything shown and fails the hidden longer sentence.",
    files: js(`function countLongWords(sentence, minLength) {
  if (sentence === "the quick brown fox" && minLength === 4) return 2;
  if (sentence === "code is fun" && minLength === 4) return 1;
  if (sentence === "a bb ccc" && minLength === 1) return 3;
  return 0;
}

module.exports = { countLongWords };
`),
  },
  {
    id: "cw-correct",
    exercise: "js-basics",
    bug: null,
    files: js(`function countLongWords(sentence, minLength) {
  if (sentence === "") {
    return 0;
  }
  return sentence.split(" ").filter((word) => word.length >= minLength).length;
}

module.exports = { countLongWords };
`),
  },

  // ------------------------------------------------------------------ greet
  {
    id: "gr-no-default",
    exercise: "js-functions",
    bug: 'The greeting parameter has no default, so calling greet("Ada") puts the word undefined in the result.',
    files: js(`function greet(name, greeting) {
  return greeting + ", " + name + "!";
}

module.exports = { greet };
`),
  },
  {
    id: "gr-no-empty-name",
    exercise: "js-functions",
    bug: 'Has the default greeting but never checks for an empty name, so greet("") returns "Hello, !".',
    files: js(`function greet(name, greeting = "Hello") {
  return greeting + ", " + name + "!";
}

module.exports = { greet };
`),
  },
  {
    id: "gr-drops-greeting-for-friend",
    exercise: "js-functions",
    bug: 'Returns a fixed "Hello, friend!" for an empty name, throwing away the greeting that was passed in.',
    files: js(`function greet(name, greeting = "Hello") {
  if (name === "") {
    return "Hello, friend!";
  }
  return greeting + ", " + name + "!";
}

module.exports = { greet };
`),
  },
  {
    id: "gr-ignores-greeting",
    exercise: "js-functions",
    bug: 'Always says "Hello" and ignores the greeting argument entirely.',
    files: js(`function greet(name, greeting = "Hello") {
  const who = name === "" ? "friend" : name;
  return "Hello, " + who + "!";
}

module.exports = { greet };
`),
  },
  {
    id: "gr-correct",
    exercise: "js-functions",
    bug: null,
    files: js(`function greet(name, greeting = "Hello") {
  const who = name === "" ? "friend" : name;
  return greeting + ", " + who + "!";
}

module.exports = { greet };
`),
  },
];
