# Evaluation — qwen3.5:4b

Run 2026-09-28T19:20:23.490Z · JSON mode `think_off_schema` · one job at a time on one 8GB card.

Counted metrics only. Everything §9.1 marks evaluator-rated is in
`scoring-sheet.md`, filled in by hand.

## Where the model ran

```
NAME          ID              SIZE      PROCESSOR    CONTEXT    UNTIL               
qwen3.5:4b    2a654d98e6fb    3.2 GB    100% GPU     8192       29 minutes from now
```

`model-setup-guide.md` §13 chooses between 4B and 9B partly on whether the
larger one stays on the GPU. `100% GPU` above means it did.

## Resume AI

6 evidence profiles. §9.1's third level — a completed capstone project —
is **not measured**: Phase 4 is not built, so no learner can have one.

| Metric | Result |
|---|---|
| Valid output rate (first attempt) | 83% (5/6) |
| Resumes produced | 100% (6/6) |
| Fabrication: runs where a skill was claimed without evidence | 0% (0/6) |
| Unsupported skills removed, total | 0 |
| Experience misrepresentation: runs rejected and retried | 17% (1/6) |
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