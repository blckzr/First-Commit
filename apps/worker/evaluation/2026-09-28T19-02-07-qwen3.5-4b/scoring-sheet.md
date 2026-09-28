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

- **The loop starts counting from index 1 instead of index 0. This means the first number in your array is never checked or added.** *(line 3)*
  - Hint: Change the starting value of `i` so that it begins at the very first position of the array.
- **Because you start at index 1, the loop condition `i < numbers.length` might stop before checking the last item if the array length is small.** *(line 3)*
  - Hint: Try changing the comparison operator or the starting value to ensure every single index from 0 up to the end is visited.
- **The same starting issue causes problems with negative numbers because the first negative number is also skipped.** *(line 3)*
  - Hint: Think about how changing the start of your loop would fix the test that expects -6 but gets -4.

| Found the bug? | False alarm? | Clarity 1–5 | Notes |
|---|---|---|---|
|  |  |  |  |

### `se-odd-not-even`

**The bug:** Tests for a remainder of 1, so it adds up the odd numbers instead of the even ones.

**Tests that failed:** Sums [2, 4, 6] to 12, Ignores odd numbers, Handles negative numbers, Includes the first item, Works on a longer list

**Summary the learner sees:** Your code is checking for odd numbers and adding them, but you need to check for even numbers instead.

**Issues raised:**

- **You are currently adding numbers that divide evenly by 2 with a remainder of 1. That describes odd numbers, not even ones.** *(line 4)*
  - Hint: Think about what happens when you divide an even number by 2. What should the remainder be for a number to be added?
- **Because of the check on line 4, your code is skipping the numbers you actually want to add.** *(line 5)*
  - Hint: If you fix the condition on line 4 so it catches even numbers, will the total start accumulating correctly?
- **The function returns the final sum, which is correct in structure, but the value inside depends on the logic above.** *(line 8)*
  - Hint: Once the condition is fixed, does the return statement need any changes to work properly?

| Found the bug? | False alarm? | Clarity 1–5 | Notes |
|---|---|---|---|
|  |  |  |  |

### `se-assigns-not-adds`

**The bug:** Uses = instead of +=, so the total is overwritten each time and only the last even number survives.

**Tests that failed:** Sums [2, 4, 6] to 12, Ignores odd numbers, Handles negative numbers, Works on a longer list

**Summary the learner sees:** Your code checks if numbers are even, but it only keeps the last even number instead of adding them all together.

**Issues raised:**

- **You are replacing the total with each new even number found. You should be adding the current number to the total instead.** *(line 5)*
  - Hint: Change line 5 so that you add `numbers[i]` to `total`. Try using the `+` operator.
- **The logic for checking even numbers is correct, but the action taken inside the `if` block is wrong.** *(line 4)*
  - Hint: Think about what happens when you find a new even number. Do you want to store it or combine it with your running total?
- **The function returns the final value of `total`, which is correct in structure, but because of the issue above, it only holds the last even number.** *(line 8)*
  - Hint: Once you fix how `total` is updated inside the loop, this return statement should work correctly on its own.

| Found the bug? | False alarm? | Clarity 1–5 | Notes |
|---|---|---|---|
|  |  |  |  |

### `se-returns-inside-loop`

**The bug:** The return is inside the loop, so it stops after the first even number.

**Tests that failed:** Sums [2, 4, 6] to 12, Ignores odd numbers, Handles negative numbers, Works on a longer list

**Summary the learner sees:** Your code stops adding numbers as soon as it finds one even number, which is why it only returns the first match instead of the total sum.

**Issues raised:**

- **The `return` statement inside the `if` block exits the function immediately after checking just one number. This means the loop never continues to check the rest of the array.** *(line 6)*
  - Hint: Move the line that ends the function so it sits outside the `if` block, allowing the loop to finish checking all numbers before returning the result.
- **The variable `total` starts at 0, which is correct for an empty array, but since the function returns early on the first even number, this initialization never gets used for sums with multiple numbers.** *(line 2)*
  - Hint: Think about where the final sum should be returned. Should it happen after the loop finishes or inside the loop?
- **The loop structure looks good, but because of the early return on line 6, the condition `i < numbers.length` is never fully utilized to check every element.** *(line 3)*
  - Hint: What if you removed the exit command from inside the `if` statement and let the loop run its full course? Would that help?

| Found the bug? | False alarm? | Clarity 1–5 | Notes |
|---|---|---|---|
|  |  |  |  |

### `se-skips-negatives`

**The bug:** Also requires the number to be positive, so negative even numbers are left out.

**Tests that failed:** Handles negative numbers

**Summary the learner sees:** Your code correctly sums even numbers but currently ignores negative ones because of an extra condition.

**Issues raised:**

- **You are checking if the number is greater than zero, which stops negative even numbers from being added.** *(line 4)*
  - Hint: What happens to -2 in your current logic? How would you change that condition so that -2 and 2 are both treated as valid even numbers?
- **The test expects negative even numbers to be included in the sum.** *(line 4)*
  - Hint: Think about what makes a number 'even' versus what makes it 'positive'. Do you need both conditions, or just one?
- **Your current logic excludes any negative number, causing the total to stay at 0 for inputs like [-2, -4].** *(line 4)*
  - Hint: Try removing that part of the check and see if your code still correctly identifies even numbers.

| Found the bug? | False alarm? | Clarity 1–5 | Notes |
|---|---|---|---|
|  |  |  |  |

### `se-mutates-input`

**The bug:** Reverses the caller's array in place. Every visible case passes; only the hidden case that checks the input is unchanged fails.

**Tests that failed:** Leaves the input alone

**Summary the learner sees:** Your logic for finding even numbers and summing them is perfect! The only issue is that you are changing the original array by reversing it, which breaks the rule of not modifying the input.

**Issues raised:**

- **You are reversing the input array with `numbers.reverse()`. This changes the original data, which is generally not allowed in these exercises unless told otherwise.** *(line 2)*
  - Hint: Think about how you can check if a number is even without touching the array itself. Do you need to change the order of the numbers at all?
- **Your function signature looks correct, but since you are modifying the input array on line 2, this might cause issues if the same array is used elsewhere in your code.** *(line 1)*
  - Hint: What if we create a copy of the numbers first? Or better yet, can we just iterate through the numbers as they are?
- **Your loop structure and condition for checking even numbers are correct, but the reversal on line 2 is causing the test failure.** *(line 4)*
  - Hint: Try removing line 2 and see if your logic still works. Does the order of numbers matter when you just add them up?

| Found the bug? | False alarm? | Clarity 1–5 | Notes |
|---|---|---|---|
|  |  |  |  |

### `se-hardcoded`

**The bug:** Returns the answers to the visible cases from a lookup instead of adding anything up. Passes everything shown and fails the hidden longer list.

**Tests that failed:** Works on a longer list

**Summary the learner sees:** Your code works for the specific examples given, but it fails when given a new list of numbers because it only checks for exact matches.

**Issues raised:**

- **You are checking if the input is exactly one of those few lists. If someone passes a different list, your code returns 0 instead of calculating the sum.** *(line 2)*
  - Hint: Instead of comparing the whole list to specific examples, try looping through each number in the array and adding it to a total only if it meets a certain condition.
- **You are using `key` to store the joined string of numbers. This is unnecessary for your goal and makes your code hard to reuse.** *(line 3)*
  - Hint: Can you remove that line and instead use a loop to visit each number directly?
- **You are returning 0 as the default result. This is correct for an empty array, but it hides the fact that your logic didn't actually run for other inputs.** *(line 7)*
  - Hint: What if you start with a variable set to 0 and keep adding numbers inside a loop? Then you wouldn't need a special return statement at the end.

| Found the bug? | False alarm? | Clarity 1–5 | Notes |
|---|---|---|---|
|  |  |  |  |

### `cw-strictly-greater`

**The bug:** Uses > where the instructions say at least, so a word exactly at the limit is not counted.

**Tests that failed:** Counts a word exactly at the limit, Counts every word when the limit is 1

**Summary the learner sees:** Your code counts words correctly for most cases, but it misses words that are exactly as long as the limit because you used a greater-than check instead of greater-than-or-equal-to.

**Issues raised:**

- **The comparison condition excludes words that match the length exactly.** *(line 5)*
  - Hint: Change the operator so that words equal to `minLength` are also counted. Think about which symbol allows both 'greater than' and 'equal to'.
- **This single change fixes the failing tests for exact matches and the case where every word should be counted.** *(line 5)*
  - Hint: Try updating line 5 so that if a word's length is at least `minLength`, it increments the count.
- **The split behavior with single spaces is correct for your input format, but be aware that extra spaces could create empty strings.** *(line 3)*
  - Hint: If you ever need to handle multiple spaces between words, consider filtering out empty results after splitting.

| Found the bug? | False alarm? | Clarity 1–5 | Notes |
|---|---|---|---|
|  |  |  |  |

### `cw-splits-characters`

**The bug:** Splits on "" instead of " ", so it walks single characters rather than words.

**Tests that failed:** Counts words longer than the limit, Counts a word exactly at the limit, Counts every word when the limit is 1, Works on a longer sentence

**Summary the learner sees:** Your code splits the sentence into individual characters instead of whole words, which causes it to count every letter as a word.

**Issues raised:**

- **You are splitting the sentence into single characters using an empty string, but the instructions say words are separated by spaces. You need to split the sentence into actual words instead of individual letters.** *(line 3)*
  - Hint: Think about what happens if you tell `split` to look for a space character instead of nothing. How would that change the items in your loop?
- **Because you are splitting into characters, your loop runs many more times than there are words, causing the count to be much higher than expected in some cases and zero in others depending on how the split interacts with the length check.** *(line 3)*
  - Hint: If you have a sentence like 'hello world', what is different about the list you get when you split by space versus when you split into characters? How does that affect the value of `word.length`?
- **The logic inside the loop is correct for checking word length, but it will never work as intended because the input data (the words) is not being created correctly.** *(line 3)*
  - Hint: If you split a sentence by spaces, what type of data do you get? How would you iterate over that new list instead of the original string?

| Found the bug? | False alarm? | Clarity 1–5 | Notes |
|---|---|---|---|
|  |  |  |  |

### `cw-adds-lengths`

**The bug:** Adds each long word's length to the count instead of adding one, so it returns a number of letters.

**Tests that failed:** Counts words longer than the limit, Counts a word exactly at the limit, Counts every word when the limit is 1, Works on a longer sentence

**Summary the learner sees:** Your code counts characters instead of words, which is why your numbers are much higher than expected.

**Issues raised:**

- **You are adding the length of the word to the count. This adds up all the letters in every long word, rather than counting how many words exist.** *(line 5)*
  - Hint: Change line 5 so that you add 1 to the count instead of the word's length.
- **The comparison logic looks correct for finding words at least as long as the limit.** *(line 4)*
  - Hint: Check if there is a missing space after the `if` keyword on line 4. Without it, JavaScript might be reading the next line as part of the condition.
- **Your function signature matches the instructions.** *(line 1)*
  - Hint: Ensure you are using the correct variable names `sentence` and `minLength` when calling your function in other files.

| Found the bug? | False alarm? | Clarity 1–5 | Notes |
|---|---|---|---|
|  |  |  |  |

### `cw-ignores-minlength`

**The bug:** Counts every word and never looks at minLength.

**Tests that failed:** Counts words longer than the limit, Counts a word exactly at the limit, Works on a longer sentence

**Summary the learner sees:** Your code counts all words in the sentence but ignores the `minLength` limit entirely.

**Issues raised:**

- **You are returning the total count of every word without checking if they meet the length requirement.** *(line 5)*
  - Hint: Think about how to filter the words first. Would splitting the sentence into an array and then checking each word's length help? Or maybe using a loop to go through the words one by one?
- **Your check for an empty sentence is correct, but it doesn't account for sentences with only spaces.** *(line 2)*
  - Hint: What happens if you split a string that has multiple spaces? Does the resulting array still represent the words correctly?
- **The logic to count words longer than `minLength` is missing.** *(line 5)*
  - Hint: Try imagining a scenario where you have an array of word lengths. How would you count how many numbers in that array are greater than or equal to the limit?

| Found the bug? | False alarm? | Clarity 1–5 | Notes |
|---|---|---|---|
|  |  |  |  |

### `cw-off-by-one-length`

**The bug:** Compares word.length - 1 against the limit, so every word needs to be one character longer than it should.

**Tests that failed:** Counts a word exactly at the limit, Counts every word when the limit is 1

**Summary the learner sees:** Your code counts words correctly in most cases, but it is missing exactly one character when checking if a word is long enough.

**Issues raised:**

- **You are subtracting 1 from the word length before comparing it to the limit. This makes your check too strict, so words that match the limit exactly are counted as too short.** *(line 4)*
  - Hint: Think about what happens if a word has the same number of letters as the limit. Should that word be included in the count? If yes, remove the subtraction from your comparison.
- **Because you subtracted 1, words with exactly `minLength` characters are now considered shorter than they should be.** *(line 4)*
  - Hint: Try removing that `- 1` and see if the word length matches the limit directly.
- **The same subtraction is causing your code to fail when the limit is 1, as it incorrectly excludes words of length 1.** *(line 4)*
  - Hint: Ask yourself: does a word with 1 letter count if the limit is 1? If so, how do you compare them without losing that letter?

| Found the bug? | False alarm? | Clarity 1–5 | Notes |
|---|---|---|---|
|  |  |  |  |

### `cw-hardcoded`

**The bug:** Returns the visible cases' answers from a lookup. Passes everything shown and fails the hidden longer sentence.

**Tests that failed:** Works on a longer sentence

**Summary the learner sees:** Your code only works for specific examples you wrote down, but fails when given a new sentence because it doesn't actually count words.

**Issues raised:**

- **You are checking if the sentence matches exactly what you wrote in your example. This means the function will never work for any other input, like the longer sentence that failed.** *(line 2)*
  - Hint: Instead of asking 'Is this exact sentence?', try splitting the text into pieces based on spaces and then check each piece's length.
- **You are returning 0 for every case that isn't one of your specific examples. This stops the function from doing any real work,** *(line 5)*
  - Hint: Think about how to loop through all the words in a sentence and count them if they meet the length requirement.
- **Your function signature looks correct, but the logic inside is hardcoded. The tests expect your code to handle any sentence,** *(line 1)*
  - Hint: Try using a loop or a method that can go through every word in the string and check its length against `minLength`.

| Found the bug? | False alarm? | Clarity 1–5 | Notes |
|---|---|---|---|
|  |  |  |  |

### `gr-no-default`

**The bug:** The greeting parameter has no default, so calling greet("Ada") puts the word undefined in the result.

**Tests that failed:** Falls back to Hello when no greeting is given, Calls an empty name friend, Keeps the given greeting for an empty name

**Summary the learner sees:** Your code works when you provide both arguments, but it doesn't handle missing or empty values correctly.

**Issues raised:**

- **When `greeting` is not provided, your function tries to use the value `undefined`, which results in strange output like 'undefined, Ada!'. You need to check if `greeting` was actually given before using it.** *(line 2)*
  - Hint: Ask yourself: how do you know if someone gave you a greeting or not? What happens when you try to add text to nothing?
- **Similarly, when `name` is an empty string, your code still tries to print it as part of the message. You need to check if `name` is empty and change the output accordingly.** *(line 2)*
  - Hint: Think about how you would detect an empty name. What special message should appear in that case?
- **Your current logic always uses the arguments exactly as they are passed in. You need to add conditions so that missing or empty values trigger specific fallback messages.** *(line 2)*
  - Hint: Try adding `if` statements at the beginning of your function to handle these special cases before you build the final string.

| Found the bug? | False alarm? | Clarity 1–5 | Notes |
|---|---|---|---|
|  |  |  |  |

### `gr-no-empty-name`

**The bug:** Has the default greeting but never checks for an empty name, so greet("") returns "Hello, !".

**Tests that failed:** Calls an empty name friend, Keeps the given greeting for an empty name

**Summary the learner sees:** Your code handles the greeting and default values correctly, but it doesn't check if `name` is empty before adding it to the message.

**Issues raised:**

- **You are always adding the `name` variable to your string. If someone calls the function without a name, that part becomes empty, leaving a space and exclamation mark at the end.** *(line 2)*
  - Hint: Before you put the name into your message, check if it exists or is empty. If it is empty, replace it with the word 'friend'.
- **The logic for handling an empty `name` is missing entirely.** *(line 2)*
  - Hint: Think about using an `if` statement to see if `name` is empty. If it is, you should return a specific message like 'Hello, friend!' instead of the normal greeting.
- **The string concatenation doesn't account for missing names.** *(line 2)*
  - Hint: You might need to create a variable that holds the name, but changes it to 'friend' if the original name was empty. Then use that new variable in your return statement.

| Found the bug? | False alarm? | Clarity 1–5 | Notes |
|---|---|---|---|
|  |  |  |  |

### `gr-drops-greeting-for-friend`

**The bug:** Returns a fixed "Hello, friend!" for an empty name, throwing away the greeting that was passed in.

**Tests that failed:** Keeps the given greeting for an empty name

**Summary the learner sees:** Your code handles most cases correctly, but there is one small logic issue with how you check for an empty name.

**Issues raised:**

- **The comparison checks if the name equals an empty string, but in JavaScript, passing no argument results in undefined, not an empty string. This causes the condition to fail when the user doesn't provide a name.** *(line 2)*
  - Hint: Try changing the check to see if the name is undefined instead of comparing it to an empty string. How would you write that comparison?
- **When the name is missing, your code returns Hello, friend! regardless of which greeting was provided. The test expects the specific greeting argument to be used even when the name is empty.** *(line 5)*
  - Hint: Look at the return statement on line 5. Does it always use the default Hello or does it use the variable greeting? How can you modify it so the actual greeting argument is included in the message?
- **The function signature looks correct for accepting two arguments with a default value, but the logic inside needs adjustment to handle missing names properly.** *(line 1)*
  - Hint: Review how JavaScript handles missing arguments. When you call greet(Ada) without the second argument, what is the actual value of greeting in your function?

| Found the bug? | False alarm? | Clarity 1–5 | Notes |
|---|---|---|---|
|  |  |  |  |

### `gr-ignores-greeting`

**The bug:** Always says "Hello" and ignores the greeting argument entirely.

**Tests that failed:** Uses the greeting it was given, Keeps the given greeting for an empty name, Works for any name

**Summary the learner sees:** Your code correctly handles missing greetings and empty names in most cases, but it always uses the word 'Hello' instead of whatever greeting you pass in.

**Issues raised:**

- **The string you return always starts with 'Hello', even when a different greeting like 'Hi' or 'Welcome' is provided.** *(line 3)*
  - Hint: Try changing the first word in your return statement so it uses the `greeting` variable instead of hardcoding 'Hello'. What part of the sentence should change based on what the user passes?
- **When checking if the name is empty, you are only looking for an exact match to an empty string.** *(line 2)*
  - Hint: What happens if someone passes a space ' ' instead of nothing? How can your check handle any kind of missing or empty input?
- **You are using the '+' operator to join strings together.** *(line 3)*
  - Hint: Is there a cleaner way in JavaScript to put pieces of text together without writing plus signs? Think about what you've learned about string methods.

| Found the bug? | False alarm? | Clarity 1–5 | Notes |
|---|---|---|---|
|  |  |  |  |

## Roadmap AI

Does the recommended track suit the learner, and does the explanation engage
with what they actually said they wanted?

### `complete-beginner`

**Profile:** Has never programmed. Either track is defensible; the order must start from the basics and skip nothing.

**Recommended track:** Frontend · 12 modules · already passed 0

**Explanation:** Since you want a job as a Junior Web Developer and need to see your work immediately, the Frontend track is the best fit because it focuses on building the visible parts of products that employers can showcase in portfolios. You will complete all core modules plus the component and data fetching modules before making your technology decision at the end.

| Track appropriate? | Explanation engages the goal? | Notes |
|---|---|---|
|  |  |  |

### `beginner-few-hours`

**Profile:** Same as the complete beginner but with 3 hours a week. The plan should not change — only the estimate, which the platform computes.

**Recommended track:** Frontend · 12 modules · already passed 0

**Explanation:** Since you want a job as a Junior Web Developer and need to see your work immediately, the Frontend track is the best fit for your goal. You will complete all core modules plus the two additional ones in this track before making your technology decision.

| Track appropriate? | Explanation engages the goal? | Notes |
|---|---|---|
|  |  |  |

### `some-html-css`

**Profile:** Already passed HTML and CSS. Neither may appear again, and the frontend track is the natural recommendation.

**Recommended track:** Frontend · 12 modules · already passed 2

**Explanation:** Since you want a job as a Junior Web Developer and prefer seeing your work immediately, the Frontend track is the best fit for your goals. You will start with your already completed basics and move through JavaScript and Git before learning components and data fetching, after which you can choose your specific framework.

| Track appropriate? | Explanation engages the goal? | Notes |
|---|---|---|
|  |  |  |

### `comfortable-js`

**Profile:** Comfortable and four modules in. The roadmap should carry on from arrays and objects rather than restart.

**Recommended track:** Frontend · 12 modules · already passed 4

**Explanation:** Since you want to build small things on your own and see your work immediately, the Frontend track is the best fit for getting hired as a Junior Web Developer. At the technology decision point, you will choose a framework to apply these core skills to real projects.

| Track appropriate? | Explanation engages the goal? | Notes |
|---|---|---|
|  |  |  |

### `freelance-goal`

**Profile:** Wants freelance work, 20 hours a week. Check whether the explanation engages with the goal or ignores it.

**Recommended track:** Frontend · 12 modules · already passed 1

**Explanation:** Since you want freelance or client work and prefer seeing your results immediately, the Frontend track is the best fit for building a visible portfolio. You will start with the core modules you already know and then move through layout, logic, and data handling before making your framework choice at the end.

| Track appropriate? | Explanation engages the goal? | Notes |
|---|---|---|
|  |  |  |

### `backend-leaning`

**Profile:** The one profile written to test whether the model ever recommends the backend track, or defaults to frontend for everyone.

**Recommended track:** Frontend · 12 modules · already passed 3

**Explanation:** Since you want to build small things on your own and have a portfolio ready for a junior web developer role, the Frontend track is the best fit because it focuses on what people see and click. At the technology decision point in this track, you will choose a framework to apply these core skills to real projects.

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

**Summary:** Learner with foundational knowledge of web development concepts gained through structured assessments. Ready to apply technical fundamentals to build functional front-end interfaces.

**Skills printed:** *none*

**Removed as unsupported:** HTML, CSS, JavaScript — the model claimed these and the grounding deleted them.

**What to check:** Nothing is verified. The summary must not claim any skill or experience, and the skills list must come back empty after grounding.

| Any unsupported claim left? | Reads as experience? | Quality 1–5 | ATS parse | Notes |
|---|---|---|---|---|
|  |  |  |  |  |

### `one-skill`

**Target job:** Junior Front-End Developer

**Verified evidence:** HTML

**Summary:** Junior developer with proven proficiency in HTML structure and markup through completed assessments. Ready to apply foundational web standards to build responsive front-end interfaces.

**Skills printed:** HTML

**Removed as unsupported:** none — every skill the model named was verified.

**What to check:** One skill. A short, honest summary; no invented breadth.

| Any unsupported claim left? | Reads as experience? | Quality 1–5 | ATS parse | Notes |
|---|---|---|---|---|
|  |  |  |  |  |

### `skills-only`

**Target job:** Junior Front-End Developer

**Verified evidence:** HTML, CSS, JavaScript

**Summary:** Front-end developer with proven expertise in HTML, CSS, and JavaScript through completed module assessments. Ready to apply foundational web development skills to build responsive and interactive user interfaces.

**Skills printed:** JavaScript, CSS, HTML

**Removed as unsupported:** none — every skill the model named was verified.

**What to check:** §9.1's 'skills only' level. Watch for React, Node, Git or 'responsive design' appearing unsupported.

| Any unsupported claim left? | Reads as experience? | Quality 1–5 | ATS parse | Notes |
|---|---|---|---|---|
|  |  |  |  |  |

### `tested-out`

**Target job:** Junior Web Developer

**Verified evidence:** HTML, CSS

**Summary:** Foundational web development skills demonstrated through passing assessments in HTML and CSS.

**Skills printed:** HTML, CSS

**Removed as unsupported:** none — every skill the model named was verified.

**What to check:** Both skills were tested out rather than worked through. The resume must not describe study time or coursework that did not happen.

| Any unsupported claim left? | Reads as experience? | Quality 1–5 | ATS parse | Notes |
|---|---|---|---|---|
|  |  |  |  |  |

### `with-certificate`

**Target job:** Junior Web Developer

**Verified evidence:** HTML, CSS, JavaScript, Git

**Summary:** Front-end developer with proven proficiency in HTML, CSS, JavaScript, and Git through completed course modules. Holds a Junior Web Developer — Front-End certification.

**Skills printed:** JavaScript, HTML, CSS, Git

**Removed as unsupported:** none — every skill the model named was verified.

**What to check:** §9.1's 'certificate' level. A certificate is still study, not employment — any sentence implying a job is a failure.

| Any unsupported claim left? | Reads as experience? | Quality 1–5 | ATS parse | Notes |
|---|---|---|---|---|
|  |  |  |  |  |

### `career-changer`

**Target job:** Junior Back-End Developer

**Verified evidence:** JavaScript, HTTP and servers

**Summary:** Junior developer with proven proficiency in JavaScript and server-side HTTP protocols through completed assessments. Ready to apply foundational backend knowledge to build scalable web services.

**Skills printed:** JavaScript, HTTP and servers

**Removed as unsupported:** none — every skill the model named was verified.

**What to check:** The target job is backend and the evidence is thin. The strongest pull towards inventing experience — check the summary sentence by sentence.

| Any unsupported claim left? | Reads as experience? | Quality 1–5 | ATS parse | Notes |
|---|---|---|---|---|
|  |  |  |  |  |
