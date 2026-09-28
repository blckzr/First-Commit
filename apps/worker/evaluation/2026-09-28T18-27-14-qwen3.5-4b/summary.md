# Evaluation — qwen3.5:4b

Run 2026-09-28T18:30:49.067Z · JSON mode `think_off_schema` · one job at a time on one 8GB card.

Counted metrics only. Everything §9.1 marks evaluator-rated is in
`scoring-sheet.md`, filled in by hand.

## Where the model ran

```
NAME          ID              SIZE      PROCESSOR    CONTEXT    UNTIL               
qwen3.5:4b    2a654d98e6fb    2.9 GB    100% GPU     8192       29 minutes from now
```

`model-setup-guide.md` §13 chooses between 4B and 9B partly on whether the
larger one stays on the GPU. `100% GPU` above means it did.

## Code Review AI

21 submissions, 17 with a failing test and therefore sent to the model.

| Metric | Result |
|---|---|
| Valid output rate (first attempt) | 100% (17/17) |
| Needed a retry | 0% (0/17) |
| Solution leakage, caught and retried | 0% (0/17) |
| Solution leakage reaching the learner | 0% (0/17) — the guard rejects, so this is 0 by construction |
| Response time, mean | 7.0s |
| Failed outright | 0% (0/21) |

**Bug detection rate, false alarm rate and explanation clarity are in
`scoring-sheet.md`** — §9.1 rates them by evaluator, and matching the model's
wording against an expected phrase would measure vocabulary, not understanding.

## Roadmap AI

6 learner profiles.

| Metric | Result |
|---|---|
| Valid output rate (first attempt) | 67% (4/6) |
| Roadmaps produced | 67% (4/6) |
| Prerequisite violations, rejected and regenerated | 0 |
| Missing core coverage, rejected and regenerated | 0 |
| Unknown module ids, rejected and regenerated | 6 |
| Wrong-track content, rejected and regenerated | 0 |
| Unclassified rejections | 0 |
| Response time, mean | 8.3s |

**Every count above is an attempt the validator caught, not a roadmap a
learner received** — an invalid plan is never written. Zero across the row
means the model needed no correction, not that the checks are absent.

Track recommendations: Frontend ×4.
Whether each one suits its learner is an evaluator judgment (§9.1) and is in
`scoring-sheet.md`.

### Did not complete

- `beginner-few-hours` — Model output was invalid after 3 attempts: Module id "c056c754-a1ef-44d6-994a-170dc83b1696" does not exist. Use only the ids listed in the catalogue.
- `some-html-css` — Model output was invalid after 3 attempts: Module id "c056c754-a1ef-44d6-994a-170dc83b1696" does not exist. Use only the ids listed in the catalogue.

## Resume AI

6 evidence profiles. §9.1's third level — a completed capstone project —
is **not measured**: Phase 4 is not built, so no learner can have one.

| Metric | Result |
|---|---|
| Valid output rate (first attempt) | 100% (6/6) |
| Resumes produced | 100% (6/6) |
| Fabrication: runs where a skill was claimed without evidence | 0% (0/6) |
| Unsupported skills removed, total | 0 |
| Experience misrepresentation: runs rejected and retried | 0% (0/6) |
| Unsupported skill in the printed **skills list** | 0% (0/6) — filtered, so 0 by construction |
| Response time, mean | 0.9s |

**The fabrication row measures the model; the row below it measures the
platform.** A fabrication figure of 0% would mean the prompt never tempted the
model into a claim, not that the grounding is unnecessary — and a figure above
0% is the evidence that removing skills is doing real work.

> **The summary sentence is not filtered.** `groundSkills` cleans the skills
> array; `noInventedExperience` rejects claims of employment and of having built
> something. Neither reads the summary for a claim of *knowledge*, so a resume
> can print no skills and still open with a sentence asserting them. Check the
> summary of every low-evidence profile in the sheet by hand until that gap is
> closed — §9.1 counts it as fabrication even though nothing here does.

ATS parse check and writing quality are evaluator tasks (§9.1) and are in
`scoring-sheet.md`. The parse check needs the PDF, which `GET /resume.pdf`
renders from this same content.

## Not measured

- **Code Review AI: capstone milestones** — `milestone_review` is a stub.
- **React and Vue submissions** — neither sandbox runs a component test, so there are no results to explain.
- **Roadmap adaptation** — reinforcement and challenge modules are not built.
- **Resume at the completed-project level** — Phase 4 is not built, so no learner can have one.