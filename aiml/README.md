# AIML

The intelligence layer of MIRAIWERK AI.

This package owns everything between a request for intelligence and a validated, contract-shaped proposal:

- **Model orchestration** — Meta Model API adapter with JSON-schema responses, bounded retries, timeouts, and a read-only tool loop.
- **Prompts and response schemas** — plan generation and ticket analysis contracts.
- **Deterministic rules** — labelled demo planner and ticket analyser used when no key is configured or as a degraded fallback.
- **Policy** — evidence-aware priority floors, escalation components, and response windows applied after classification.
- **Benchmark** — a 40-case labelled ticket suite, runner, and generated reports.

It deliberately has **no database or HTTP dependency**. The backend calls it, and the harness calls it directly.

```text
src/
├── providers/meta.ts     Meta adapter, prompts, tool loop
├── rules/templates.ts    Deterministic plan drafts
├── rules/analyzer.ts     Deterministic ticket analysis
├── policy.ts             Post-classification policy
├── schemaJson.ts         JSON schemas sent to the model
├── tools.ts              Read-only project tools
├── lib/text.ts           Lexical overlap and excerpt helpers
└── index.ts              Public surface
scripts/evaluate.ts       Benchmark runner
evaluations/              Dataset, report, interpretation
```

## Commands

```bash
npm run build       -w @miraiwerk/aiml
npm run typecheck   -w @miraiwerk/aiml
npm run evaluate    -w @miraiwerk/aiml
npm run evaluate    -w @miraiwerk/aiml -- --provider=meta
```

The deterministic path needs no key and no database. Meta mode requires `MODEL_API_KEY` (or `META_API_KEY`) in the environment or a loaded `.env`.

## Boundary rule

The package may propose. It may not persist, approve, or mutate a plan. Those actions belong to the backend and require a human decision.
