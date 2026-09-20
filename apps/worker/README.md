# First Commit AI Worker

Connects First Commit's `ai_jobs` queue in PostgreSQL to a local Ollama model (Qwen3.5).
See [`docs/model-setup-guide.md`](../../docs/model-setup-guide.md) for the full setup walkthrough.

```bash
npm install
cp .env.example .env        # Windows PowerShell: Copy-Item .env.example .env
npm run check               # Verify Ollama and pick the JSON mode
npm run try:feedback        # Try the Code Review AI on a sample exercise
npm run worker              # Process jobs from the database
```

| File | Purpose |
|---|---|
| `src/config.ts` | Reads settings from `.env` |
| `src/ollama.ts` | Calls Ollama, validates JSON with Zod, retries invalid output |
| `src/schemas.ts` | Output shapes for code feedback, roadmaps, and resumes |
| `src/prompts/code-feedback.ts` | Builds the Code Review AI prompt |
| `src/check-setup.ts` | Setup check and JSON mode comparison |
| `src/examples/code-feedback.ts` | Sample run on the "Sum of even numbers" exercise |
| `src/worker.ts` | Claims jobs with `claim_next_ai_job()`, writes results, notifies the API |
