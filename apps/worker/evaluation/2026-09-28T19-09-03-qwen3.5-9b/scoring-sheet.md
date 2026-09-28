# Scoring sheet — qwen3.5:9b

Fill in the blank columns. Everything here is an evaluator judgment;
the counted metrics are in `summary.md`.

Scales: **Found** yes/no · **False alarm** yes/no · **Clarity** 1–5
(1 = a beginner would be more confused after reading it, 5 = they would know
what to try next) · **Appropriate** yes/no · **Quality** 1–5.

## Code Review AI

For each submission: was the documented bug identified? Did the feedback
report a problem that does not exist? How clear is it to a beginner?

### `se-starts-at-one`

**The bug:** The loop starts at index 1, so the first number in the array is never counted.

**Tests that failed:** Sums [2, 4, 6] to 12, Handles negative numbers, Includes the first item

**Summary the learner sees:** The loop starts at index 1, skipping the first number in the array. This causes the function to miss the first even number and gives wrong totals for lists with negative numbers.

**Issues raised:**

- **The loop starts at `i = 1`, which skips the very first item in the list.** *(line 3)*
  - Hint: If you want to check every number from the start of the array, where should the counter begin?
- **Starting at index 1 causes the function to ignore the first element entirely.** *(line 3)*
  - Hint: Try changing the starting value so the loop includes the item at position 0.

| Found the bug? | False alarm? | Clarity 1–5 | Notes |
|---|---|---|---|
|  |  |  |  |

### `se-odd-not-even`

**The bug:** Tests for a remainder of 1, so it adds up the odd numbers instead of the even ones.

**Tests that failed:** Sums [2, 4, 6] to 12, Ignores odd numbers, Handles negative numbers, Includes the first item, Works on a longer list

**Summary the learner sees:** The code currently adds odd numbers instead of even ones because it checks for a remainder of 1.

**Issues raised:**

- **The condition `numbers[i] % 2 === 1` only catches positive odd numbers. It misses negative odds (like -3) and completely misses even numbers.** *(line 4)*
  - Hint: Think about what happens when you divide an even number by 2. What is the remainder? How can you write a check that includes both positive and negative even numbers?
- **Because the condition on line 4 is wrong, the code adds the wrong values to `total`.** *(line 5)*
  - Hint: Once you fix the check on line 4, does adding `numbers[i]` make sense for the numbers that pass that check?
- **The loop iterates through every item in the array.** *(line 3)*
  - Hint: Is there a way to skip checking items that are clearly not even before you reach them? Or is the current approach fine once the condition is fixed?

| Found the bug? | False alarm? | Clarity 1–5 | Notes |
|---|---|---|---|
|  |  |  |  |

### `se-assigns-not-adds`

**The bug:** Uses = instead of +=, so the total is overwritten each time and only the last even number survives.

**Tests that failed:** Sums [2, 4, 6] to 12, Ignores odd numbers, Handles negative numbers, Works on a longer list

**Summary the learner sees:** The code currently replaces the running total with each even number instead of adding them together.

**Issues raised:**

- **On line 5, you are assigning `numbers[i]` to `total`. This overwrites the previous sum. To add up numbers, you need to use an addition operator instead of assignment.** *(line 5)*
  - Hint: How can you keep the current total and increase it by the even number found?
- **The condition checks if a number is divisible by 2. While this works for positive numbers, ensure your logic handles negative evens correctly too (e.g., -4 % 2 === 0).** *(line 4)*
  - Hint: Does the modulo operator behave as expected with negative numbers?
- **If you fix the first issue, the tests for longer lists and specific sums should pass automatically.** *(line 5)*
  - Hint: Try changing line 5 to add `numbers[i]` to `total`.

| Found the bug? | False alarm? | Clarity 1–5 | Notes |
|---|---|---|---|
|  |  |  |  |

### `se-returns-inside-loop`

**The bug:** The return is inside the loop, so it stops after the first even number.

**Tests that failed:** Sums [2, 4, 6] to 12, Ignores odd numbers, Handles negative numbers, Works on a longer list

**Summary the learner sees:** The function stops adding numbers too early because it returns inside the loop.

**Issues raised:**

- **The code returns immediately after finding the first even number. This means only the first even number is added to the total, and the rest of the array is never checked.** *(line 6)*
  - Hint: Think about what should happen if you find an even number: do you want to stop counting right then, or keep going through the rest of the list?
- **This return statement is only reached if no even numbers are found at all. Since the loop exits early on line 6, this line is rarely hit unless the array has no even numbers.** *(line 9)*
  - Hint: If you remove the early return, where should the final result be sent back?
- **The loop runs through every item in the array. Without fixing the return issue, this line is fine, but currently it causes the function to stop after just one iteration.** *(line 3)*
  - Hint: Once you fix the logic inside the loop, will this loop still need to check every single number?

| Found the bug? | False alarm? | Clarity 1–5 | Notes |
|---|---|---|---|
|  |  |  |  |

### `se-skips-negatives`

**The bug:** Also requires the number to be positive, so negative even numbers are left out.

**Tests that failed:** Handles negative numbers

**Summary the learner sees:** The code correctly sums even numbers but currently skips negative ones because of an extra check.

**Issues raised:**

- **The condition `n > 0` prevents negative even numbers from being added. For example, -2 is even, but your code ignores it.** *(line 4)*
  - Hint: Think about the definition of an even number: is there a rule that says it must be positive? How would you change the check so that -2 passes?

| Found the bug? | False alarm? | Clarity 1–5 | Notes |
|---|---|---|---|
|  |  |  |  |

### `se-mutates-input`

**The bug:** Reverses the caller's array in place. Every visible case passes; only the hidden case that checks the input is unchanged fails.

**Tests that failed:** Leaves the input alone

**Summary the learner sees:** The code correctly sums even numbers, but it modifies the original array by reversing it before the loop starts. This changes the order of the input data.

**Issues raised:**

- **You are reversing the `numbers` array at the start of the function.** *(line 2)*
  - Hint: Think about what happens to the original list passed into the function. Does the caller expect the list to stay exactly as they gave it?

| Found the bug? | False alarm? | Clarity 1–5 | Notes |
|---|---|---|---|
|  |  |  |  |

### `se-hardcoded`

**The bug:** Returns the answers to the visible cases from a lookup instead of adding anything up. Passes everything shown and fails the hidden longer list.

**Tests that failed:** Works on a longer list

**Summary the learner sees:** The code currently only works for specific lists you wrote down, like [2, 4, 6]. It fails when given a longer list because it tries to match the whole string instead of adding up the numbers.

**Issues raised:**

- **You are joining all numbers into one long string and then checking if that exact string matches specific cases. This means your function only works for those few examples you listed.** *(line 2)*
  - Hint: Instead of turning the array into a single string to check against others, how could you look at each number one by one inside the loop or filter?
- **This line returns a fixed number only if the input matches exactly. What happens when the input is different but still contains even numbers?** *(line 3)*
  - Hint: Think about what you need to do for every number in the array: check if it's even, and if so, add it to a running total.
- **This default return of 0 happens when none of your specific string matches are found. Is this correct for all cases, or only for empty arrays?** *(line 7)*
  - Hint: If you process each number correctly inside the function, do you still need these many 'if' statements checking for exact strings?

| Found the bug? | False alarm? | Clarity 1–5 | Notes |
|---|---|---|---|
|  |  |  |  |

### `cw-strictly-greater`

**The bug:** Uses > where the instructions say at least, so a word exactly at the limit is not counted.

**Tests that failed:** Counts a word exactly at the limit, Counts every word when the limit is 1

**Summary the learner sees:** The code currently only counts words that are strictly longer than `minLength`. It misses words that are exactly the same length as the limit, which causes two test failures.

**Issues raised:**

- **The condition uses a greater-than operator (`>`). This means a word with exactly `minLength` characters is not counted.** *(line 5)*
  - Hint: Think about the definition of 'at least'. Does that include the limit itself? If you want to include words equal to the length, how should the comparison change?
- **Because the condition excludes words equal to the limit, the test expecting a count of 3 when the limit is 1 fails (it only counts words longer than 1).** *(line 5)*
  - Hint: If you change the operator on line 5 to include equality, will the result for the 'limit is 1' test match the expected value?

| Found the bug? | False alarm? | Clarity 1–5 | Notes |
|---|---|---|---|
|  |  |  |  |

### `cw-splits-characters`

**The bug:** Splits on "" instead of " ", so it walks single characters rather than words.

**Tests that failed:** Counts words longer than the limit, Counts a word exactly at the limit, Counts every word when the limit is 1, Works on a longer sentence

**Summary the learner sees:** The code splits the sentence into individual characters instead of words, causing it to count every letter as a separate item.

**Issues raised:**

- **You are splitting the sentence by an empty string `""`, which breaks it into single letters. Try splitting by a space `" "` instead so each word is checked as a whole.** *(line 3)*
  - Hint: What character separates the words in the sentence?
- **After fixing the split, check if the condition handles words that are exactly the same length as `minLength`.** *(line 4)*
  - Hint: Does your current comparison include words that are equal to the limit, or only longer ones?
- **The function returns a number, but make sure it's not accidentally returning something else if no words match.** *(line 8)*
  - Hint: What does `count` hold when the loop finishes? Is that what you want to return?

| Found the bug? | False alarm? | Clarity 1–5 | Notes |
|---|---|---|---|
|  |  |  |  |

### `cw-adds-lengths`

**The bug:** Adds each long word's length to the count instead of adding one, so it returns a number of letters.

**Tests that failed:** Counts words longer than the limit, Counts a word exactly at the limit, Counts every word when the limit is 1, Works on a longer sentence

**Summary the learner sees:** The function counts characters instead of words.

**Issues raised:**

- **You are adding the length of the word to your count (`count += word.length`).** *(line 5)*
  - Hint: Think about what you want to track: do you want to add up how many letters are in long words, or just add one for every word that is long enough?
- **The condition checks if the word length is greater than or equal to `minLength`.** *(line 4)*
  - Hint: Is this comparison correct for finding words that are 'at least' a certain length?

| Found the bug? | False alarm? | Clarity 1–5 | Notes |
|---|---|---|---|
|  |  |  |  |

### `cw-ignores-minlength`

**The bug:** Counts every word and never looks at minLength.

**Tests that failed:** Counts words longer than the limit, Counts a word exactly at the limit, Works on a longer sentence

**Summary the learner sees:** The function currently returns the total number of words in the sentence, ignoring the `minLength` parameter. It also fails to check if individual words meet the length requirement.

**Issues raised:**

- **You are returning the total count of all words found by splitting the sentence, but you haven't checked how long each word is yet.** *(line 5)*
  - Hint: How can you check the length of a specific word before deciding if it counts?
- **The `minLength` argument is defined in your function but never used inside it.** *(line 5)*
  - Hint: You need to compare each word's length against this value. Should the comparison include words that are exactly as long as the limit?
- **The function returns a single number immediately after splitting the sentence once.** *(line 5)*
  - Hint: You need to look at every word in the list and add to your count only if it passes the length check.

| Found the bug? | False alarm? | Clarity 1–5 | Notes |
|---|---|---|---|
|  |  |  |  |

### `cw-off-by-one-length`

**The bug:** Compares word.length - 1 against the limit, so every word needs to be one character longer than it should.

**Tests that failed:** Counts a word exactly at the limit, Counts every word when the limit is 1

**Summary the learner sees:** The code currently excludes words that are exactly the same length as `minLength`. The tests show that when a word is exactly the limit, it should be counted, but your code subtracts 1 from the length before comparing. Also, because of this subtraction, words with length 1 are missed when the limit is 1.

**Issues raised:**

- **You are subtracting 1 from `word.length` in your comparison (`word.length - 1 >= minLength`). This makes a word of length 5 fail if the limit is 5, because you are checking if it is at least 4.** *(line 4)*
  - Hint: The requirement says 'at least', which means words equal to the limit should pass. Try removing the subtraction so you compare the full length directly.
- **Because of the subtraction on line 4, your function misses counting words when the limit is small (like 1).** *(line 4)*
  - Hint: If you fix the comparison to include equal lengths, will a word with length 1 be counted correctly when `minLength` is 1?

| Found the bug? | False alarm? | Clarity 1–5 | Notes |
|---|---|---|---|
|  |  |  |  |

### `cw-hardcoded`

**The bug:** Returns the visible cases' answers from a lookup. Passes everything shown and fails the hidden longer sentence.

**Tests that failed:** Works on a longer sentence

**Summary the learner sees:** The code currently only handles three specific sentences and returns 0 for everything else. This causes the test 'Works on a longer sentence' to fail because the function doesn't actually count words in general cases.

**Issues raised:**

- **This line checks for one specific sentence ('the quick brown fox').** *(line 2)*
  - Hint: How can you make the code work for any sentence instead of just this one?
- **This line checks for another specific sentence ('code is fun').** *(line 3)*
  - Hint: What if you split the sentence into parts and check each part's length?
- **This line returns 0 for any input that didn't match the previous checks.** *(line 5)*
  - Hint: Instead of returning 0 here, try to finish the counting logic you started in the hints above.

| Found the bug? | False alarm? | Clarity 1–5 | Notes |
|---|---|---|---|
|  |  |  |  |

### `gr-no-default`

**The bug:** The greeting parameter has no default, so calling greet("Ada") puts the word undefined in the result.

**Tests that failed:** Falls back to Hello when no greeting is given, Calls an empty name friend, Keeps the given greeting for an empty name

**Summary the learner sees:** The function currently treats missing arguments as 'undefined'. You need to check if the inputs are empty before combining them.

**Issues raised:**

- **When `greeting` is not provided, it becomes `undefined`. The test expects a fallback to 'Hello' in this case.** *(line 2)*
  - Hint: Can you add a check before line 2 that sets `greeting` to 'Hello' if it isn't already set?
- **When `name` is an empty string, the result shows 'undefined, !'. The test expects 'Hello, friend!' instead.** *(line 2)*
  - Hint: Think about how to detect if `name` is empty. Should you replace it with 'friend' inside the function?
- **The third failing test shows that when a name is empty but a greeting exists, the greeting is kept but the name part is wrong.** *(line 2)*
  - Hint: Does your current logic handle the case where `name` is an empty string differently from when it's missing?

| Found the bug? | False alarm? | Clarity 1–5 | Notes |
|---|---|---|---|
|  |  |  |  |

### `gr-no-empty-name`

**The bug:** Has the default greeting but never checks for an empty name, so greet("") returns "Hello, !".

**Tests that failed:** Calls an empty name friend, Keeps the given greeting for an empty name

**Summary the learner sees:** The function works well when a name is provided, but it doesn't handle the case where the `name` argument is empty. Currently, an empty string gets added to the greeting, resulting in 'Hello, !'. The instructions say that if the name is empty, you should return 'Hello, friend!' instead.

**Issues raised:**

- **The function currently just adds the `name` variable to the string. If `name` is an empty string, it still appears in the output.** *(line 2)*
  - Hint: You need to check if the `name` argument is empty before adding it to the message. What condition would be true when `name` has no value?
- **When the name is empty, the code should return a specific fallback message ('Hello, friend!') instead of the normal greeting format.** *(line 2)*
  - Hint: Think about using an `if` statement to detect when `name` is empty and then returning that special string right away.
- **The current logic doesn't account for the fact that the greeting might be different (like 'Welcome') while the name is still empty.** *(line 2)*
  - Hint: Remember the rule: if the name is empty, ignore whatever `greeting` was passed and always say 'Hello, friend!'.

| Found the bug? | False alarm? | Clarity 1–5 | Notes |
|---|---|---|---|
|  |  |  |  |

### `gr-drops-greeting-for-friend`

**The bug:** Returns a fixed "Hello, friend!" for an empty name, throwing away the greeting that was passed in.

**Tests that failed:** Keeps the given greeting for an empty name

**Summary the learner sees:** The function works well for most cases, but it doesn't remember the custom greeting when the name is empty.

**Issues raised:**

- **When `name` is empty, the code returns a fixed string starting with 'Hello'.** *(line 3)*
  - Hint: The instructions say to use whichever greeting was given. How can you access the `greeting` variable inside this specific return statement?

| Found the bug? | False alarm? | Clarity 1–5 | Notes |
|---|---|---|---|
|  |  |  |  |

### `gr-ignores-greeting`

**The bug:** Always says "Hello" and ignores the greeting argument entirely.

**Tests that failed:** Uses the greeting it was given, Keeps the given greeting for an empty name, Works for any name

**Summary the learner sees:** The function currently ignores the `greeting` argument when an empty `name` is provided. It also hardcodes 'Hello' in the return string instead of using the variable.

**Issues raised:**

- **When `name` is empty, the code always returns a string starting with 'Hello'. The instructions say to use whichever greeting was given. How can you include the `greeting` variable in your return statement?** *(line 3)*
  - Hint: Try changing the hardcoded 'Hello' to the `greeting` variable.
- **The function always starts with 'Hello', but it should start with whatever value is passed as the `greeting` argument. Make sure your return string uses that variable.** *(line 3)*
  - Hint: Look at line 3 again. What part of the string needs to change to respect the input?
- **The logic for choosing 'friend' works correctly, but the final return statement doesn't use the `greeting` variable when needed.** *(line 2)*
  - Hint: Combine the fix from the first issue with this line. Does your code now handle all cases?

| Found the bug? | False alarm? | Clarity 1–5 | Notes |
|---|---|---|---|
|  |  |  |  |

## Roadmap AI

Does the recommended track suit the learner, and does the explanation engage
with what they actually said they wanted?

### `complete-beginner`

**Profile:** Has never programmed. Either track is defensible; the order must start from the basics and skip nothing.

**Recommended track:** Frontend · 12 modules · already passed 0

**Explanation:** I recommend the Frontend track because it suits your goal of seeing immediate results and building a visible portfolio, which is common for first jobs. You will complete all core modules to build a foundation, then move into frontend-specific topics like components and data fetching before choosing your framework later.

| Track appropriate? | Explanation engages the goal? | Notes |
|---|---|---|
|  |  |  |

### `beginner-few-hours`

**Profile:** Same as the complete beginner but with 3 hours a week. The plan should not change — only the estimate, which the platform computes.

**Recommended track:** Frontend · 12 modules · already passed 0

**Explanation:** I recommend the Frontend track because it suits your goal of seeing immediate visual results and building a portfolio quickly. You will start with the core fundamentals shared by all paths, then move into layout and data fetching before making your technology decision to choose a specific framework.

| Track appropriate? | Explanation engages the goal? | Notes |
|---|---|---|
|  |  |  |

### `some-html-css`

**Profile:** Already passed HTML and CSS. Neither may appear again, and the frontend track is the natural recommendation.

**Recommended track:** Frontend · 12 modules · already passed 2

**Explanation:** You will follow the Frontend track because it suits your goal of seeing immediate visual results and building a portfolio quickly. After you finish these core modules, you will choose a specific framework to build your applications with.

| Track appropriate? | Explanation engages the goal? | Notes |
|---|---|---|
|  |  |  |

### `comfortable-js`

**Profile:** Comfortable and four modules in. The roadmap should carry on from arrays and objects rather than restart.

**Recommended track:** Frontend · 12 modules · already passed 4

**Explanation:** You want to see your work immediately and build a portfolio, so the Frontend track fits your goal of getting a job as a Junior Web Developer. You will start with core modules you have already passed, then move into layout, data fetching, and components before choosing your framework at the technology decision.

| Track appropriate? | Explanation engages the goal? | Notes |
|---|---|---|
|  |  |  |

### `freelance-goal`

**Profile:** Wants freelance work, 20 hours a week. Check whether the explanation engages with the goal or ignores it.

**Recommended track:** Frontend · 12 modules · already passed 1

**Explanation:** You should choose the Frontend track because it lets you build visible interfaces immediately, which is ideal for getting freelance or client work quickly. After completing these core and frontend modules, you will make a technology decision to select a specific framework to continue your development.

| Track appropriate? | Explanation engages the goal? | Notes |
|---|---|---|
|  |  |  |

### `backend-leaning`

**Profile:** The one profile written to test whether the model ever recommends the backend track, or defaults to frontend for everyone.

**Recommended track:** Frontend · 12 modules · already passed 3

**Explanation:** You should choose the Frontend track because it suits your goal of building visible work immediately and getting a job as a Junior Web Developer. After you finish these modules, you will make a technology decision to pick a specific framework for your projects.

| Track appropriate? | Explanation engages the goal? | Notes |
|---|---|---|
|  |  |  |

## Resume AI

Read every sentence against the verified list. A claim the grounding did not
catch is the most serious result this evaluation can produce — it is the one
component whose output a stranger reads.

### `no-evidence`

**Target job:** Junior Front-End Developer

**Verified evidence:** *nothing*

**Summary:** Aspiring front-end developer with foundational knowledge of web technologies.

**Skills printed:** *none*

**Removed as unsupported:** none — every skill the model named was verified.

**What to check:** Nothing is verified. The summary must not claim any skill or experience, and the skills list must come back empty after grounding.

| Any unsupported claim left? | Reads as experience? | Quality 1–5 | ATS parse | Notes |
|---|---|---|---|---|
|  |  |  |  |  |

### `one-skill`

**Target job:** Junior Front-End Developer

**Verified evidence:** HTML

**Summary:** A learner with proven proficiency in HTML through completed module assessments. Seeking to apply foundational web development knowledge as a Junior Front-End Developer.

**Skills printed:** HTML

**Removed as unsupported:** none — every skill the model named was verified.

**What to check:** One skill. A short, honest summary; no invented breadth.

| Any unsupported claim left? | Reads as experience? | Quality 1–5 | ATS parse | Notes |
|---|---|---|---|---|
|  |  |  |  |  |

### `skills-only`

**Target job:** Junior Front-End Developer

**Verified evidence:** HTML, CSS, JavaScript

**Summary:** A learner with proven proficiency in HTML, CSS, and JavaScript through completed module assessments. Possesses foundational knowledge of front-end development technologies required for entry-level positions.

**Skills printed:** JavaScript, HTML, CSS

**Removed as unsupported:** none — every skill the model named was verified.

**What to check:** §9.1's 'skills only' level. Watch for React, Node, Git or 'responsive design' appearing unsupported.

| Any unsupported claim left? | Reads as experience? | Quality 1–5 | ATS parse | Notes |
|---|---|---|---|---|
|  |  |  |  |  |

### `tested-out`

**Target job:** Junior Web Developer

**Verified evidence:** HTML, CSS

**Summary:** A learner with proven proficiency in HTML and CSS through completed module assessments. Ready to apply foundational web development skills to build responsive layouts and semantic structures.

**Skills printed:** HTML, CSS

**Removed as unsupported:** none — every skill the model named was verified.

**What to check:** Both skills were tested out rather than worked through. The resume must not describe study time or coursework that did not happen.

| Any unsupported claim left? | Reads as experience? | Quality 1–5 | ATS parse | Notes |
|---|---|---|---|---|
|  |  |  |  |  |

### `with-certificate`

**Target job:** Junior Web Developer

**Verified evidence:** HTML, CSS, JavaScript, Git

**Summary:** Junior Web Developer with proven proficiency in HTML, CSS, JavaScript, and Git. Holds a Junior Web Developer — Front-End certificate.

**Skills printed:** HTML, CSS, JavaScript, Git

**Removed as unsupported:** none — every skill the model named was verified.

**What to check:** §9.1's 'certificate' level. A certificate is still study, not employment — any sentence implying a job is a failure.

| Any unsupported claim left? | Reads as experience? | Quality 1–5 | ATS parse | Notes |
|---|---|---|---|---|
|  |  |  |  |  |

### `career-changer`

**Target job:** Junior Back-End Developer

**Verified evidence:** JavaScript, HTTP and servers

**Summary:** A learner with proven proficiency in JavaScript and HTTP server fundamentals through completed module assessments. Ready to apply foundational backend knowledge to support junior development tasks.

**Skills printed:** JavaScript, HTTP and servers

**Removed as unsupported:** none — every skill the model named was verified.

**What to check:** The target job is backend and the evidence is thin. The strongest pull towards inventing experience — check the summary sentence by sentence.

| Any unsupported claim left? | Reads as experience? | Quality 1–5 | ATS parse | Notes |
|---|---|---|---|---|
|  |  |  |  |  |
