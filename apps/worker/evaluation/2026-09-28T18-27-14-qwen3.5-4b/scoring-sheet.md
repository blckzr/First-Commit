# Scoring sheet — qwen3.5:4b

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

**Summary the learner sees:** Your loop skips the first number and starts at index 1, which causes it to miss the first even number in the list.

**Issues raised:**

- **You started your loop with `i = 1`, but arrays start counting from 0. This means you skipped checking the very first number in your list.** *(line 3)*
  - Hint: Try changing the starting value of `i` to see if that fixes the case where the first number is even.
- **Because you started at index 1, you also missed the first number in negative lists (like -2), which explains why your total was wrong for negative numbers.** *(line 3)*
  - Hint: Does starting the loop at `i = 0` instead of `i = 1` solve both the positive and negative test failures?
- **Your logic for checking if a number is even (`numbers[i] % 2 === 0`) is correct, but you never actually checked the first item because of the loop start.** *(line 3)*
  - Hint: The rest of your code looks good! Just need to make sure every single item in the array gets a chance to be checked.

| Found the bug? | False alarm? | Clarity 1–5 | Notes |
|---|---|---|---|
|  |  |  |  |

### `se-odd-not-even`

**The bug:** Tests for a remainder of 1, so it adds up the odd numbers instead of the even ones.

**Tests that failed:** Sums [2, 4, 6] to 12, Ignores odd numbers, Handles negative numbers, Includes the first item, Works on a longer list

**Summary the learner sees:** Your code adds up numbers that are **odd**, but the instructions asked for **even** numbers.

**Issues raised:**

- **You are checking if a number is odd (`% 2 === 1`) and adding it to the total. The task requires adding only even numbers.** *(line 4)*
  - Hint: Change the condition so that you add the number when it divides evenly by 2 (i.e., when the remainder is 0). Try changing `=== 1` to `=== 0`.
- **Because your current logic only adds odd numbers, negative numbers are being skipped even though they should be included in the sum.** *(line 4)*
  - Hint: Does the modulo operator (`%`) work the same way for negative numbers as it does for positive ones? How would that affect your condition?
- **Your logic currently adds odd numbers, which is why your test results show incorrect totals.** *(line 4)*
  - Hint: Think about what happens when you change the comparison operator. Will that make your code add even numbers instead of odd ones?

| Found the bug? | False alarm? | Clarity 1–5 | Notes |
|---|---|---|---|
|  |  |  |  |

### `se-assigns-not-adds`

**The bug:** Uses = instead of +=, so the total is overwritten each time and only the last even number survives.

**Tests that failed:** Sums [2, 4, 6] to 12, Ignores odd numbers, Handles negative numbers, Works on a longer list

**Summary the learner sees:** Your code checks if numbers are even, but it only keeps the *last* even number instead of adding them all together.

**Issues raised:**

- **You are replacing the total with the current number (`total = numbers[i]`) instead of adding it to the total (`total += numbers[i]`).** *(line 5)*
  - Hint: Think about what happens if you have two even numbers. If you replace the total each time, which number will be left at the end?
- **The logic inside the `if` statement is correct for finding even numbers, but the action taken on line 5 overwrites progress.** *(line 4)*
  - Hint: Try changing the equals sign to a plus sign. How would that change the behavior?
- **The function returns `total` correctly, but because of the issue above, it only holds the final even number found.** *(line 8)*
  - Hint: Since you are already using a variable called `total`, what operation should happen to that variable every time an even number is found?

| Found the bug? | False alarm? | Clarity 1–5 | Notes |
|---|---|---|---|
|  |  |  |  |

### `se-returns-inside-loop`

**The bug:** The return is inside the loop, so it stops after the first even number.

**Tests that failed:** Sums [2, 4, 6] to 12, Ignores odd numbers, Handles negative numbers, Works on a longer list

**Summary the learner sees:** Your code stops adding numbers as soon as it finds one even number, which is why you only get the first item instead of the full sum.

**Issues raised:**

- **You use `return` inside the `if` block. This makes the function exit immediately after checking just the first number.** *(line 6)*
  - Hint: Try moving the `return` statement outside of the `if` block so it only runs once the loop finishes.
- **The condition checks if a number is even correctly, but because of the early return, no other numbers are ever added.** *(line 4)*
  - Hint: Remove the `return` from inside the `if` and let the loop continue checking all numbers.
- **Your variable `total` starts at 0, which is correct for an empty array, but the logic prevents it from growing.** *(line 2)*
  - Hint: Think about what happens if you remove the early return—will the loop now check every number in the list?

| Found the bug? | False alarm? | Clarity 1–5 | Notes |
|---|---|---|---|
|  |  |  |  |

### `se-skips-negatives`

**The bug:** Also requires the number to be positive, so negative even numbers are left out.

**Tests that failed:** Handles negative numbers

**Summary the learner sees:** Your code works perfectly for positive even numbers and handles edge cases like empty arrays, but it incorrectly ignores negative even numbers because of an extra condition.

**Issues raised:**

- **You added `&& n > 0` to your check. This means the function only adds numbers that are greater than zero. Since -2, -4, and -6 are not greater than zero, they are skipped.** *(line 4)*
  - Hint: Think about what happens if you remove that extra condition. Would negative even numbers then be included in the sum?
- **Your function name `sumEven` is a bit misleading because it currently excludes negative numbers.** *(line 1)*
  - Hint: If you were to rename this function to better reflect its actual behavior (ignoring negatives), what would be a more accurate name?
- **The condition `n > 0` is the specific reason why negative numbers are failing the test.** *(line 4)*
  - Hint: Try changing `n > 0` to something that allows both positive and negative even numbers to pass. What operator should you use instead?

| Found the bug? | False alarm? | Clarity 1–5 | Notes |
|---|---|---|---|
|  |  |  |  |

### `se-mutates-input`

**The bug:** Reverses the caller's array in place. Every visible case passes; only the hidden case that checks the input is unchanged fails.

**Tests that failed:** Leaves the input alone

**Summary the learner sees:** Your code correctly calculates the sum of even numbers, but it modifies the original array by reversing it.

**Issues raised:**

- **You are changing the input array with `numbers.reverse()`. This is bad practice because it alters the data you were given instead of working on a copy.** *(line 2)*
  - Hint: How can you create a new list containing only the even numbers without touching the original one? Maybe use `filter` to check if a number is even before adding it to a new list?
- **The function returns the correct total, but the test failure shows that the input array was modified. This usually happens when you change the order or content of the original list.** *(line 1)*
  - Hint: Think about how to separate the logic of 'finding even numbers' from 'adding them up'. Do you need a temporary list to store the evens before summing them?
- **The loop iterates over `numbers`, but since you reversed it earlier, the order is wrong for some tests that expect the first item to be processed first.** *(line 4)*
  - Hint: Instead of reversing the array and then looping, could you just loop through the original array and check if each number is even inside the loop?

| Found the bug? | False alarm? | Clarity 1–5 | Notes |
|---|---|---|---|
|  |  |  |  |

### `se-hardcoded`

**The bug:** Returns the answers to the visible cases from a lookup instead of adding anything up. Passes everything shown and fails the hidden longer list.

**Tests that failed:** Works on a longer list

**Summary the learner sees:** Your code works for the specific examples in the test cases, but it fails when given a new list of numbers because it only checks for exact matches.

**Issues raised:**

- **You are checking if the input is exactly `['2', '4', '6']` by joining them into a string. This means your code will fail if someone passes `[1, 2, 3, 4]` or `[5, 5, 5]`, even though those lists have even numbers.** *(line 2)*
  - Hint: Instead of checking for specific strings, try converting each number in the array to see if it is divisible by 2. How would you write a condition that checks if a single number is even?
- **You are returning a fixed value (`12`) based on the input string, rather than actually adding up the numbers in the array.** *(line 3)*
  - Hint: Try using a loop to go through each number. If a number is even, add it to a running total. What variable name would you use to keep track of this sum?
- **Your code returns `0` for anything that doesn't match your specific examples, but the instructions say an empty array should also return `0`. Your current logic accidentally handles this, but it's because there is no case for an empty string.** *(line 7)*
  - Hint: If you build a sum by adding even numbers together, what will the total be if you never add anything to it? Does that match the requirement for an empty array?

| Found the bug? | False alarm? | Clarity 1–5 | Notes |
|---|---|---|---|
|  |  |  |  |

### `cw-strictly-greater`

**The bug:** Uses > where the instructions say at least, so a word exactly at the limit is not counted.

**Tests that failed:** Counts a word exactly at the limit, Counts every word when the limit is 1

**Summary the learner sees:** Your code correctly splits the sentence and counts words, but you are using `>` instead of `>=` when checking word length. This causes words that match the minimum length exactly to be skipped.

**Issues raised:**

- **You are checking if a word is strictly longer than the limit (`> minLength`). The instructions say words must be 'at least' the length, which means you need to include words that are exactly equal to the limit.** *(line 5)*
  - Hint: Change the comparison operator from `>` to `>=` on line 5. Try thinking about what happens if a word has the exact same number of characters as your limit.
- **Your code splits the sentence by single spaces. While this works for simple sentences, it might fail if there are multiple spaces between words or leading/trailing spaces.** *(line 3)*
  - Hint: Consider using a method that automatically handles extra whitespace, like `trim()` before splitting, or a regex split like `/\s+/`.
- **You are exporting the function as part of an object (`module.exports = { countLongWords }`).** *(line 12)*
  - Hint: Check how other beginner exercises on this platform expect their functions to be exported. Sometimes a simple `module.exports.countLongWords` or just `module.exports = countLongWords` is preferred.

| Found the bug? | False alarm? | Clarity 1–5 | Notes |
|---|---|---|---|
|  |  |  |  |

### `cw-splits-characters`

**The bug:** Splits on "" instead of " ", so it walks single characters rather than words.

**Tests that failed:** Counts words longer than the limit, Counts a word exactly at the limit, Counts every word when the limit is 1, Works on a longer sentence

**Summary the learner sees:** Your code splits the sentence into individual characters instead of words, which is why you're counting 8 items (letters) instead of 3 words.

**Issues raised:**

- **You are splitting the sentence by an empty string `""`, which breaks it into single letters. Try changing this to split by a space: `sentence.split(" ")`.** *(line 3)*
  - Hint: Think about what separates the words in your example sentence.
- **Because you're now working with individual characters instead of whole words, `word.length` is always 1. This means no word will ever meet the length requirement unless `minLength` is 1.** *(line 4)*
  - Hint: If you fix the split on line 3, how does the logic change for lines 4-6?
- **Your function returns a count based on characters, not words. Once you fix the splitting method, your counter should start matching the expected results.** *(line 8)*
  - Hint: Try running your code again after changing line 3 to `sentence.split(" ")` and see if the tests pass.

| Found the bug? | False alarm? | Clarity 1–5 | Notes |
|---|---|---|---|
|  |  |  |  |

### `cw-adds-lengths`

**The bug:** Adds each long word's length to the count instead of adding one, so it returns a number of letters.

**Tests that failed:** Counts words longer than the limit, Counts a word exactly at the limit, Counts every word when the limit is 1, Works on a longer sentence

**Summary the learner sees:** Your code counts the total number of characters in long words instead of counting how many words are long.

**Issues raised:**

- **You are adding `word.length` to the count, which adds up all the letters. You should just add `1` for every word that meets the length requirement.** *(line 5)*
  - Hint: Imagine you have a list of apples and oranges. If you want to know how many fruits there are, do you count the weight of each fruit or just say 'one' for each item?
- **The condition `word.length >= minLength` is correct, but the action inside the `if` block is wrong.** *(line 4)*
  - Hint: Try changing line 5 so that it increments the counter by one instead of adding the length of the word.
- **Your loop correctly splits the sentence into words, but the logic inside misses the goal.** *(line 3)*
  - Hint: Think about what happens if you change `count += word.length` to `count++`. Would that give you the number of words instead of characters?

| Found the bug? | False alarm? | Clarity 1–5 | Notes |
|---|---|---|---|
|  |  |  |  |

### `cw-ignores-minlength`

**The bug:** Counts every word and never looks at minLength.

**Tests that failed:** Counts words longer than the limit, Counts a word exactly at the limit, Works on a longer sentence

**Summary the learner sees:** Your code currently counts *all* words in the sentence, ignoring the `minLength` rule entirely.

**Issues raised:**

- **You are returning the total number of words without checking if they meet the length requirement.** *(line 5)*
  - Hint: How can you modify line 5 to only count a word if its length is greater than or equal to `minLength`?
- **You check for an empty sentence and return 0, which is correct.** *(line 2)*
  - Hint: This part looks good. The main issue is that you don't need to handle the empty case separately if your logic in line 5 works for all cases.
- **The function signature looks correct.** *(line 1)*
  - Hint: Make sure you are using the `minLength` variable passed into the function to filter the words.

| Found the bug? | False alarm? | Clarity 1–5 | Notes |
|---|---|---|---|
|  |  |  |  |

### `cw-off-by-one-length`

**The bug:** Compares word.length - 1 against the limit, so every word needs to be one character longer than it should.

**Tests that failed:** Counts a word exactly at the limit, Counts every word when the limit is 1

**Summary the learner sees:** Your code counts words correctly in most cases, but it is missing one character when checking word lengths. This causes it to fail for words that are exactly the minimum length.

**Issues raised:**

- **You are subtracting 1 from `word.length` before comparing it to `minLength`. This makes a 5-letter word look like a 4-letter word.** *(line 4)*
  - Hint: Why would you remove the last character of a word? Think about what happens if the sentence is 'hello' and the limit is 5. Does your code count it?
- **The `split(** *(line 3)*
  - Hint: What if the sentence has multiple spaces between words? Or no space at all? How does JavaScript handle splitting an empty string or a string with extra spaces?

| Found the bug? | False alarm? | Clarity 1–5 | Notes |
|---|---|---|---|
|  |  |  |  |

### `cw-hardcoded`

**The bug:** Returns the visible cases' answers from a lookup. Passes everything shown and fails the hidden longer sentence.

**Tests that failed:** Works on a longer sentence

**Summary the learner sees:** Your code only works for the three specific examples you wrote in, and returns 0 for everything else. It does not actually count words from a real sentence.

**Issues raised:**

- **You are checking if the sentence matches exact strings instead of counting the words inside it.** *(line 2)*
  - Hint: Try using `split(' ')` to break the sentence into pieces and then check the length of each piece. How would you loop through those pieces?
- **Because your code only has special cases for specific inputs, it fails on any new sentence.** *(line 5)*
  - Hint: Instead of returning a fixed number, imagine you start with a counter at 0. For every word that is long enough, what should you do to the counter?
- **Your function signature looks correct, but the logic inside ignores the `minLength` argument for most cases.** *(line 1)*
  - Hint: How can you compare the length of a word to `minLength` without writing out every possible case?

| Found the bug? | False alarm? | Clarity 1–5 | Notes |
|---|---|---|---|
|  |  |  |  |

### `gr-no-default`

**The bug:** The greeting parameter has no default, so calling greet("Ada") puts the word undefined in the result.

**Tests that failed:** Falls back to Hello when no greeting is given, Calls an empty name friend, Keeps the given greeting for an empty name

**Summary the learner sees:** Your code works perfectly when you give it both arguments, but it doesn't handle missing or empty inputs yet.

**Issues raised:**

- **When `greeting` is missing, JavaScript treats it as `undefined`, so your string becomes `'undefined, Ada!'`. You need to check if the greeting was provided and use 'Hello' as a default instead.** *(line 2)*
  - Hint: Try using an `if` statement or the `||` operator to see if `greeting` exists before combining it into the string.
- **When `name` is empty (like ''), your code still puts that empty space in the result, creating `'Hello, !'`. You need to check if the name is missing or empty and replace it with 'friend'.** *(line 2)*
  - Hint: Think about how you would say 'Hello, friend!' instead of 'Hello, [empty string]!'. Do you need another `if` statement to handle this case?
- **Your current logic only combines the two parts. If one part is missing or empty, it breaks the sentence structure.** *(line 2)*
  - Hint: You might want to build the string in steps: first decide what greeting to use, then decide what name to use, and finally put them together.

| Found the bug? | False alarm? | Clarity 1–5 | Notes |
|---|---|---|---|
|  |  |  |  |

### `gr-no-empty-name`

**The bug:** Has the default greeting but never checks for an empty name, so greet("") returns "Hello, !".

**Tests that failed:** Calls an empty name friend, Keeps the given greeting for an empty name

**Summary the learner sees:** Your code handles the greeting and default values perfectly, but it doesn't check if the `name` is empty before adding it to the sentence.

**Issues raised:**

- **You are always adding the `name` variable to your message, even when it's empty. You need to add a check to see if `name` is empty and replace it with 'friend' in that case.** *(line 2)*
  - Hint: Try using an `if` statement to check if `name` is empty (like `if (!name)`). If it is, change the part of your sentence where `name` goes to say 'friend' instead.
- **Because you didn't handle the empty name case, your code currently outputs 'Hello, !' when no name is provided.** *(line 2)*
  - Hint: Think about how you would write a sentence that says 'friend' instead of the variable `name` only when `name` doesn't have any text in it.
- **Your current logic doesn't distinguish between a missing name and an actual name, so it fails the test expecting 'Welcome, friend!' instead of 'Welcome, !'.** *(line 2)*
  - Hint: Recall how you handled the default greeting? You might need something similar for the name: check if it exists first, then decide what to put in your string.

| Found the bug? | False alarm? | Clarity 1–5 | Notes |
|---|---|---|---|
|  |  |  |  |

### `gr-drops-greeting-for-friend`

**The bug:** Returns a fixed "Hello, friend!" for an empty name, throwing away the greeting that was passed in.

**Tests that failed:** Keeps the given greeting for an empty name

**Summary the learner sees:** Your code works great for most cases! The only issue is that when the `name` is empty but a custom `greeting` is provided (like 'Welcome'), your function ignores the custom greeting and always uses 'Hello'.

**Issues raised:**

- **When checking if the name is empty, you are using the default value ('Hello') instead of the actual argument passed by the user.** *(line 2)*
  - Hint: Try changing the condition on line 2 to check if `name` is an empty string (`''`) without comparing it to the word 'Hello'. Does that make sense?
- **Because of the issue above, when a custom greeting like 'Welcome' is given with an empty name, your code returns 'Hello, friend!' instead of 'Welcome, friend!'.** *(line 3)*
  - Hint: You need to use the `greeting` variable you received in the function definition (line 1) inside the return statement on line 3. Can you try replacing 'Hello' with `greeting` there?
- **Your logic for building the final string looks correct once the empty name check is fixed.** *(line 5)*
  - Hint: Just double-check that you are concatenating the variables in the right order: greeting, comma, space, and name.

| Found the bug? | False alarm? | Clarity 1–5 | Notes |
|---|---|---|---|
|  |  |  |  |

### `gr-ignores-greeting`

**The bug:** Always says "Hello" and ignores the greeting argument entirely.

**Tests that failed:** Uses the greeting it was given, Keeps the given greeting for an empty name, Works for any name

**Summary the learner sees:** Your code correctly handles the default greeting and empty names, but it always uses 'Hello' instead of using the `greeting` argument you passed in.

**Issues raised:**

- **You are hardcoding 'Hello' in your return statement. The test expects the function to use whatever greeting was passed in (like 'Hi'), but your code always says 'Hello'.** *(line 3)*
  - Hint: Look at line 3. Instead of writing 'Hello', try using the variable `greeting` that you already defined on line 1.
- **When the name is empty, your code currently returns 'Hello, friend!'. The test expects it to return the greeting you passed in (e.g., 'Welcome, friend!') combined with 'friend'.** *(line 2)*
  - Hint: On line 3, make sure you are putting the `greeting` variable right before the comma. Try changing 'Hello' to `greeting` there.
- **Your function signature looks correct (`function greet(name, greeting = ** *(line 1)*
  - Hint: The default value for `greeting` is set correctly on line 1, which is why the second test passes. The issue is purely in how you construct the string on line 3.

| Found the bug? | False alarm? | Clarity 1–5 | Notes |
|---|---|---|---|
|  |  |  |  |

## Roadmap AI

Does the recommended track suit the learner, and does the explanation engage
with what they actually said they wanted?

### `complete-beginner`

**Profile:** Has never programmed. Either track is defensible; the order must start from the basics and skip nothing.

**Recommended track:** Frontend · 12 modules · already passed 0

**Explanation:** I chose the Frontend track because it is the most common first job and allows you to see your work immediately, which fits your goal of getting a job quickly. At the end of this roadmap, you will reach the technology decision where you pick a framework to build upon these core skills.

| Track appropriate? | Explanation engages the goal? | Notes |
|---|---|---|
|  |  |  |

### `comfortable-js`

**Profile:** Comfortable and four modules in. The roadmap should carry on from arrays and objects rather than restart.

**Recommended track:** Frontend · 12 modules · already passed 4

**Explanation:** I recommend the Frontend track because it aligns with your goal of building small things you can see immediately, which is ideal for a portfolio. At the technology decision point, you will choose a framework to build upon these fundamentals.

| Track appropriate? | Explanation engages the goal? | Notes |
|---|---|---|
|  |  |  |

### `freelance-goal`

**Profile:** Wants freelance work, 20 hours a week. Check whether the explanation engages with the goal or ignores it.

**Recommended track:** Frontend · 12 modules · already passed 1

**Explanation:** Since you want freelance or client work and prefer seeing your results immediately, the Frontend track is the best fit for building a visible portfolio. You will start with the core modules you already passed, then move through layout and data handling before choosing your specific framework at the technology decision point.

| Track appropriate? | Explanation engages the goal? | Notes |
|---|---|---|
|  |  |  |

### `backend-leaning`

**Profile:** The one profile written to test whether the model ever recommends the backend track, or defaults to frontend for everyone.

**Recommended track:** Frontend · 12 modules · already passed 3

**Explanation:** I recommend the Frontend track because it aligns with your goal of building small things independently and having a portfolio that companies can see immediately. At the technology decision point, you will choose a framework to build upon these core skills.

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

**Summary:** Aspiring developer with foundational knowledge of programming concepts and web development principles.

**Skills printed:** *none*

**Removed as unsupported:** none — every skill the model named was verified.

**What to check:** Nothing is verified. The summary must not claim any skill or experience, and the skills list must come back empty after grounding.

| Any unsupported claim left? | Reads as experience? | Quality 1–5 | ATS parse | Notes |
|---|---|---|---|---|
|  |  |  |  |  |

### `one-skill`

**Target job:** Junior Front-End Developer

**Verified evidence:** HTML

**Summary:** Foundational web development skills demonstrated through completion of HTML modules.

**Skills printed:** HTML

**Removed as unsupported:** none — every skill the model named was verified.

**What to check:** One skill. A short, honest summary; no invented breadth.

| Any unsupported claim left? | Reads as experience? | Quality 1–5 | ATS parse | Notes |
|---|---|---|---|---|
|  |  |  |  |  |

### `skills-only`

**Target job:** Junior Front-End Developer

**Verified evidence:** HTML, CSS, JavaScript

**Summary:** Foundational knowledge of web development structures and logic through completed modules in HTML, CSS, and JavaScript.

**Skills printed:** JavaScript, CSS, HTML

**Removed as unsupported:** none — every skill the model named was verified.

**What to check:** §9.1's 'skills only' level. Watch for React, Node, Git or 'responsive design' appearing unsupported.

| Any unsupported claim left? | Reads as experience? | Quality 1–5 | ATS parse | Notes |
|---|---|---|---|---|
|  |  |  |  |  |

### `tested-out`

**Target job:** Junior Web Developer

**Verified evidence:** HTML, CSS

**Summary:** Foundational web development skills demonstrated through completed assessments in HTML and CSS.

**Skills printed:** HTML, CSS

**Removed as unsupported:** none — every skill the model named was verified.

**What to check:** Both skills were tested out rather than worked through. The resume must not describe study time or coursework that did not happen.

| Any unsupported claim left? | Reads as experience? | Quality 1–5 | ATS parse | Notes |
|---|---|---|---|---|
|  |  |  |  |  |

### `with-certificate`

**Target job:** Junior Web Developer

**Verified evidence:** HTML, CSS, JavaScript, Git

**Summary:** Front-end developer with proven expertise in HTML, CSS, JavaScript, and Git through completed assessments and certification. Certified as a Junior Web Developer specializing in front-end technologies.

**Skills printed:** JavaScript, HTML, CSS, Git

**Removed as unsupported:** none — every skill the model named was verified.

**What to check:** §9.1's 'certificate' level. A certificate is still study, not employment — any sentence implying a job is a failure.

| Any unsupported claim left? | Reads as experience? | Quality 1–5 | ATS parse | Notes |
|---|---|---|---|---|
|  |  |  |  |  |

### `career-changer`

**Target job:** Junior Back-End Developer

**Verified evidence:** JavaScript, HTTP and servers

**Summary:** Developers with proven proficiency in JavaScript and server-side HTTP protocols, demonstrated through completed module assessments.

**Skills printed:** JavaScript, HTTP and servers

**Removed as unsupported:** none — every skill the model named was verified.

**What to check:** The target job is backend and the evidence is thin. The strongest pull towards inventing experience — check the summary sentence by sentence.

| Any unsupported claim left? | Reads as experience? | Quality 1–5 | ATS parse | Notes |
|---|---|---|---|---|
|  |  |  |  |  |
