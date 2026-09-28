# Evaluation — qwen3.5:4b

Run 2026-09-28T18:22:11.967Z · JSON mode `think_off_schema` · one job at a time on one 8GB card.

Counted metrics only. Everything §9.1 marks evaluator-rated is in
`scoring-sheet.md`, filled in by hand.

## Where the model ran

```
NAME          ID              SIZE      PROCESSOR    CONTEXT    UNTIL               
qwen3.5:4b    2a654d98e6fb    2.9 GB    100% GPU     8192       29 minutes from now
```

`model-setup-guide.md` §13 chooses between 4B and 9B partly on whether the
larger one stays on the GPU. `100% GPU` above means it did.

## Roadmap AI

6 learner profiles.

| Metric | Result |
|---|---|
| Valid output rate (first attempt) | 67% (2/3) |
| Roadmaps produced | 50% (3/6) |
| Prerequisite violations, rejected and regenerated | 0 |
| Missing core coverage, rejected and regenerated | 0 |
| Unknown module ids, rejected and regenerated | 1 |
| Wrong-track content, rejected and regenerated | 0 |
| Unclassified rejections | 0 |
| Response time, mean | 53.3s |

**Every count above is an attempt the validator caught, not a roadmap a
learner received** — an invalid plan is never written. Zero across the row
means the model needed no correction, not that the checks are absent.

Track recommendations: Frontend ×3.
Whether each one suits its learner is an evaluator judgment (§9.1) and is in
`scoring-sheet.md`.

### Did not complete

- `complete-beginner` — Model output was invalid after 3 attempts: Module id "48b67ec1-9336-4067-933b-16ac7f50-a97e-4544-ab19-fbed91c4c966" does not exist. Use only the ids listed in the catalogue.
- `some-html-css` — Model output was invalid after 3 attempts: Module id "48b67ec1-9336-4067-933b-16ac7f50-a97e-4544-ab19-fbed91c4c966" does not exist. Use only the ids listed in the catalogue.
- `comfortable-js` — Ollama did not respond within 120000 ms

## Not measured

- **Code Review AI: capstone milestones** — `milestone_review` is a stub.
- **React and Vue submissions** — neither sandbox runs a component test, so there are no results to explain.
- **Roadmap adaptation** — reinforcement and challenge modules are not built.
- **Resume at the completed-project level** — Phase 4 is not built, so no learner can have one.