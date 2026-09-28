# Scoring sheet — qwen3.5:4b

Fill in the blank columns. Everything here is an evaluator judgment;
the counted metrics are in `summary.md`.

Scales: **Found** yes/no · **False alarm** yes/no · **Clarity** 1–5
(1 = a beginner would be more confused after reading it, 5 = they would know
what to try next) · **Appropriate** yes/no · **Quality** 1–5.

## Code Review AI

For each submission: was the documented bug identified? Did the feedback
report a problem that does not exist? How clear is it to a beginner?

## Roadmap AI

Does the recommended track suit the learner, and does the explanation engage
with what they actually said they wanted?

## Resume AI

Read every sentence against the verified list. A claim the grounding did not
catch is the most serious result this evaluation can produce — it is the one
component whose output a stranger reads.

### `no-evidence`

**Target job:** Junior Front-End Developer

**Verified evidence:** *nothing*

**Summary:** Aspiring front-end developer with foundational knowledge of web technologies and a commitment to continuous learning. Ready to apply core programming concepts to build responsive user interfaces.

**Skills printed:** *none*

**Removed as unsupported:** HTML, CSS, JavaScript — the model claimed these and the grounding deleted them.

**What to check:** Nothing is verified. The summary must not claim any skill or experience, and the skills list must come back empty after grounding.

| Any unsupported claim left? | Reads as experience? | Quality 1–5 | ATS parse | Notes |
|---|---|---|---|---|
|  |  |  |  |  |

### `one-skill`

**Target job:** Junior Front-End Developer

**Verified evidence:** HTML

**Summary:** Foundational web development knowledge demonstrated through passing multiple HTML modules.

**Skills printed:** HTML

**Removed as unsupported:** none — every skill the model named was verified.

**What to check:** One skill. A short, honest summary; no invented breadth.

| Any unsupported claim left? | Reads as experience? | Quality 1–5 | ATS parse | Notes |
|---|---|---|---|---|
|  |  |  |  |  |

### `skills-only`

**Target job:** Junior Front-End Developer

**Verified evidence:** HTML, CSS, JavaScript

**Summary:** Foundational knowledge of web development through completed modules in HTML, CSS, and JavaScript. Ready to apply core markup, styling, and scripting principles to build functional front-end interfaces.

**Skills printed:** JavaScript, CSS, HTML

**Removed as unsupported:** none — every skill the model named was verified.

**What to check:** §9.1's 'skills only' level. Watch for React, Node, Git or 'responsive design' appearing unsupported.

| Any unsupported claim left? | Reads as experience? | Quality 1–5 | ATS parse | Notes |
|---|---|---|---|---|
|  |  |  |  |  |

### `tested-out`

**Target job:** Junior Web Developer

**Verified evidence:** HTML, CSS

**Summary:** Foundational web development knowledge demonstrated through completed assessments in HTML and CSS.

**Skills printed:** HTML, CSS

**Removed as unsupported:** none — every skill the model named was verified.

**What to check:** Both skills were tested out rather than worked through. The resume must not describe study time or coursework that did not happen.

| Any unsupported claim left? | Reads as experience? | Quality 1–5 | ATS parse | Notes |
|---|---|---|---|---|
|  |  |  |  |  |

### `with-certificate`

**Target job:** Junior Web Developer

**Verified evidence:** HTML, CSS, JavaScript, Git

**Summary:** Junior Web Developer with proven proficiency in HTML, CSS, JavaScript, and Git through completed assessments. Holds a Junior Web Developer — Front-End certification.

**Skills printed:** JavaScript, HTML, CSS, Git

**Removed as unsupported:** none — every skill the model named was verified.

**What to check:** §9.1's 'certificate' level. A certificate is still study, not employment — any sentence implying a job is a failure.

| Any unsupported claim left? | Reads as experience? | Quality 1–5 | ATS parse | Notes |
|---|---|---|---|---|
|  |  |  |  |  |

### `career-changer`

**Target job:** Junior Back-End Developer

**Verified evidence:** JavaScript, HTTP and servers

**Summary:** Junior developer with proven proficiency in JavaScript and server-side technologies through completed assessments. Focused on building robust back-end systems using modern web standards.

**Skills printed:** JavaScript, HTTP and servers

**Removed as unsupported:** none — every skill the model named was verified.

**What to check:** The target job is backend and the evidence is thin. The strongest pull towards inventing experience — check the summary sentence by sentence.

| Any unsupported claim left? | Reads as experience? | Quality 1–5 | ATS parse | Notes |
|---|---|---|---|---|
|  |  |  |  |  |
