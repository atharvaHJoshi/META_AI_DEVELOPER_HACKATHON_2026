# Ticket-intelligence evaluation

This directory contains MIRAIWERK's ticket-analysis benchmark: a fixed set of hand-labelled cases, a runner that executes them through the real analyser and policy layer, and generated reports.

```text
aiml/evaluations/
├── tickets.json    40 labelled cases + the shared plan/context
├── report.md       Human-readable metrics, confusion matrix, case table
└── report.json     Machine-readable results for every case
```

The benchmark exists to make one question answerable: **does the analyser produce the behaviour the product contract describes?** It is not a marketing score and it is not evidence that a Meta model is good.

## Run it

From the repository root:

```bash
npm run evaluate
```

This uses the deterministic rules and needs no database or model key. It rewrites `report.md` and `report.json`.

To measure the configured Meta model instead:

```bash
MODEL_API_KEY=... npm run evaluate -w @miraiwerk/aiml -- --provider=meta
```

`--provider=meta` requires `MODEL_API_KEY` (or `META_API_KEY`). Without it the runner exits before calling any model. The report records the provider and model name, so the two paths cannot be confused.

Model calls in the evaluation harness bypass the backend's `sanitizeAnalysis` step; they use the raw provider output plus the deterministic policy layer. The API path is stricter. This is intentional: the benchmark should show what the model actually returned, not a cleaned-up version.

## What is measured

Each case supplies a title, description, optional component/impact/evidence/environment, and a reported severity. The runner builds the same kind of `AnalysisContext` the API uses: the shared commerce plan, its tasks/milestones/dependencies, and five context tickets.

The runner records:

| Signal | Source |
| --- | --- |
| Ticket type | `policy.classification.ticketType` after analysis |
| Priority | `policy.classification.priority` after policy rules |
| Recommendation | `analysis.recommendedOption` |
| Duplicate probe | `analysis.duplicateCandidates.length > 0` |
| Evidence discipline | Unknown count and clarifying-question presence |
| Proposal completeness | Accept tasks exist, estimates positive, split availability matches expectation |

### Weights

| Metric | Weight |
| --- | ---: |
| Ticket-type accuracy | 20% |
| Policy-priority accuracy | 20% |
| Recommendation accuracy | 30% |
| Evidence discipline | 15% |
| Proposal completeness | 15% |

Duplicate detection is reported separately. It is a binary probe across all 40 cases, most of which are negatives, so folding it into the headline score would let a high negative rate hide a false positive.

### Definitions

- **Ticket-type accuracy** — predicted type equals the label.
- **Policy-priority accuracy** — final priority after policy equals the label.
- **Recommendation accuracy** — `accept`, `split`, `defer`, `duplicate`, or `clarify` equals the label.
- **Evidence discipline** — at least `minUnknowns` unknowns; `clarify` cases have at least one clarifying question; actionable cases have none.
- **Proposal completeness** — the accept change contains at least one task with a positive estimate; the split change is present exactly when the labelled type is incident, feature request, or technical debt.
- **Case pass** — every check above passes and the duplicate probe is not a mismatch. A duplicate false positive or false negative marks the case `CHECK`.
- **Overall** — weighted sum of the five main metrics, as above.
- **Average latency** — wall-clock analysis time per case, including no network in deterministic mode.

### Duplicate precision / recall / F1

For the duplicate probe:

```text
precision = true positives / (true positives + false positives)
recall    = true positives / (true positives + false negatives)
F1        = 2 * precision * recall / (precision + recall)
accuracy  = (true positives + true negatives) / all labelled cases
```

A "positive" means the analyser emitted at least one duplicate candidate. Cases with a candidate but a distinct root cause are false positives even when the recommendation is still `accept`, because the candidate is advisory evidence, not an automatic action.

## Dataset format

`tickets.json` has:

```json
{
  "version": 1,
  "name": "MIRAIWERK ticket-intelligence benchmark",
  "description": "...",
  "plan": {
    "name": "...",
    "goal": "...",
    "description": "...",
    "startDate": "2026-11-02",
    "targetDate": "2026-12-18",
    "constraints": { "...": "..." },
    "policy": { "...": "..." }
  },
  "contextTickets": [
    {
      "title": "...",
      "description": "...",
      "ticketType": "incident",
      "status": "analyzed",
      "createdAt": "2026-10-01T09:10:00.000Z"
    }
  ],
  "cases": [
    {
      "id": "IN-01",
      "title": "...",
      "description": "...",
      "ticketType": "incident",
      "affectedComponent": "Payments / checkout retry",
      "reportedImpact": "...",
      "evidence": "...",
      "environment": "production",
      "severityReported": "critical",
      "expected": {
        "ticketType": "incident",
        "priority": "P0",
        "recommendation": "split",
        "duplicate": true,
        "minUnknowns": 2
      },
      "note": "Why this label matters."
    }
  ]
}
```

- `ticketType` on a case is the reporter's claim, not the expected label. The analyser infers the type. Leaving it `null` simulates a vague intake.
- `expected.duplicate` is optional. Omit it when duplicate behaviour is not part of the case's label.
- `expected.minUnknowns` describes the minimum honesty threshold, not a target count.
- `note` is shown in the generated mismatch section and should explain the product behaviour, not just restate the label.

The dataset is deliberately weighted toward ambiguous, safety-critical, and near-duplicate reports. It is not a sample of real ticket prevalence.

## Reading the report

`report.md` contains:

1. **Mode** — deterministic or Meta, model name, and an honesty note.
2. **Summary** — weighted score, component accuracies, duplicate metrics, pass count, latency.
3. **Duplicate confusion** — true/false positives and negatives.
4. **Ticket-type confusion** — expected type rows against predicted type columns.
5. **Case table** — expected vs actual labels, duplicate/evidence checks, PASS/CHECK.
6. **Checks that did not match** — expected, actual, and why the label matters.
7. **What the benchmark does not prove** — scope limits.

`report.json` mirrors the same data with:

```json
{
  "provider": "deterministic",
  "model": "miraiwerk-rules-v1",
  "generatedAt": "...",
  "totals": { "cases": 40, "passed": 36, "mismatched": 4, "averageLatencyMs": 1.4 },
  "metrics": {
    "ticketTypeAccuracy": 1,
    "priorityAccuracy": 0.975,
    "recommendationAccuracy": 1,
    "evidenceDiscipline": 1,
    "proposalCompleteness": 1,
    "duplicate": { "...": "..." },
    "overall": 0.995
  },
  "confusion": { "...": "..." },
  "cases": [ { "id": "IN-01", "expected": {}, "actual": {}, "matches": {}, "pass": true } ]
}
```

The generated report is the source of truth. The values above illustrate the shape; rerunning can change them when rules or labels change.

## Current deterministic baseline

At the time of writing, the deterministic runner scores:

| Metric | Result |
| --- | ---: |
| Overall weighted score | 99.5% |
| Ticket type | 100% |
| Policy priority | 97.5% |
| Recommendation | 100% |
| Evidence discipline | 100% |
| Proposal completeness | 100% |
| Duplicate accuracy | 92.5% (37/40 probes) |
| Cases passing every check | 36/40 |

The four `CHECK` cases are BUG-02 (missed near-duplicate), BUG-09 (priority P1 vs P2 with correct duplicate detection), BUG-10 (false duplicate candidate in the saved-payment area), and FEAT-02 (false duplicate candidate for an unscoped wishlist). They are kept visible rather than removed to make the score look better.

This score means the fallback rules are calibrated to the labels. It does **not** mean the deterministic rules are a substitute for a model, and it does **not** establish Meta model quality. Run `--provider=meta` for that comparison.

## Limitations

- **Synthetic labels.** The cases were written for this product. They encode intended behaviour, not a neutral third-party ground truth.
- **Lexical duplicates.** Candidate detection uses weighted word overlap, not embeddings. Paraphrases can be missed; same-feature-area tickets can be flagged. The UI requires a human to approve a duplicate outcome.
- **No plan-quality score.** This benchmark does not measure generated plan coherence. Plan generation is reviewed in the UI, and RippleMap scheduling is covered by unit tests.
- **No real-world prevalence.** The case mix is intentionally adversarial and does not predict production accuracy.
- **Raw model path.** Meta-mode results are not sanitized by the API before scoring, so invalid record references may appear in model output. That is a property of the harness, not the API.
- **Latency is illustrative.** Deterministic latency is local and very small; Meta latency depends on the provider, network, retries, and tool loop.
- **A correct label is not a commitment.** The benchmark checks analysis behaviour. It does not turn effort estimates into deadlines or capacity into a guarantee.

## Adding or changing cases

1. Add the case to `tickets.json` with a stable ID, a realistic ticket, and a `note` explaining the expected product behaviour.
2. Keep the plan and context tickets fixed unless the change is deliberate; otherwise you lose comparability.
3. Run `npm run evaluate`.
4. Inspect `report.md`, especially the confusion matrix and the mismatch notes.
5. If the rules changed, update the baseline table in this README and the summary in the root README.

Do not edit `report.md` or `report.json` by hand. They are generated artifacts.

## Verification commands

```bash
npm run evaluate     # regenerate reports
npm test             # RippleMap + backend integration tests
npm run typecheck    # contract and workspace type safety
```

The evaluation does not require PostgreSQL. The API integration suite does.
