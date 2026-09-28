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

**Summary the learner sees:** Your loop skips the first number and starts at index 1, which causes you to miss the first even number in the array.

**Issues raised:**

- **You start your loop at `i = 1`, but arrays are zero-indexed. This means you skip `numbers[0]` (the first item) and never check it.** *(line 3)*
  - Hint: Try changing the starting value of `i`. What should the first index be if you want to check every single number in the array?
- **Because you skip the first item, your code fails tests that expect the very first number to be included (like `[2, 4, 6]` summing to 12).** *(line 3)*
  - Hint: If you change line 3 to start at `0`, will your loop now check every element in the array?
- **Your logic for adding even numbers is correct, but the loop condition prevents it from running on the first item.** *(line 8)*
  - Hint: The test results show that negative numbers also fail because they are skipped by the same starting index issue. Fixing the start index should fix both failures.

| Found the bug? | False alarm? | Clarity 1–5 | Notes |
|---|---|---|---|
|  |  |  |  |

### `se-odd-not-even`

**The bug:** Tests for a remainder of 1, so it adds up the odd numbers instead of the even ones.

**Tests that failed:** Sums [2, 4, 6] to 12, Ignores odd numbers, Handles negative numbers, Includes the first item, Works on a longer list

**Summary the learner sees:** Your code is checking for odd numbers instead of even ones, which is why it's not adding anything up correctly.

**Issues raised:**

- **You are checking if a number is odd (`% 2 === 1`) and only adding it to the total. But the instructions ask you to add **even** numbers.** *(line 4)*
  - Hint: Try changing the condition on line 4 so that it checks for even numbers instead of odd ones.
- **You are using a `for` loop with an index (`i`) to access each number. While this works, you can also use a `for...of` loop or `forEach` to iterate directly over the numbers without needing an index.** *(line 3)*
  - Hint: Consider if there's a simpler way to write your loop that doesn't require calculating the index manually.
- **Your function returns the total, but because of the logic error on line 4, it's returning 0 for most cases.** *(line 8)*
  - Hint: Once you fix the condition to check for even numbers, your function should start returning the correct sums.

| Found the bug? | False alarm? | Clarity 1–5 | Notes |
|---|---|---|---|
|  |  |  |  |

### `se-assigns-not-adds`

**The bug:** Uses = instead of +=, so the total is overwritten each time and only the last even number survives.

**Tests that failed:** Sums [2, 4, 6] to 12, Ignores odd numbers, Handles negative numbers, Works on a longer list

**Summary the learner sees:** Your code finds even numbers but only keeps the last one instead of adding them together.

**Issues raised:**

- **You are replacing the total with each new even number you find (`total = numbers[i]`), instead of adding it to what you already have.** *(line 5)*
  - Hint: Change line 5 so that `total` grows by adding the current number to itself. Try using the `+` operator here.
- **The check for even numbers is correct, but the way you update the total breaks the sum.** *(line 4)*
  - Hint: Think about how a running total works: start with zero and keep adding. Does your line 5 do that?
- **You return `total` at the end, which is fine once you fix the loop logic.** *(line 8)*
  - Hint: Once you fix how `total` is updated inside the loop, this return line should work correctly on its own.

| Found the bug? | False alarm? | Clarity 1–5 | Notes |
|---|---|---|---|
|  |  |  |  |

### `se-returns-inside-loop`

**The bug:** The return is inside the loop, so it stops after the first even number.

**Tests that failed:** Sums [2, 4, 6] to 12, Ignores odd numbers, Handles negative numbers, Works on a longer list

**Summary the learner sees:** Your code stops adding numbers as soon as it finds one even number, so it only returns that single number instead of the total sum.

**Issues raised:**

- **You have a `return` statement inside your `if` block. This means the function exits immediately after finding the first even number and never checks the rest of the array.** *(line 6)*
  - Hint: Think about where you should put the `return total` line so it runs only after checking every single number in the list.
- **The condition `numbers[i] % 2 === 0` is correct for finding even numbers.** *(line 4)*
  - Hint: Since you need to check all numbers, maybe try moving this check outside of the `if` block that currently stops execution.
- **You are adding the number to `total`, which is good logic.** *(line 5)*
  - Hint: If you move the addition to happen after checking every item in the loop, will the final sum be calculated correctly?

| Found the bug? | False alarm? | Clarity 1–5 | Notes |
|---|---|---|---|
|  |  |  |  |

### `se-skips-negatives`

**The bug:** Also requires the number to be positive, so negative even numbers are left out.

**Tests that failed:** Handles negative numbers

**Summary the learner sees:** Your code works great for positive even numbers and handles edge cases like empty arrays perfectly! The only issue is that you're currently ignoring negative even numbers because of an extra check.

**Issues raised:**

- **You have a condition `n > 0` which stops the function from adding negative numbers. Since -2 and -4 are even, they should be included in the sum.** *(line 4)*
  - Hint: Try removing that part of the check to see if your code starts working for negative inputs.
- **Your function name `sumEven` is clear and follows best practices. No changes needed here.** *(line 1)*
  - Hint: Keep going with this naming style!
- **Using `for...of` to iterate through the array is a clean choice for beginners. It's easy to read and works well here.** *(line 3)*
  - Hint: You're using modern JavaScript syntax correctly.

| Found the bug? | False alarm? | Clarity 1–5 | Notes |
|---|---|---|---|
|  |  |  |  |

### `se-mutates-input`

**The bug:** Reverses the caller's array in place. Every visible case passes; only the hidden case that checks the input is unchanged fails.

**Tests that failed:** Leaves the input alone

**Summary the learner sees:** Your code correctly calculates the sum of even numbers, but it modifies the original array by reversing it.

**Issues raised:**

- **You are reversing the input array with `numbers.reverse()`. This changes the original data, which is usually not allowed in functions unless you explicitly say so.** *(line 2)*
  - Hint: Think about how to check if a number is even without changing the order of the list. Do you need to create a new copy of the list first?
- **The loop uses `for (const n of numbers)`, which iterates over the reversed array. While this works for the math, it's inefficient because you're processing every item even if they are odd.** *(line 4)*
  - Hint: Can you add a check inside the loop to skip non-even numbers instead of iterating through them all?
- **The test failure 'Leaves the input alone' means your function should not alter the original array.** *(line 12)*
  - Hint: Try using `numbers.slice()` to create a new copy of the array before reversing it, or just iterate directly without modifying the input. **← gives code?**

| Found the bug? | False alarm? | Clarity 1–5 | Notes |
|---|---|---|---|
|  |  |  |  |

### `se-hardcoded`

**The bug:** Returns the answers to the visible cases from a lookup instead of adding anything up. Passes everything shown and fails the hidden longer list.

**Tests that failed:** Works on a longer list

**Summary the learner sees:** Your code works for the specific examples in the tests, but it fails when given a new list of numbers because you are checking for exact matches instead of calculating the sum.

**Issues raised:**

- **You are converting the array to a string and comparing it exactly. This means your function only works if the input is one of those four specific lists.** *(line 2)*
  - Hint: Instead of checking if `key` equals '2,4,6', try using a loop or a method that looks at each number individually to see if it is even.
- **Returning specific numbers based on the input list makes your code hard to use. If someone passes `[2, 8, 10]`, your code will return 0 because that list isn't in your 'if' statements.** *(line 3)*
  - Hint: Think about how you can add up numbers without needing to know what they are beforehand. Do you need a `for` loop or a method like `reduce`?
- **The function signature is correct, but the logic inside needs to change from 'checking specific cases' to 'processing any input'.** *(line 1)*
  - Hint: Try writing code that iterates through `numbers`, checks if a number is divisible by 2, and adds it to a total variable.

| Found the bug? | False alarm? | Clarity 1–5 | Notes |
|---|---|---|---|
|  |  |  |  |

### `cw-strictly-greater`

**The bug:** Uses > where the instructions say at least, so a word exactly at the limit is not counted.

**Tests that failed:** Counts a word exactly at the limit, Counts every word when the limit is 1

**Summary the learner sees:** Your code correctly splits the sentence and counts words, but it uses `>` instead of `>=`. This means a word that is exactly the length of your limit isn't counted.

**Issues raised:**

- **You are checking if the word length is strictly greater than the limit (`>`) instead of greater than or equal to (`>=`).** *(line 5)*
  - Hint: The instructions say words must be 'at least' `minLength` characters long. Does your condition include words that match the limit exactly?
- **Your loop iterates over every word in the sentence.** *(line 4)*
  - Hint: Since you are using `split(
- **You are checking if the word length is strictly greater than the limit (`>`) instead of greater than or equal to (`>=`).** *(line 5)*
  - Hint: The instructions say words must be 'at least' `minLength` characters long. Does your condition include words that match the limit exactly?

| Found the bug? | False alarm? | Clarity 1–5 | Notes |
|---|---|---|---|
|  |  |  |  |

### `cw-splits-characters`

**The bug:** Splits on "" instead of " ", so it walks single characters rather than words.

**Tests that failed:** Counts words longer than the limit, Counts a word exactly at the limit, Counts every word when the limit is 1, Works on a longer sentence

**Summary the learner sees:** Your code splits the sentence into individual characters instead of whole words, which is why you're counting every character as a word.

**Issues raised:**

- **You are splitting the sentence by empty string (''), which breaks each word into single letters. Try changing `split('')` to split by spaces instead.** *(line 3)*
  - Hint: What delimiter separates words in a sentence? How would you write that?
- **Because of the incorrect split, your loop runs many more times than there are actual words, causing the count to be way too high.** *(line 3)*
  - Hint: If you fix the split method, will the number of iterations match the number of words in a sentence like 'hello world'?
- **The empty sentence test passes because an empty string split by spaces results in an empty array, but this is coincidental to your current logic.** *(line 3)*
  - Hint: Once you fix the splitting method, will the empty sentence case still work correctly?

| Found the bug? | False alarm? | Clarity 1–5 | Notes |
|---|---|---|---|
|  |  |  |  |

### `cw-adds-lengths`

**The bug:** Adds each long word's length to the count instead of adding one, so it returns a number of letters.

**Tests that failed:** Counts words longer than the limit, Counts a word exactly at the limit, Counts every word when the limit is 1, Works on a longer sentence

**Summary the learner sees:** Your code counts characters instead of words.

**Issues raised:**

- **You are adding `word.length` to the count, which adds up all the letters in every long word. You need to add `1` for each word that meets the length requirement.** *(line 5)*
  - Hint: Imagine you have a list of apples and oranges. If you want to count how many fruits there are, do you add the number of seeds in each fruit? Or do you just say 'one' for every single fruit you find?
- **The condition `word.length >= minLength` is correct for finding long words, but the action inside the `if` block is wrong.** *(line 4)*
  - Hint: Think about what happens when `minLength` is 1. Every single letter in your sentence would be considered a 'long word' if you keep adding their lengths together.
- **Your loop structure looks good for iterating through the words, but the logic inside needs to change.** *(line 3)*
  - Hint: Try changing line 5 so that it increments the counter by one every time a word is found, regardless of how many letters that specific word has.

| Found the bug? | False alarm? | Clarity 1–5 | Notes |
|---|---|---|---|
|  |  |  |  |

### `cw-ignores-minlength`

**The bug:** Counts every word and never looks at minLength.

**Tests that failed:** Counts words longer than the limit, Counts a word exactly at the limit, Works on a longer sentence

**Summary the learner sees:** Your code counts all words in the sentence but ignores the `minLength` rule entirely.

**Issues raised:**

- **You are returning the total number of words without checking if they meet the length requirement.** *(line 5)*
  - Hint: Try adding a loop to go through each word and check its length before counting it.
- **Your empty sentence check is correct, but you might need to handle cases where `minLength` is greater than any word's length.** *(line 2)*
  - Hint: What if the sentence has words, but none of them are long enough? How should your function behave then?
- **The `split(' ')` method breaks the sentence into an array, but you're not using that array to filter by length.** *(line 5)*
  - Hint: Can you use a `for...of` loop or `forEach` to iterate through the words and count only those that satisfy the condition?

| Found the bug? | False alarm? | Clarity 1–5 | Notes |
|---|---|---|---|
|  |  |  |  |

### `cw-off-by-one-length`

**The bug:** Compares word.length - 1 against the limit, so every word needs to be one character longer than it should.

**Tests that failed:** Counts a word exactly at the limit, Counts every word when the limit is 1

**Summary the learner sees:** Your code counts words correctly in most cases, but you are subtracting 1 from the word length before comparing it to the minimum length. This makes your condition stricter than needed.

**Issues raised:**

- **You wrote `word.length - 1 >= minLength`, which means a word must be at least one character longer than the limit to count.** *(line 4)*
  - Hint: Think about what happens if a word is exactly the same length as `minLength`. Should it count? If yes, remove that `- 1` so you compare the actual length directly.
- **Your loop splits the sentence by spaces and iterates over each part. This works for sentences with single spaces between words.** *(line 3)*
  - Hint: The instructions say words are separated by 'single spaces'. Is there any edge case where multiple spaces might appear that your current split logic could miss or handle incorrectly?
- **You return the count at the end of the function.** *(line 8)*
  - Hint: The tests pass for empty sentences. Does your code still work correctly if `sentence` is an empty string (`''`) or contains only spaces? Try tracing through what happens when there are no words to split.

| Found the bug? | False alarm? | Clarity 1–5 | Notes |
|---|---|---|---|
|  |  |  |  |

### `cw-hardcoded`

**The bug:** Returns the visible cases' answers from a lookup. Passes everything shown and fails the hidden longer sentence.

**Tests that failed:** Works on a longer sentence

**Summary the learner sees:** Your code only checks for specific examples and returns 0 for everything else. It doesn't actually count words in a general sentence.

**Issues raised:**

- **You are checking if the sentence equals 'the quick brown fox' exactly. This means your function will never work on any other sentence, even if it follows the rules.** *(line 2)*
  - Hint: Instead of checking for exact matches, try splitting the sentence into a list of words first. How would you separate the words by spaces?
- **You return 0 immediately after your specific checks. This means if a new sentence comes in that isn't one of your examples, the function stops working there.** *(line 5)*
  - Hint: After splitting the words, you need to check each word's length against `minLength`. How can you count how many words meet that condition?
- **Your function definition looks correct, but the logic inside is too rigid. It fails the 'Works on a longer sentence' test because it doesn't handle general cases.** *(line 1)*
  - Hint: Think about how to loop through every word in the sentence and count them if they are long enough. Do you need a `for` loop or a method that does this for you?

| Found the bug? | False alarm? | Clarity 1–5 | Notes |
|---|---|---|---|
|  |  |  |  |

### `gr-no-default`

**The bug:** The greeting parameter has no default, so calling greet("Ada") puts the word undefined in the result.

**Tests that failed:** Falls back to Hello when no greeting is given, Calls an empty name friend, Keeps the given greeting for an empty name

**Summary the learner sees:** Your code works when both arguments are provided, but it doesn't handle missing or empty values correctly. You need to add logic to check if `greeting` is missing and default it to 'Hello', and similarly for an empty `name`.

**Issues raised:**

- **You are using the `greeting` variable directly without checking if it exists. If no greeting is passed, JavaScript treats it as `undefined`, which gets printed in your output.** *(line 2)*
  - Hint: Try adding a check at the beginning of the function to see if `greeting` has been provided. If not, assign it the value 'Hello' before using it.
- **Similarly, you are using `name` directly without checking if it is empty. When `name` is an empty string, your code still tries to print it.** *(line 2)*
  - Hint: Add a condition to check if `name` is empty (like `if (!name)`). If it is, change the output to include 'friend' instead of the empty name. **← gives code?**
- **Your current logic doesn't combine the fallback rules correctly. For example, if the name is empty but a custom greeting is given, you still get an incorrect result.** *(line 2)*
  - Hint: Think about the order of operations: should you set the default greeting first, and then check for the empty name? Try writing separate `if` statements to handle each case clearly.

| Found the bug? | False alarm? | Clarity 1–5 | Notes |
|---|---|---|---|
|  |  |  |  |

### `gr-no-empty-name`

**The bug:** Has the default greeting but never checks for an empty name, so greet("") returns "Hello, !".

**Tests that failed:** Calls an empty name friend, Keeps the given greeting for an empty name

**Summary the learner sees:** Your code handles the greeting and default values perfectly, but it doesn't check if the `name` is empty before adding it to the message.

**Issues raised:**

- **You are always adding the `name` variable to your string. If `name` is empty (like an empty string), you get a space and exclamation mark instead of 'friend!'.** *(line 2)*
  - Hint: Try adding a check before line 2 to see if `name` is empty. If it is, replace it with the word 'friend' in your return statement.
- **Your function signature looks correct for handling the default greeting.** *(line 1)*
  - Hint: Since this part works, focus entirely on fixing the empty name logic first.
- **The string concatenation `greeting + ** *(line 2)*
  - Hint: friend!

| Found the bug? | False alarm? | Clarity 1–5 | Notes |
|---|---|---|---|
|  |  |  |  |

### `gr-drops-greeting-for-friend`

**The bug:** Returns a fixed "Hello, friend!" for an empty name, throwing away the greeting that was passed in.

**Tests that failed:** Keeps the given greeting for an empty name

**Summary the learner sees:** Your code handles most cases correctly, but there is one logic error when the `name` is empty and a specific `greeting` is provided.

**Issues raised:**

- **When you check if the name is empty, you always return 'Hello, friend!' regardless of what greeting was passed in. The instructions say to use whichever greeting was given.** *(line 3)*
  - Hint: Try changing line 3 so it uses the `greeting` variable instead of hardcoding 'Hello'. How would you combine the variables?

| Found the bug? | False alarm? | Clarity 1–5 | Notes |
|---|---|---|---|
|  |  |  |  |

### `gr-ignores-greeting`

**The bug:** Always says "Hello" and ignores the greeting argument entirely.

**Tests that failed:** Uses the greeting it was given, Keeps the given greeting for an empty name, Works for any name

**Summary the learner sees:** Your code uses the default greeting correctly and handles empty names well, but it always returns 'Hello' instead of using whatever `greeting` argument you passed in.

**Issues raised:**

- **You are hardcoding 'Hello' in your return statement. The function should use the value of the `greeting` variable if it was provided.** *(line 3)*
  - Hint: Try changing line 3 to include the `greeting` variable instead of just writing 'Hello'. How would you combine the parts so that if someone passes 'Hi', it becomes 'Hi, Ada!'?
- **When checking if the name is empty, you are comparing it to an empty string `''`. This works for strings but might not work correctly if someone passes `null` or `undefined`.** *(line 2)*
  - Hint: What happens in JavaScript when you compare `null` or `undefined` to an empty string? Would it be safer to check if the name is 'falsy' (like `!name`) instead?
- **Your function signature looks correct for a default parameter, but the logic inside doesn't use that default value when a greeting is explicitly provided.** *(line 1)*
  - Hint: Think about how you would write the return statement so that it uses `greeting` if it exists, and falls back to 'Hello' otherwise. Can you use a ternary operator or an `if/else` block here?

| Found the bug? | False alarm? | Clarity 1–5 | Notes |
|---|---|---|---|
|  |  |  |  |

## Roadmap AI

Does the recommended track suit the learner, and does the explanation engage
with what they actually said they wanted?

### `complete-beginner`

**Profile:** Has never programmed. Either track is defensible; the order must start from the basics and skip nothing.

**Recommended track:** Frontend · 12 modules · already passed 0

**Explanation:** I chose the Frontend track because it aligns with your goal of seeing your work immediately and building a portfolio for a Junior Web Developer role. At the end of this roadmap, you will reach the technology decision to pick a specific framework before continuing.

| Track appropriate? | Explanation engages the goal? | Notes |
|---|---|---|
|  |  |  |

### `beginner-few-hours`

**Profile:** Same as the complete beginner but with 3 hours a week. The plan should not change — only the estimate, which the platform computes.

**Recommended track:** Frontend · 12 modules · already passed 0

**Explanation:** I chose the Frontend track because it aligns with your goal of seeing your work immediately and building a portfolio, which is common for junior web developer roles. At the technology decision point, you will select a framework to build upon these foundational skills.

| Track appropriate? | Explanation engages the goal? | Notes |
|---|---|---|
|  |  |  |

### `some-html-css`

**Profile:** Already passed HTML and CSS. Neither may appear again, and the frontend track is the natural recommendation.

**Recommended track:** Frontend · 12 modules · already passed 2

**Explanation:** Since you want a job as a Junior Web Developer and the Frontend track is the most common first job, we will start with that path. At the technology decision point, you will choose your framework to build upon these core skills.

| Track appropriate? | Explanation engages the goal? | Notes |
|---|---|---|
|  |  |  |

### `comfortable-js`

**Profile:** Comfortable and four modules in. The roadmap should carry on from arrays and objects rather than restart.

**Recommended track:** Frontend · 12 modules · already passed 4

**Explanation:** I recommend the Frontend track because it aligns with your goal of building small things you can see immediately and showing them in a portfolio, which is the most common first job for web developers. At the technology decision point after completing these modules, you will choose a framework to build upon this foundation.

| Track appropriate? | Explanation engages the goal? | Notes |
|---|---|---|
|  |  |  |

### `freelance-goal`

**Profile:** Wants freelance work, 20 hours a week. Check whether the explanation engages with the goal or ignores it.

**Recommended track:** Frontend · 12 modules · already passed 1

**Explanation:** I recommend the Frontend track because it aligns with your goal of freelance or client work, where seeing your design immediately is essential. At the end of this path, you will make a technology decision to choose your specific framework.

| Track appropriate? | Explanation engages the goal? | Notes |
|---|---|---|
|  |  |  |

### `backend-leaning`

**Profile:** The one profile written to test whether the model ever recommends the backend track, or defaults to frontend for everyone.

**Recommended track:** Frontend · 12 modules · already passed 3

**Explanation:** I chose the Frontend track because it aligns with your goal of building small things you can see immediately and showing them in a portfolio. At the technology decision point, you will select a framework to build upon these core skills.

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

**Summary:** Learner with foundational knowledge of web development concepts and tools.

**Skills printed:** *none*

**Removed as unsupported:** none — every skill the model named was verified.

**What to check:** Nothing is verified. The summary must not claim any skill or experience, and the skills list must come back empty after grounding.

| Any unsupported claim left? | Reads as experience? | Quality 1–5 | ATS parse | Notes |
|---|---|---|---|---|
|  |  |  |  |  |

### `one-skill`

**Target job:** Junior Front-End Developer

**Verified evidence:** HTML

**Summary:** Junior Front-End Developer with proven proficiency in HTML through two completed modules. Ready to apply foundational web structure knowledge to build responsive and accessible user interfaces.

**Skills printed:** HTML

**Removed as unsupported:** none — every skill the model named was verified.

**What to check:** One skill. A short, honest summary; no invented breadth.

| Any unsupported claim left? | Reads as experience? | Quality 1–5 | ATS parse | Notes |
|---|---|---|---|---|
|  |  |  |  |  |

### `skills-only`

**Target job:** Junior Front-End Developer

**Verified evidence:** HTML, CSS, JavaScript

**Summary:** Foundational knowledge of web development technologies including HTML, CSS, and JavaScript.

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

**Summary:** Front-end developer with proven expertise in HTML, CSS, JavaScript, and Git through completed assessments. Holds a Junior Web Developer — Front-End certification.

**Skills printed:** JavaScript, HTML, CSS, Git

**Removed as unsupported:** none — every skill the model named was verified.

**What to check:** §9.1's 'certificate' level. A certificate is still study, not employment — any sentence implying a job is a failure.

| Any unsupported claim left? | Reads as experience? | Quality 1–5 | ATS parse | Notes |
|---|---|---|---|---|
|  |  |  |  |  |

### `career-changer`

**Target job:** Junior Back-End Developer

**Verified evidence:** JavaScript, HTTP and servers

**Summary:** Junior developer with proven expertise in JavaScript and server-side technologies through completed assessments. Strong foundation in building HTTP connections and managing server operations.

**Skills printed:** JavaScript, HTTP and servers

**Removed as unsupported:** none — every skill the model named was verified.

**What to check:** The target job is backend and the evidence is thin. The strongest pull towards inventing experience — check the summary sentence by sentence.

| Any unsupported claim left? | Reads as experience? | Quality 1–5 | ATS parse | Notes |
|---|---|---|---|---|
|  |  |  |  |  |
