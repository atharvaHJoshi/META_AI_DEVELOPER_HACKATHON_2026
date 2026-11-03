# Evidence and decision contract

MIRAIWERK AI's central claim is narrow: **a model may propose, but it may not silently change the plan.** This document defines what the product treats as evidence, how it labels uncertainty, and which checks must pass before a plan version is created.

## 1. Three evidence states

Every claim in a proposal carries one of three states.

| State | Meaning | Example |
| --- | --- | --- |
| `observed` | Directly present in the ticket, a stored project record, or an explicit policy. | "Transactions `pi_8841` and `pi_8842` share idempotency key `idem_5521`." |
| `inferred` | A grounded but unconfirmed relationship or conclusion. | "This ticket probably relates to the payment-retry task because both name the confirmation timeout." |
| `unknown` | Not established by the supplied material. | "The number of exposed customers after 10:00 UTC is not known." |

The rule is one-directional: an inferred claim can become observed only when a human confirms it or new evidence is supplied. A model cannot promote its own inference.

Missing information never becomes a favourable fact. If impact is absent, the proposal says it is unknown; it does not say "low impact". If a date is absent, the date stays `null`; it does not become a convenient estimate.

### Evidence items

Each item in `proposal.evidence[]` has:

```json
{
  "claim": "The retry does not reuse the original idempotency key.",
  "state": "observed",
  "sourceType": "ticket",
  "sourceId": "tkt_...",
  "excerpt": "Application logs show the confirmation retry does not reuse the original idempotency key."
}
```

`sourceType` is `ticket`, `project`, `policy`, or `model`.

- `ticket` — the intake record itself.
- `project` — a requirement, task, or milestone in the current plan.
- `policy` — a configured response or escalation rule.
- `model` — a synthesis step. These are expected to be marked `inferred`, not `observed`.

The API sanitizes project references. A model that cites a task, requirement, milestone, or ticket outside the current project has that reference discarded and a warning recorded. Evidence keeps the claim but loses the invalid `sourceId`.

### Related records

Links to requirements, tasks, milestones, and other tickets are advisory. Each has `evidenceState` and a rationale. `confirmed` is stored on `ticket_links` and starts `false`; links are not treated as scope commitments.

### Duplicate candidates

Duplicate detection is lexical, not semantic proof. It compares weighted title/body overlap against recent tickets in the same project. A candidate is always a candidate:

- It never auto-closes a ticket.
- It never suppresses the analysis.
- Approving `duplicate` requires that a candidate was actually recorded.
- The evidence ledger can show a candidate while the recommendation is still `accept` or `split`, because similar wording is not the same root cause.

The demo includes exactly this case: a duplicate-charge report that is really an invoice-export duplication. The incident is a candidate, but the evidence says the payment processor has one capture.

### Unknowns and clarifying questions

`unknowns[]` lists facts the system did not establish. `clarifyingQuestions[]` lists what a human should ask when the intake cannot support a decision.

The two are related but not interchangeable:

- Unknowns can exist on a completely actionable incident (for example, "which customers are still exposed?").
- Clarifying questions are expected when the recommendation is `clarify` and the report has no reproducible behaviour.

The evaluation benchmark checks that `clarify` cases produce at least two unknowns and at least one question, while actionable cases do not emit questions.

## 2. Classification and policy

The provider produces a classification:

```json
{
  "ticketType": "incident",
  "priority": "P0",
  "urgency": "critical",
  "summary": "...",
  "businessImpact": "...",
  "customerImpact": "..."
}
```

A deterministic policy layer then adjusts priority. The model's original value is preserved as `policy.modelPriority`; the effective value is `classification.priority` / `policy.finalPriority`.

Configured project policy fields:

| Field | Default | Effect |
| --- | ---: | --- |
| `criticalResponseHours` | 24 | P0 response label |
| `highResponseDays` | 3 | P1 response label |
| `normalResponseDays` | 10 | P2/P3 response labels |
| `requireEvidenceForP0` | true | P0 requires impact, environment, and ≥20 chars of evidence |
| `escalationComponents` | `[]` | Matching component/title/description text sets a P1 floor |
| `releaseFreezeDays` | 3 | Used by RippleMap policy findings near a release gate |

Rules are applied in this order:

1. Escalation component → priority floor P1.
2. Production incident → priority floor P1.
3. Reporter marked `critical` and type is not `feature_request` → priority floor P1.
4. P0 without sufficient impact/environment/evidence → downgrade one level.
5. Non-defect types (`feature_request`, `technical_debt`, `clarification`) cannot hold P0 → downgrade one level.

Every applied rule is returned in `policy.rulesApplied` and shown in the UI. If no rule matches, the response says so rather than pretending a policy decision occurred.

`policy.escalated` is true only when the final priority is higher than the provider's priority. A downgrade is visible through the difference between `modelPriority` and `finalPriority` and through the rules list.

## 3. Model labelling

The API never presents deterministic output as a model result.

| Condition | `provider` | `model` | `degraded` | UI label |
| --- | --- | --- | --- | --- |
| No provider key | `deterministic-demo` | `miraiwerk-rules-v1` | `false` | Deterministic demo mode |
| Gemini success | `gemini` | configured model | `false` | Google Gemini · model |
| Gemini failure, fallback on | `deterministic-demo` | `miraiwerk-rules-v1` | `true` | Degraded fallback, with notice |
| Gemini failure, fallback off | no proposal | — | — | Analysis failed; ticket retained |
| Meta success | `meta` | configured model | `false` | Meta Model API · model |
| Meta failure, fallback on | `deterministic-demo` | `miraiwerk-rules-v1` | `true` | Degraded fallback, with notice |
| Meta failure, fallback off | no proposal | — | — | Analysis failed; ticket retained |

Proposal metadata:

```json
{
  "modelProvider": "deterministic-demo",
  "modelName": "miraiwerk-rules-v1",
  "modelMeta": {
    "degraded": false,
    "latencyMs": 1.4,
    "notice": null,
    "toolCalls": []
  }
}
```

`ai_calls` records provider, model, workflow, latency, success, degraded, error, and token usage for every attempt. A failed provider call is recorded as a failure even when a labelled fallback then succeeds.

The browser never receives the key. `VITE_*` variables are public and are limited to the API base URL.

## 4. Dates and capacity

Two separate ideas are kept separate:

- **Stated dates** come from the brief. They are preserved and labelled as targets.
- **Scheduled dates** are computed by RippleMap from start date, dependencies, estimates, and working days. They are planning estimates.

The plan generator never invents a target date that the brief did not supply. When `targetDate` is `null`, the scheduled dates still exist, but no target is fabricated.

Capacity follows the same rule:

- `constraints.capacityPersonDays` is used only when the brief supplies it.
- Otherwise `capacity` may be `null` or carry a note that no capacity was stated.
- Utilization is shown only when a stated capacity exists.
- The scheduler does not add headcount, assume parallel teams, or convert an unknown into a percentage.

Effort estimates are planning estimates. A correct classification does not turn them into delivery commitments.

## 5. Proposal → simulation → approval

### Proposal

`POST /api/tickets/:id/analyze` creates a proposal against the current plan version. It stores:

- classification and policy outcome
- evidence, unknowns, questions
- related records and duplicate candidates
- accept and optional split changes
- the provider/model metadata
- deterministic scenario runs for every available option

The proposal is a hypothesis about a change. It is not a plan mutation.

### Simulation

RippleMap is pure deterministic TypeScript. For a given graph, change, related-task set, and target milestone it:

1. Applies additions, updates, removals, and dependencies.
2. Validates the resulting graph.
3. Schedules baseline and scenario on working days.
4. Computes the plan diff and milestone deltas.
5. Computes effort, schedule, critical-path, and breach metrics.
6. Emits policy findings (release-gate slips, breached targets, capacity overruns).
7. Produces an `inputHash` fingerprint.

The same inputs produce the same output. There is no model call in the simulation path, so an LLM cannot argue a milestone into moving.

Defer, duplicate, and clarify use an empty change and still produce a scenario. This makes the "plan does not move" claim inspectable rather than implied.

### Approval preconditions

Approval runs inside one database transaction:

```text
lock proposal
  → check role owner|pm
  → check proposal pending
  → lock project
  → compare project version with proposal.basePlanVersion
  → recompute scenario from current plan
  → require a stored scenario for the option
  → require stored.valid = true
  → require stored.inputHash = fresh hash
  → accept/split: mutate, re-schedule, snapshot new version
  → mark sibling pending proposals stale
  → update proposal and ticket
  → write decision audit + project audit
commit
```

Failure modes are explicit:

| Condition | Result |
| --- | --- |
| Non-approver role | `403 FORBIDDEN` |
| Proposal not pending | `409 DECISION_NOT_PENDING` |
| Plan version advanced | Proposal marked `stale`; `409 STALE_PROPOSAL` |
| No stored scenario | `409 SCENARIO_REQUIRED` |
| Stored scenario invalid | `422 SCENARIO_INVALID` |
| Stored hash does not match | `409 SCENARIO_STALE` |
| Requested baseline is wrong | `409 BASELINE_VERSION_MISMATCH` |
| Change corrupts the graph | `422 INVALID_PLAN_AFTER_APPROVAL` |

### Versioning and audit

| Outcome | New plan version | Ticket status | Audit |
| --- | :---: | --- | --- |
| `accept` | Yes | `accepted` | `approved` + `plan.versioned` |
| `split` | Yes | `accepted` | `approved` + `plan.versioned` |
| `defer` | No | `deferred` | `approved` |
| `duplicate` | No | `duplicate` | `approved` |
| clarify action | No | `needs_clarification` | `clarified` |
| reject action | No | `rejected` | `rejected` |
| sweep after version | No | unchanged | `stale` |

A plan version stores a complete bundle snapshot, including requirements, milestones, tasks, dependencies, assumptions, and missing information. `parentVersionId` links the chain.

Audit is append-only at the application level. Decision audit records include actor, action, reason, before/after JSON, and timestamp. Project audit records provide the timeline used by the history page. Nothing is silently overwritten.

## 6. What the system does not claim

- A duplicate candidate is not proof of duplication.
- A related task link is not confirmed scope.
- A planning estimate is not a deadline commitment.
- A deterministic score is not Meta model quality.
- A model failure marked `degraded` is not a successful model output.
- A stale proposal is not repaired automatically; re-analysis is required.
- An approval is not autonomous. A human with owner or PM role must perform it.

These limits are deliberate. The product's value comes from making the boundary between proposal and fact visible, not from hiding it behind a confident paragraph.

## 7. How this is tested

- `packages/ripplemap` unit tests cover graph validation, cycle detection, working-day scheduling, milestone deltas, critical path, scenario validity, and hash stability.
- `backend/src/__tests__/api.integration.test.ts` exercises the full loop: project v1, ticket intake, analysis, simulation, accept → v2, sibling stale → `409`, missing scenario → `409`, defer without versioning, role gates, and schema errors. It creates and deletes its own users and project.
- `aiml/evaluations/tickets.json` holds 40 hand-labelled tickets. The generated report is in `aiml/evaluations/report.md`; interpretation rules are in `aiml/evaluations/README.md`.

Run:

```bash
npm test
npm run evaluate
```

The integration suite requires PostgreSQL running and migrated. The evaluation defaults to the deterministic path; `--provider=meta` requires a configured key.
