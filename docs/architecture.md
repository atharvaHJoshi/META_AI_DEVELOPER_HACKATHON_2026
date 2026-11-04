# Architecture

MIRAIWERK AI is a modular monolith. It has one React frontend, one HTTP backend, one database and a deterministic simulation engine. The interesting boundary is not service count; it is the boundary between what a model proposes and what deterministic code can prove.

## System context

```text
frontend/ (React)
   │  JSON + bearer token / demo identity
   ▼
backend/ (Django + FastAPI, ASGI app on port 4000)
   │  /api → FastAPI (HTTP API, JWT auth)   /admin → Django admin (staff only)
   ▼
PostgreSQL
   ├── platform_app   models, migrations, ORM, admin
   ├── api/           routers + Pydantic validation
   ├── services/      business logic orchestration
   ├── aiml/          model orchestration, deterministic rules, policy
   └── ripplemap/     deterministic scheduling + scenario simulation
```

The backend is stateless. All durable state lives in PostgreSQL. The browser never receives a model key and never performs authorization decisions.

## Modules

| Module | Responsibility |
| --- | --- |
| `frontend/src/pages` | Workspace, plan generator, plan, tickets, decision card, RippleMap, history, platform and collaboration pages. |
| `frontend/src/components` | Gantt, RippleMap scenario impact, milestone deltas, app shell, shared UI primitives. |
| `backend/api/routers` | HTTP parsing, Pydantic validation, status codes. No business rules. |
| `backend/services` | Plan, ticket, decision, simulation, auth, organization, task and collaboration orchestration. |
| `backend/platform_app` | Django models, migrations, admin registrations, password hashing, seed command. |
| `backend/api/deps.py` | Bearer/demo identity resolution, workspace selection header. |
| `backend/services/authz.py` | Workspace/organization/project role resolution and access assertions. |
| `backend/services/auth_service.py` | Argon2id hashing, JWT issuance, refresh-token rotation, OAuth state, sessions. |
| `backend/aiml/gemini.py` | Gemini adapter, prompts, structured-output schemas, bounded retries. |
| `backend/aiml/analyzer.py` + `aiml/policy.py` | Labelled deterministic ticket analysis rules and priority policy. |
| `backend/aiml/templates.py` | Labelled deterministic plan templates (commerce + generic). |
| `backend/ripplemap` | Graph validation, working-day scheduling, RippleMap simulation. |

Services receive plain inputs and return contract-shaped objects. The AIML and RippleMap packages have no knowledge of Django, FastAPI or PostgreSQL.

## AIML boundary

`backend/aiml/` is a pure Python library. The dependency direction is one-way:

```text
frontend ──► backend/api ──► backend/services ──► aiml / ripplemap
```

- The services layer may import AIML; AIML never imports services, Django models, the HTTP layer, or PostgreSQL.
- AIML returns proposals and policy outcomes. It does not persist, approve, or version anything.
- Model output is validated against the Pydantic contracts in `aiml/schemas.py` before the backend stores it; a validation failure degrades to labelled deterministic rules.
- When no key is configured, the same public surface returns labelled deterministic rules.
- The API integration suite exercises the same public surface through the HTTP layer.

This keeps the model replaceable and the approval boundary auditable.

## Data model

```text
users ──< project_members >── projects
                                  │
        ┌─────────────────────────┼───────────────────────────────┐
        │                         │                               │
        ▼                         ▼                               ▼
   requirements               milestones                         tickets
        │                         │                               │
        └──────────< tasks >──────┘                               │
                       │                                          │
                       ▼                                          ▼
               task_dependencies                          decision_proposals
                                                                  │
                                              ┌───────────────────┼──────────────────┐
                                              ▼                   ▼                  ▼
                                         scenario_runs       decision_audit     ticket_links
                                                                  │
                                                                  ▼
                                                             audit_events

plan_versions (snapshot_json, version_number, parent_version_id)
ai_calls (provider, model, latency, success, degraded, error)
```

The unified platform migration adds a tenant and collaboration layer alongside the decision model:

```text
organizations ──< organization_members >── users
      │
      └──< workspaces ──< workspace_members >── users
                 │
                 ├──< teams ──< team_members >── users
                 ├──< documents
                 ├──< meetings
                 └──< forum_threads ──< forum_replies

users ──< sessions
users ──< oauth_accounts
users ──< one_time_tokens
workspace events ──< security_audit
```

Key properties:

- IDs are application-generated text values (`prj_`, `req_`, `task_`, `tkt_`, `dec_`, `scn_`, `audit_`). This keeps seeded and API-created records identical in shape.
- `plan_versions.snapshot_json` stores a complete plan bundle, including assumptions and missing information. The current tables are the working set; snapshots make the version history reconstructable.
- `scenario_runs` stores the deterministic output and an `input_hash`. Approval requires the hash to match a freshly computed scenario.
- `decision_audit` records before/after state for each decision action. `audit_events` is the project-level timeline.
- `tickets.source_ticket_id` on tasks makes approved work traceable back to the intake record.

## Plan generation

```text
brief ──► provider (Gemini, Meta, or deterministic)
      ──► PlanDraft (requirements, milestones, tasks, dependencies,
                     assumptions, missing information, risks)
      ──► validatePlanDraft (schema + graph validation)
      ──► human review in the web UI
      ──► createProject
      ──► schedule tasks
      ──► persist plan version 1 + audit
```

Plan generation never creates a project by itself. The user reviews the draft first. The generator distinguishes:

- **Explicit** requirements derived from the brief.
- **Inferred** requirements and links.
- **Unknown** deadline, capacity, and technology constraints, which are surfaced as missing information.

Dates supplied by the user are preserved. Dates derived by the rules are labelled planning estimates. The system does not add headcount or pretend a capacity number exists.

## Ticket analysis

```text
ticket ──► load current plan bundle
       ──► load recent tickets for duplicate candidates
       ──► build AnalysisContext
       ──► provider analysis
       ──► sanitize unknown record references
       ──► apply policy priority rules
       ──► compute scenarios for available options
       ──► persist proposal + links + scenario runs + audit
```

The analysis contract requires:

- classification (`ticketType`, priority, urgency, summary, business/customer impact)
- related records with `evidenceState`
- evidence items with a source and excerpt
- unknowns and clarifying questions
- duplicate candidates
- a recommended option and rationale
- an accept change and optional split change

The API discards links or evidence that reference records outside the current project and records warnings. Model output is a proposal, never a mutation.

### Policy layer

The policy engine runs after the model/rule classification and can only raise or lower priority according to configured rules:

- escalation components (for example `payments`, `checkout`, `auth`)
- production incidents
- reported severity
- P0 evidence requirements (impact, environment, concrete evidence)
- non-defect tickets cannot hold P0
- response-window labels derived from the final priority

## RippleMap

`backend/ripplemap` is pure Python with no I/O. The port was verified output-for-output against the original TypeScript implementation.

### Validation

- unique task IDs
- known milestones and dependency endpoints
- positive effort estimates
- no self-dependencies
- cycle detection with a readable cycle path
- topological ordering

### Scheduling

- Project starts on the next working day.
- Tasks start after all predecessors finish.
- Effort is rounded up to whole working days.
- Weekends are skipped.
- Forward pass computes planned start/finish.
- Backward pass computes latest start/finish and slack.
- Slack zero marks the critical path.
- Milestones receive a computed date from their latest task and are checked against target dates.

### Scenario simulation

Given a baseline graph and a `ProposedChange`:

1. Apply task additions, updates, removals, and dependency additions.
2. Re-validate the graph.
3. Schedule baseline and scenario.
4. Compute the plan diff: added/removed/changed tasks, added dependencies, milestone deltas.
5. Compute metrics: tasks added/changed/removed, dependencies added, effort added, schedule delta, shifted/breached milestones, affected task count, total effort.
6. Emit policy findings, including release-gate slips, breaches, and stated-capacity overruns.
7. Hash the graph + options to produce a deterministic input hash.

Defer, duplicate, and clarify use an empty change. They still produce a scenario so the UI can show that the plan does not move and that risk remains unresolved.

## Decision and versioning flow

```text
simulate(option)
   └─ store scenario_run(input_hash, output_json, valid)

approve(option, reason)
   └─ BEGIN
      ├─ lock proposal row
      ├─ check role = owner|pm
      ├─ check proposal still pending
      ├─ lock project row
      ├─ compare project.current_plan_version with proposal.base_plan_version
      │    └─ mismatch: mark stale + audit + 409
      ├─ recompute scenario from current plan
      ├─ require stored scenario for option
      ├─ require stored.valid = true
      ├─ require stored.input_hash = fresh hash
      ├─ accept/split: mutate working tasks, re-schedule, snapshot new version
      ├─ mark other pending proposals stale + append stale audits
      ├─ update proposal + ticket status
      ├─ write decision audit + project audit
      └─ COMMIT
```

Approval is transactional because partial version creation is worse than a failed request. Sibling proposals are invalidated because they were computed against an older plan. The user must re-analyse rather than approve a decision assembled from two different plan states.

### Option semantics

| Option | Plan mutation | New version | Ticket status |
| --- | --- | --- | --- |
| `accept` | Adds the scoped fix and test | Yes | `accepted` |
| `split` | Adds mitigation + permanent fix + verification | Yes | `accepted` |
| `defer` | None | No | `deferred` |
| `duplicate` | None | No | `duplicate` |
| `clarify` | None | No | `needs_clarification` |

Reject is a separate action: it closes the proposal without a plan change and records the reason.

## Roles

| Action | Owner | PM | Member | Viewer |
| --- | :---: | :---: | :---: | :---: |
| Read project, plan, tickets, history | ✓ | ✓ | ✓ | ✓ |
| Create project | ✓ | ✓ | ✓ | ✓ |
| Create/analyse tickets | ✓ | ✓ | ✓ | — |
| Simulate decision options | ✓ | ✓ | ✓ | — |
| Approve / reject / clarify | ✓ | ✓ | — | — |

Identity is resolved from a bearer access token plus a rotating refresh cookie. When `AUTH_ALLOW_DEMO=true`, an `x-user-id` header (with a seeded fallback) remains available for local demos and integration tests. Workspace roles map to project roles server-side: `owner`/`admin` → `owner`, `manager` → `pm`, `member` → `member`, `viewer` → `viewer`.

> Project creation currently bootstraps membership from the demo user list. That is a demo convenience, not a production invitation model.

## AI provider boundary

The provider adapter exposes two workflows:

- `generatePlan(input)`
- `analyzeTicket(context)`

Both return structured results with `provider`, `model`, `degraded`, `notice`, `latencyMs`, and usage metadata. The API records every call in `ai_calls`, including failures and fallbacks.

Both a Gemini adapter and a Meta adapter are available; `AI_PROVIDER` selects the active one. Meta requests use:

- OpenAI-compatible `POST /chat/completions`
- JSON-schema response formats
- bounded retries with exponential backoff
- request timeouts
- an optional read-only tool loop (project snapshot, requirements, tasks, milestones, related tickets)

Gemini requests use the Google Generative Language API with the same structured-output contract, bounded retries and timeouts. The deterministic implementation provides identical contracts without a network call. It is explicitly labelled in the UI, API metadata and proposal records. A provider failure with fallback enabled becomes a deterministic proposal marked `degraded`, never a silent success.

## Error model

Every error response has the shape:

```json
{
  "error": {
    "code": "STALE_PROPOSAL",
    "message": "The plan moved to version 3 after this proposal was generated...",
    "details": null
  }
}
```

- `401 UNAUTHENTICATED` — missing or unknown identity
- `403 FORBIDDEN` — not a member or insufficient role
- `404 *_NOT_FOUND` — missing project/ticket/decision
- `409` — stale proposal, non-pending decision, missing/mismatched scenario, baseline mismatch
- `422 VALIDATION_ERROR` — Pydantic schema failure (flattened `fieldErrors` / `formErrors` in the error details)
- `422 INVALID_PLAN` / `SCENARIO_INVALID` — graph or proposal invalid
- `502 MODEL_UNAVAILABLE` — model failure when fallback is disabled
- `500 INTERNAL_ERROR` — unexpected server failure

## Testing strategy

- **RippleMap unit tests** cover cycle detection, working-day scheduling, scenario validity, milestone deltas, critical path, and hash stability — and are verified against the original engine.
- **API integration tests** run against PostgreSQL through the ASGI app and cover the full decision loop, role gates, stale handling, scenario enforcement, defer semantics, and validation. They create their own isolated users/project and clean up.
- **Frontend unit/component tests** cover formatting helpers and shared UI primitives.
- **Playwright E2E journeys** cover sign-in/access, viewer permissions, RippleMap approval, ticket intake and analysis, Kanban, documentation, discussions, meetings, responsive navigation and API failure states.

## Deferred by design

No repository-writing code editor, coding agent, video-conference integration, universal ticketing ingestion, autonomous plan mutation, multi-agent orchestration, billing, or fine-tuning. The product earns trust by keeping the proposal/simulation/approval chain inspectable.
