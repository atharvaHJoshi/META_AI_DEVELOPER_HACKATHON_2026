# MIRAIWERK AI — Project Progress Report

> **This report is superseded (November 2026).** The backend it describes was fully rebuilt in **Python**: Django 6 (models, migrations, admin, ORM) owns the schema and `backend/aiml`, `backend/ripplemap` are Python ports of the TypeScript AIML and RippleMap packages, which have been removed. FastAPI owns the HTTP API (same `/api` contract). The backend integration suite now runs as pytest (`backend/tests/`, 45 passing across the RippleMap unit suite, the core decision-loop suite, the write-surface suite and the Django admin compatibility suite), and `docs/architecture.md` and the root `README.md` describe the current system. The original TypeScript backend is preserved in git history. The remainder of this document is the October 2026 snapshot, kept for the record.

**Report date:** 26 October 2026  
**Status:** End-to-end demo working; production hardening not started  
**Repository root:** `/home/aathi/Documents/HACKATHON/META_AI_HACKATHON_2026`  
**Product:** MIRAIWERK AI  
**Tagline:** The intelligence engine for projects that move forward.  
**Core module:** RippleMap — change-impact simulation for the project plan

---

## Contents

1. [Executive summary](#1-executive-summary)
2. [Product definition](#2-product-definition)
3. [Current repository structure](#3-current-repository-structure)
4. [Technology stack](#4-technology-stack)
5. [What has been built](#5-what-has-been-built)
6. [API surface](#6-api-surface)
7. [Decision semantics](#7-decision-semantics)
8. [Evidence and honesty contract](#8-evidence-and-honesty-contract)
9. [Evaluation results](#9-evaluation-results)
10. [Verification log](#10-verification-log)
11. [Environment and configuration](#11-environment-and-configuration)
12. [Known limitations](#12-known-limitations)
13. [Deferred scope](#13-deferred-scope)
14. [Recommended next steps](#14-recommended-next-steps)
15. [Summary of completed work](#15-summary-of-completed-work)

---

## 1. Executive summary

MIRAIWERK AI is now a working, end-to-end AI-native project planning and ticket-intelligence system. It accepts a project brief, generates a dependency-aware plan, analyses incoming tickets against that plan, simulates the impact of each possible decision, and requires a human approval before a new plan version is created.

The application has been rebuilt around a clean three-application structure:

```text
frontend/   React workspace and decision UI
backend/    Express API, PostgreSQL persistence, auth, migrations, tests
aiml/       Meta adapter, prompts, deterministic rules, policy, benchmark
packages/   shared contracts and the RippleMap simulation engine
```

The previous product name has been removed from the current application, documentation, package names, database configuration, demo identities, model labels, and UI. The old project is preserved inside `.archive/legacy-spmt/` and is excluded from the active build.

### Current verified state

| Item | State |
| --- | --- |
| Frontend | Running at `http://localhost:5173` |
| Backend | Running at `http://localhost:4000` |
| API health | `{"status":"ok","ai":"deterministic-demo"}` |
| Database | `miraiwerk-db`, PostgreSQL 16, healthy on host port `55434` |
| Seed project | `prj_3d9d16d8313746f580cb`, plan **v2**, **19 tasks**, 3 milestones |
| Pending decisions | 4 |
| Demo members | 4 (owner, PM, member, viewer) |
| Tests | **18 / 18 passing** |
| Typecheck | Passing across all workspaces |
| Evaluation | **99.5%** overall on the 40-case deterministic benchmark |
| Model mode | Deterministic `miraiwerk-rules-v1`; no Meta key configured |
| Browser automation | Not available in this environment; UI verified by build, typecheck, and HTTP |

### Completed high-level scope

- Full rebrand to **MIRAIWERK AI**.
- Clean `frontend/`, `backend/`, `aiml/`, `packages/` workspace split.
- Project brief → generated plan → review → committed plan version.
- Ticket intake → AI analysis → evidence-backed proposal.
- RippleMap deterministic simulation for every decision option.
- Human approval, rejection, clarification, deferral, and duplicate handling.
- Plan versioning with immutable snapshots.
- Stale-proposal detection and revalidation refusal.
- Decision audit trail and project audit history.
- Demo identity switching and role-based permissions.
- 40-case labelled ticket benchmark and generated reports.
- PostgreSQL integration test suite.
- Seeded commerce-relaunch demo scenario.
- Environment templates, Docker database, and root lifecycle scripts.

---

## 2. Product definition

### Positioning

MIRAIWERK AI is an AI-native project planning, ticket-intelligence, and change-impact platform.

It is not another static project tracker. The product treats incoming work as a proposed disturbance to an existing plan and makes the consequences visible before the plan changes.

### Brand personality

> Precise German engineering × Japanese forward thinking × modern English technology.

The UI, copy, and architecture follow that direction: restrained dark surfaces, editorial typography, precise labels, explicit evidence states, and no inflated AI claims.

### Core product loop

```text
Project brief
    ↓
Generated draft plan
    ↓
Human-reviewed plan baseline
    ↓
Incoming ticket
    ↓
AI analysis + evidence ledger
    ↓
Proposal: accept / split / defer / clarify / duplicate
    ↓
RippleMap deterministic impact simulation
    ↓
Human approval
    ↓
New plan version + audit trail
```

### RippleMap

RippleMap is the named change-impact engine. It answers:

> If this ticket or decision moves, what else moves with it?

It simulates the proposal against the current dependency graph and returns:

- tasks added, changed, or removed;
- dependencies added;
- effort added;
- milestone date deltas;
- target-date breaches;
- critical path and slack;
- affected tasks and milestones;
- policy findings;
- capacity utilisation when capacity is stated;
- a deterministic input hash.

RippleMap is pure TypeScript. It does not call a model, read the database, or invent a deadline.

---

## 3. Current repository structure

```text
.
├── frontend/                   React 18 + Vite + Tailwind application
│   ├── src/
│   │   ├── pages/              Workspace, plan generator, plan, tickets, decision card, history, docs
│   │   ├── components/         Layout, Gantt, RippleMap impact, milestone deltas, UI primitives
│   │   ├── context/            Bootstrap, demo identity, toast state
│   │   ├── hooks/              API query lifecycle
│   │   └── lib/                Typed API client, formatting, proposal helpers
│   ├── index.html
│   └── package.json
├── backend/                    Express + TypeScript API
│   ├── src/
│   │   ├── routes/             HTTP parsing and validation
│   │   ├── services/           Plan, ticket, decision, simulation logic
│   │   ├── db/                 Pool, row mapping, plan snapshots
│   │   ├── lib/                HTTP errors and helpers
│   │   ├── auth.ts             Demo identity + project roles
│   │   ├── config.ts           Environment and AI-mode configuration
│   │   ├── app.ts              Express application
│   │   └── index.ts            Process entry point
│   ├── db/migrations/          SQL schema
│   ├── scripts/                migrate, seed, reset
│   ├── src/__tests__/          PostgreSQL integration suite
│   └── package.json
├── aiml/                       AI/ML layer
│   ├── src/
│   │   ├── providers/meta.ts   Meta Model API adapter and prompts
│   │   ├── rules/              Deterministic planner and ticket analyser
│   │   ├── lib/text.ts         Lexical matching and excerpt helpers
│   │   ├── policy.ts           Priority and response-window policy
│   │   ├── schemaJson.ts       JSON schemas sent to the model
│   │   ├── tools.ts            Read-only model tools
│   │   ├── types.ts            Shared AI input/output types
│   │   ├── config.ts           Lazy environment configuration
│   │   └── index.ts            Public package surface
│   ├── scripts/evaluate.ts     Benchmark runner
│   ├── evaluations/            Dataset, reports, interpretation
│   └── package.json
├── packages/
│   ├── schemas/                Shared Zod contracts and product constants
│   └── ripplemap/              Deterministic scheduling and impact simulation
├── docs/
│   ├── architecture.md
│   ├── api.md
│   ├── setup.md
│   ├── evidence-contract.md
│   ├── demo-script.md
│   ├── merge-notes.md
│   └── progress-report.md     This report
├── docker-compose.yml          PostgreSQL 16 on host port 55434
├── .env.example                Safe configuration template
├── package.json                npm workspaces and root lifecycle scripts
└── README.md                   Product overview and quick start
```

### Boundary rules

```text
frontend → backend → aiml → schemas / ripplemap
```

- The frontend never receives a Meta key.
- The backend is the only application allowed to persist or authorize.
- AIML returns proposals and policy outcomes only.
- AIML never imports Express, the database, or backend code.
- RippleMap never imports AIML, Express, or the database.
- Shared Zod contracts are the single source of truth for API shapes.
- Model output is validated before it can be stored or approved.

---

## 4. Technology stack

| Layer | Technology |
| --- | --- |
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, React Router |
| Backend | Node.js 20+, Express, TypeScript, Zod |
| AIML | Pure TypeScript library, Meta Model API adapter, deterministic rules |
| Database | PostgreSQL 16 |
| Shared contracts | Zod + inferred TypeScript types |
| Simulation | Custom deterministic TypeScript scheduler and diff engine |
| AI API | OpenAI-compatible Chat Completions shape, JSON-schema responses, read-only tools |
| Tests | Vitest, Supertest |
| Local infrastructure | Docker Compose, `miraiwerk-db` on port `55434` |
| Package manager | npm workspaces |

The backend is deliberately a modular monolith: one deployable API, explicit service boundaries, and no unnecessary distributed-system complexity.

---

## 5. What has been built

### 5.1 Brand migration and naming cleanup

Completed across the current application:

- Product renamed to **MIRAIWERK AI**.
- Tagline added: **“The intelligence engine for projects that move forward.”**
- Previous product name removed from UI, docs, tests, seed data, environment defaults, prompts, and package names.
- Workspace package scope changed to `@miraiwerk/*`.
- Root package changed to `miraiwerk`.
- Demo email domain changed to `@miraiwerk.demo`.
- Deterministic model label changed to `miraiwerk-rules-v1`.
- Browser identity storage key changed to `miraiwerk.user`.
- JSON schema titles changed to `MiraiwerkPlan` and `MiraiwerkTicketAnalysis`.
- Database container renamed to `miraiwerk-db`.
- Database name, user, and development password renamed to `miraiwerk`.
- Docker volume renamed to `miraiwerk_pgdata`.
- Shared tagline and signature constants added to `packages/schemas`.
- UI metadata and page title updated to MIRAIWERK AI.
- Navigation now presents **Plan & RippleMap**.
- Sidebar wordmark now reads **MIRAIWERK AI** with an “AI project intelligence” subline.
- RippleMap is presented as the named impact module in the plan view, decision card, and in-product documentation.

### 5.2 Frontend

The frontend is a complete React application, not a placeholder.

#### Pages

| Page | Route | Purpose |
| --- | --- | --- |
| Workspace | `/` | Project portfolio, decision queue, pending work, AI mode |
| Plan generator | `/projects/new` | Two-step brief → draft → review → commit |
| Plan & RippleMap | `/projects/:projectId` | Current plan, Gantt, requirement coverage, pending impacts, constraints, members |
| Ticket inbox | `/projects/:projectId/tickets` | Filterable intake list |
| New ticket | `/projects/:projectId/tickets/new` | Evidence-aware intake and analysis trigger |
| Decision card | `/projects/:projectId/tickets/:ticketId` | Classification, evidence, RippleMap comparison, approval |
| History | `/projects/:projectId/history` | Plan versions, decision ledger, audit events |
| How MIRAIWERK decides | `/docs` | In-product explanation of evidence, simulation, approval, staleness, RBAC |
| Not found | `*` | Safe fallback |

#### Workspace

- Project cards with current plan version, role, open tickets, and pending decisions.
- Prioritised decision queue across projects.
- Pending ticket list with priority and recommendation labels.
- AI-mode indicator that distinguishes Meta from deterministic demo mode.
- Demo identity switcher for Maya, Arjun, Lena, and Priya.
- Empty states and retry/error states.

#### Plan generator

- Project brief form: name, goal, description, start date, target date, team, capacity, technology, non-negotiables.
- Generation step with loading and failure states.
- Draft review before the baseline is committed.
- Milestones and task schedule preview.
- Requirements, acceptance criteria, assumptions, unknowns, and risks.
- Validation surface for graph errors and warnings.
- Explicit warning when a deterministic draft was produced instead of a Meta draft.
- Commit action creates the initial project and plan version.

#### Plan & RippleMap

- Current plan header with version, role, schedule window, and project status.
- Plan validation banner when a stored version has graph errors.
- Gantt-style task schedule with milestones and dependency context.
- Requirement coverage and traceability.
- Pending work already simulated through RippleMap.
- Constraints panel: team, capacity, technology, non-negotiables, release freeze.
- Project members and roles.
- Links into ticket creation, ticket inbox, and history.

#### Ticket intake

- Title, description, source, optional type, affected component, reported impact, evidence, reporter, environment, and reported severity.
- Optional manual classification with the alternative to let MIRAIWERK classify.
- Analysis immediately after creation.
- Clear recovery path if the ticket is saved but analysis fails.
- Guidance that missing information becomes an open question rather than an invented answer.

#### Decision card

- Ticket identity and current status.
- Classification: type, priority, urgency, summary, business impact, customer impact.
- Policy-adjusted intake: model priority vs final priority, rules applied, response window.
- Evidence ledger with **observed**, **inferred**, and **unknown** states.
- Related records with relationship type and evidence state.
- Duplicate candidates with explicit caution that similarity is not proof.
- Unknowns and clarifying questions.
- Accept and split proposals.
- RippleMap comparison across decision options.
- Stored scenario per option.
- Approval controls restricted by role.
- Staleness warning when the proposal baseline no longer matches the current plan.
- Model notice and degraded-mode messaging.
- Decision audit history and raw ticket record.

#### History

- Immutable plan-version timeline.
- Version snapshots and change summaries.
- Human decision ledger with actor, action, reason, and timestamp.
- Project audit events for system actions.

#### In-product documentation

The docs page explains:

- the evidence contract;
- deterministic RippleMap behaviour;
- the five decision outcomes;
- staleness rules;
- versioning and audit transactions;
- role permissions;
- what Meta may and may not propose;
- the modular-monolith architecture.

#### Components and design system

- Shared layout with responsive sidebar and mobile navigation.
- Reusable badges, page headers, section headings, empty states, loading blocks, alerts, and toasts.
- Plan Gantt component.
- Scenario impact comparison.
- Milestone delta view.
- Dark ink/paper palette with ember and mint accents.
- Fraunces display type, Manrope body type, IBM Plex Mono for labels and evidence.
- Accessible focus states and responsive layouts.

### 5.3 Backend

#### HTTP layer

- Express application with Helmet and explicit CORS allow-list.
- JSON body limit of 2 MB.
- `/api/health` verifies database connectivity and reports the AI mode.
- Zod validation at every request boundary.
- Central API error mapping.
- No direct database access from route modules.

#### Services

| Service | Responsibility |
| --- | --- |
| `projectService` | Bootstrap, project creation, project list, plan loading, history, ticket list |
| `planService` | Plan generation, draft validation, graph conversion, version creation, AI-call recording |
| `ticketService` | Ticket creation, analysis orchestration, proposal persistence, policy application, duplicate candidates |
| `decisionService` | Approve, reject, clarify, staleness checks, plan mutation, audit |
| `simulationService` | Scenario computation, persistence, latest-scenario loading, baseline checks |
| `draftValidation` | Plan draft and graph validation |

#### Persistence

- PostgreSQL pool with transactions.
- Plan bundles are assembled from normalized rows.
- Every plan version stores an immutable JSON snapshot.
- AI calls are recorded with provider, model, duration, success, degraded flag, and usage.
- Scenario runs are stored with option, label, validity, output JSON, and input hash.
- Decision audits and project audit events are separate ledgers.

#### Authentication and roles

The current demo identity model uses the `x-user-id` header. If omitted, the backend falls back to the seeded Maya Chen identity. Unknown users receive `401`.

Roles:

| Role | Capabilities |
| --- | --- |
| `owner` | Read, create tickets, approve/reject/clarify decisions |
| `pm` | Read, create tickets, approve/reject/clarify decisions |
| `member` | Read, create tickets, request analysis; cannot approve |
| `viewer` | Read-only; cannot create tickets or approve |

Approver roles are defined centrally as `owner` and `pm`.

### 5.4 AIML layer

AIML is a dedicated workspace package, not backend utility code.

#### Meta provider

- OpenAI-compatible Chat Completions integration.
- Structured JSON-schema responses for plan drafts and ticket analyses.
- Separate system prompts for planning and ticket analysis.
- Ticket text is treated as untrusted data; prompt-injection instructions are explicitly not followed.
- Read-only tool loop.
- Configurable timeout, retries, base URL, and model.
- Typed `MetaError` with retryable/status information.
- Token usage and latency captured for storage.
- No browser exposure of the API key.

#### Read-only model tools

- Project snapshot.
- Project requirements.
- Related-ticket search.
- Dependency neighbourhood.
- Project policy.

These tools expose context only. They do not mutate the plan.

#### Deterministic rules

- `commercePlan` and `genericPlan` produce labelled draft plans.
- `demoPlan` selects the appropriate template.
- `demoAnalyzeTicket` classifies tickets without a model.
- Classification, priority, recommendation, evidence, unknowns, clarifying questions, related records, duplicate candidates, and proposed changes are generated deterministically.
- Deterministic output is explicitly labelled `miraiwerk-rules-v1` and never presented as a Meta result.
- `demoRelatedTickets` supports deterministic duplicate/related-ticket probing.

#### Policy engine

Applied after model or rules classification:

- Escalation-component priority floor.
- Production-incident priority floor.
- Reporter-critical severity floor.
- P0 evidence requirement.
- Non-defect P0 downgrade.
- Response windows based on final priority.
- Typed list of rules applied.
- Explicit escalation flag.

Default policy:

- Critical response: 24 hours.
- High response: 3 days.
- Normal response: 10 days.
- Release freeze: 3 days.
- P0 evidence required.

The seeded project overrides critical response to 4 hours, high response to 2 days, normal response to 7 days, and escalation components to payments, checkout, and auth.

#### Structured output contracts

`zod-to-json-schema` converts the shared Zod contracts into model response schemas:

- `MiraiwerkPlan`
- `MiraiwerkTicketAnalysis`

The same contracts validate the stored result, so a model cannot bypass the API shape.

### 5.5 RippleMap

RippleMap is implemented in `packages/ripplemap` as deterministic TypeScript.

#### Scheduling

- Working-day scheduling from the project start date.
- Weekend skipping.
- Finish-to-start dependencies.
- Topological ordering.
- Cycle detection with the full cycle path.
- Dangling dependency validation.
- Critical path and slack calculation.
- Deterministic task ordering for stable diffs.

#### Scenario simulation

- Applies accept, split, defer, clarify, and duplicate semantics.
- Adds, updates, and removes tasks.
- Adds dependencies.
- Recomputes the full schedule.
- Computes milestone deltas and target breaches.
- Identifies target milestones.
- Produces plan diff metrics.
- Computes capacity utilisation only from stated capacity.
- Emits policy findings.
- Hashes stable scenario input with SHA-256 into a 16-character fingerprint.
- Marks invalid scenarios without inventing a result.
- Leaves the plan unchanged for defer, clarify, and duplicate options.

#### Guarantees

- No model call inside simulation.
- No database access.
- No invented deadlines.
- No invented capacity.
- Deterministic output for identical input.
- Invalid graphs return errors rather than guessed schedules.
- Approval requires a stored scenario whose input hash still matches.

### 5.6 Shared contracts

`packages/schemas` owns:

- ticket types;
- severity and priority;
- decision options and statuses;
- evidence states;
- entity and relationship types;
- task statuses;
- project roles;
- ticket statuses;
- plan draft and generation contracts;
- project and bootstrap contracts;
- ticket analysis and proposal contracts;
- project graph and simulation contracts;
- approval, rejection, clarification, and simulation inputs;
- product tagline and signature constants.

The frontend and backend import the same package, so contract drift fails typecheck.

### 5.7 Data model

The initial migration creates 15 tables:

1. `users`
2. `projects`
3. `project_members`
4. `plan_versions`
5. `requirements`
6. `milestones`
7. `tasks`
8. `task_dependencies`
9. `tickets`
10. `ticket_links`
11. `decision_proposals`
12. `scenario_runs`
13. `decision_audit`
14. `audit_events`
15. `ai_calls`

Key design choices:

- Application-generated text IDs with domain prefixes.
- Roles constrained by check constraint.
- Immutable plan snapshots in `plan_versions.snapshot_json`.
- JSONB for model output, policy, evidence, unknowns, questions, related records, duplicates, and proposed changes.
- Separate decision audit and project audit ledgers.
- AI-call telemetry separated from business records.
- Cascade deletes for project-owned data.
- Indexes for project tickets, proposals, scenarios, audits, and AI calls.

### 5.8 Demo seed

The seed script resets the demo and creates a realistic commerce-relaunch scenario.

#### Users

| User | Role | Title |
| --- | --- | --- |
| Maya Chen | Owner | Director of Product |
| Arjun Patel | PM | Engineering Manager |
| Lena Ortiz | Member | Staff Engineer |
| Priya Shah | Viewer | Finance Partner |

#### Project

**Commerce Platform Relaunch**

- Goal: launch reliable checkout without duplicate charges or broken order state.
- Stack: React, TypeScript, Node.js, PostgreSQL, payment processor.
- Team: 2 backend, 1 frontend, 1 QA, shared DevOps.
- Capacity: 260 person-days.
- Payments release gate must pass before production launch work.
- Policy: 4-hour critical response, 2-day high response, 7-day normal response.
- Result: plan v1, then an approved search-regression fix creates plan v2.
- Current state: 19 tasks, 3 milestones, 4 pending decisions.

#### Seeded tickets

1. **Search filters reset when returning from a product page**
   - Approved.
   - Produces plan version 2.
   - Demonstrates the mutation path and audit trail.

2. **Customers charged twice after checkout retry**
   - Production incident.
   - Recommendation: split into mitigation and permanent fix.
   - Priority: P0.

3. **Add saved payment methods for returning customers**
   - Feature request.
   - Recommendation: defer.
   - Demonstrates that not every ticket should enter the current plan.

4. **Something about checkout seems off on some devices**
   - Vague report.
   - Recommendation: clarify.
   - Demonstrates unknown evidence and clarifying questions.

5. **Duplicate charge reported after checkout retry**
   - Duplicate-looking but different root cause.
   - Recommendation: accept.
   - One duplicate candidate, not a confirmed duplicate.
   - Demonstrates that lexical similarity is not proof.

### 5.9 Evaluation harness

`aiml/scripts/evaluate.ts` runs a fixed, hand-labelled 40-case ticket benchmark through the real analyser and policy layer.

It supports:

- deterministic mode by default;
- Meta mode with `--provider=meta`;
- human-readable Markdown report;
- machine-readable JSON report;
- per-case results;
- confusion matrices;
- duplicate probes;
- honesty note distinguishing fallback calibration from model quality.

Generated files:

- `aiml/evaluations/report.md`
- `aiml/evaluations/report.json`
- `aiml/evaluations/tickets.json`
- `aiml/evaluations/README.md`

### 5.10 Tests

#### RippleMap unit tests — 6

- Working-day weekend skipping.
- Dependency-cycle rejection with path.
- Dangling dependency rejection.
- Deterministic before/after schedule and milestone delta.
- Invalid scenario for a cycle.
- Defer leaves the plan unchanged.

#### Backend integration tests — 12

- Labelled health response.
- Owner-only project listing.
- Viewer blocked from creating tickets.
- Ticket creation and evidence-backed analysis.
- Scenario simulation against the proposal baseline.
- Second proposal against the same baseline before approval.
- Members and viewers forbidden from approving.
- Accept creates plan version 2 and full audit history.
- Sibling proposals become stale and cannot be revalidated or approved.
- Approval requires a stored, matching scenario.
- Defer records an audited decision without versioning.
- Malformed ticket input returns a schema error.

The backend suite requires PostgreSQL and applies migrations. It creates and cleans up its own users and project.

### 5.11 Tooling and scripts

| Command | Purpose |
| --- | --- |
| `npm install` | Install all workspaces |
| `npm run dev` | Build dependencies, then run backend and frontend |
| `npm run dev:backend` | Run only the API |
| `npm run dev:frontend` | Run only the Vite app |
| `npm run build` | Build schemas, RippleMap, AIML, backend, frontend |
| `npm run build:deps` | Build schemas, RippleMap, and AIML |
| `npm run typecheck` | Build dependencies, then typecheck all workspaces |
| `npm test` | Build dependencies, then run all tests |
| `npm run evaluate` | Build dependencies, then regenerate benchmark reports |
| `npm run db:up` | Start `miraiwerk-db` |
| `npm run db:down` | Stop the compose service |
| `npm run db:migrate` | Apply SQL migrations |
| `npm run db:seed` | Reset and seed demo data |
| `npm run db:reset` | Reset schema, migrate, and seed |

Lifecycle hooks ensure dependent packages are built before `dev`, `test`, `typecheck`, `evaluate`, and `db:seed`.

---

## 6. API surface

All protected endpoints use the demo identity header:

```http
x-user-id: usr_maya
```

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Database and AI-mode health |
| GET | `/api/bootstrap` | Users, projects, AI mode, active user context |
| GET | `/api/ai/status` | Current AI provider and model |
| GET | `/api/projects` | Projects visible to the active user |
| POST | `/api/projects/generate-plan` | Generate a draft plan |
| POST | `/api/projects` | Commit a draft as a new project |
| GET | `/api/projects/:id/plan` | Current plan bundle and RippleMap context |
| GET | `/api/projects/:id/tickets` | Ticket list for a project |
| GET | `/api/projects/:id/history` | Plan versions, decisions, audit events |
| POST | `/api/tickets` | Create a ticket |
| GET | `/api/tickets/:id` | Ticket, links, proposal, audit |
| POST | `/api/tickets/:id/analyze` | Analyse and persist a proposal |
| GET | `/api/decisions/:id` | Load a decision proposal |
| POST | `/api/decisions/:id/simulate` | Compute and store a scenario |
| POST | `/api/decisions/:id/approve` | Approve a decision |
| POST | `/api/decisions/:id/reject` | Reject a decision |
| POST | `/api/decisions/:id/clarify` | Request clarification |

### Validation and errors

- Every body is parsed through a Zod schema.
- Unknown users receive `401 UNAUTHENTICATED`.
- Missing project membership receives `403 FORBIDDEN`.
- Role violations receive `403 FORBIDDEN`.
- Stale or missing scenarios return `409`.
- Invalid graph or simulation input returns a structured validation error.
- Unexpected errors pass through a central middleware.

---

## 7. Decision semantics

| Option | Changes plan? | Result |
| --- | --- | --- |
| `accept` | Yes | Adds proposed work and creates a new plan version |
| `split` | Yes | Adds mitigation and durable fix, then versions |
| `defer` | No | Records deferral and keeps risk visible |
| `clarify` | No | Marks ticket `needs_clarification` and stores questions |
| `duplicate` | No | Links only to an identified candidate; similarity is not proof |

### Approval rules

- Only `owner` and `pm` may approve, reject, or clarify.
- Membership is checked before any decision action.
- Approval requires a stored scenario for the selected option.
- The scenario must match the proposal baseline.
- If the plan has advanced since the proposal was created, the proposal is stale and cannot be approved or revalidated.
- Approving a mutating option creates a new plan version inside a transaction.
- Sibling proposals computed against the old baseline are marked stale.
- Every action writes a decision audit entry.
- Plan mutation also writes a project audit event.

---

## 8. Evidence and honesty contract

The product makes a narrow claim:

> A model may propose, but it may not silently change the plan.

Evidence is always labelled:

- **observed** — directly present in the ticket or plan;
- **inferred** — reasoned from available context;
- **unknown** — explicitly missing.

The system does not invent:

- deadlines the user did not supply;
- capacity the user did not state;
- an approval;
- a plan version;
- a final priority when policy rules raise it;
- duplicate certainty from lexical similarity alone.

When Meta is unavailable:

- the fallback is explicitly labelled;
- the model label becomes `miraiwerk-rules-v1`;
- the UI shows a notice;
- the backend records a degraded AI call;
- the response is never presented as a Meta model result.

---

## 9. Evaluation results

Latest generated benchmark: `aiml/evaluations/report.md`

**Mode:** deterministic demo rules (`miraiwerk-rules-v1`)  
**Cases:** 40  
**Average latency:** 1.4 ms

| Metric | Result |
| --- | ---: |
| Overall weighted score | **99.5%** |
| Ticket-type accuracy | 100.0% |
| Policy-priority accuracy | 97.5% |
| Recommendation accuracy | 100.0% |
| Evidence discipline | 100.0% |
| Proposal completeness | 100.0% |
| Duplicate-probe accuracy | 92.5% |
| Duplicate precision | 71.4% |
| Duplicate recall | 83.3% |
| Duplicate F1 | 76.9% |
| Cases passing every check | 36 / 40 |

Weights:

- Ticket type: 20%
- Priority: 20%
- Recommendation: 30%
- Evidence discipline: 15%
- Proposal completeness: 15%

Duplicate detection is reported separately because most expected labels are negatives.

### Known mismatches

- `BUG-02`
- `BUG-09`
- `BUG-10`
- `FEAT-02`

### Important interpretation

The benchmark labels describe intended product behaviour. A high deterministic score shows that the fallback is calibrated to the benchmark. It is **not** evidence that a Meta model performs well. To measure the model path, configure `MODEL_API_KEY` and run:

```bash
npm run evaluate -w @miraiwerk/aiml -- --provider=meta
```

---

## 10. Verification log

Commands run against the current tree:

```bash
npm install
npm run build
npm run typecheck
npm test
npm run evaluate
npm run db:reset
```

Results:

- Build: passed.
- Typecheck: passed across frontend, backend, aiml, schemas, and RippleMap.
- Tests: **18 / 18 passed**.
- Evaluation: **99.5%** overall.
- Database reset: schema recreated and seeded cleanly.
- API health: `{"status":"ok","ai":"deterministic-demo"}`.
- Frontend HTTP: `200`.
- Current seed: `prj_3d9d16d8313746f580cb`, plan v2, 19 tasks, 4 pending decisions.
- Database container: `miraiwerk-db`, healthy.

No automated browser-clicking suite was available in this environment, so UI verification was limited to production build, typecheck, and HTTP checks.

---

## 11. Environment and configuration

### Database

```env
DATABASE_URL=postgres://miraiwerk:miraiwerk_dev_pw@localhost:55434/miraiwerk
```

Docker Compose:

- service: `db`
- container: `miraiwerk-db`
- image: `postgres:16-alpine`
- host port: `55434`
- volume: `miraiwerk_pgdata`

### AI configuration

```env
MODEL_API_KEY=
META_BASE_URL=https://api.meta.ai/v1
META_MODEL=muse-spark-1.3
META_TIMEOUT_MS=45000
META_MAX_RETRIES=2
META_TOOLS=true
AI_FALLBACK_ON_ERROR=true
```

`MODEL_API_KEY` is server-only. It must never be exposed through `VITE_*` variables.

### Frontend configuration

```env
VITE_API_BASE_URL=http://localhost:4000/api
```

### Secrets

- Only `.env.example` is committed.
- `.env` and `.env.local` are gitignored.
- The Meta key stays in the backend/AIML process.
- No secret is stored in PostgreSQL or returned to the browser.

---

## 12. Known limitations

These are deliberate current boundaries, not hidden failures:

1. **Demo authentication**
   - `x-user-id` is not production authentication.
   - No password, OAuth, SSO, session expiry, or refresh flow.

2. **Deterministic mode is active**
   - No Meta key is configured in this environment.
   - The current evaluation measures the fallback, not Meta model quality.

3. **Synthetic benchmark**
   - The 40 cases are hand-labelled and useful for regression, but they are not a production traffic sample.

4. **No browser automation**
   - No Playwright or Cypress suite exists.
   - UI is covered by build, typecheck, and HTTP smoke checks.

5. **Single-node synchronous AI path**
   - Model calls run inline with the request.
   - No queue, worker, or background retry infrastructure.

6. **Working-day calendar only**
   - Weekends are skipped.
   - Public holidays and team-specific calendars are not modelled.

7. **Finish-to-start dependencies only**
   - No start-to-start, finish-to-finish, or lag/lead modelling.

8. **No plan editing UI**
   - Plans change through approved proposals, not arbitrary drag-and-drop editing.

9. **No external integrations**
   - No Jira, Linear, GitHub, Slack, email, or calendar ingestion.

10. **No attachments or comments**
    - Ticket evidence is text-based.

11. **No production deployment artifacts**
    - No Dockerfiles for the applications, reverse-proxy config, TLS, or cloud manifests.

12. **No CI pipeline**
    - No GitHub Actions or equivalent automated verification.

13. **No git repository**
    - The workspace is currently disk-only; version control has not been initialized.

14. **Legacy archive remains on disk**
    - `.archive/legacy-spmt/` preserves the previous project.
    - It is excluded from the active build and gitignored.
    - It can be deleted when no longer needed.

15. **Local demo seed is destructive**
    - `npm run db:reset` truncates and recreates the demo data.

---

## 13. Deferred scope

The following were intentionally not built yet:

- code editor or coding agent;
- virtual meetings;
- universal ticketing ingestion;
- autonomous plan changes;
- complex multi-agent orchestration;
- model fine-tuning;
- real-time collaboration;
- notification delivery;
- billing and subscription management;
- enterprise audit export;
- mobile-native application.

The current focus is the reliability of the decision loop, not breadth of integrations.

---

## 14. Recommended next steps

### Immediate

1. Configure a Meta key and run the benchmark with `--provider=meta`.
2. Compare Meta and deterministic results case by case.
3. Add a Playwright smoke test for the full approve flow.
4. Initialize git and make the first clean commit.
5. Add CI for install, build, typecheck, tests, and evaluation.

### Near term

6. Replace demo identity with real authentication and session handling.
7. Add rate limits and request IDs to the API.
8. Add structured server logs and error reporting.
9. Add production Dockerfiles and a deployment manifest.
10. Add migration checks for destructive schema changes.

### Product

11. Add plan editing with the same evidence and audit guarantees.
12. Add external ticket ingestion adapters.
13. Add holiday calendars and richer dependency types.
14. Expand the benchmark with real anonymised ticket samples.
15. Add change-impact export for stakeholders.

---

## 15. Summary of completed work

MIRAIWERK AI now has:

- a coherent product identity;
- a clean frontend/backend/AIML boundary;
- a working planning and ticket-intelligence loop;
- a deterministic RippleMap engine;
- evidence states instead of invented certainty;
- versioned plans and human approval;
- stale-proposal protection;
- decision and project audit trails;
- role-based permissions;
- a realistic seeded demo;
- a 40-case evaluation harness;
- 18 passing tests;
- verified build, typecheck, API, database, and frontend health.

The next phase is hardening: real authentication, Meta-model evaluation, automated browser coverage, CI, and deployment.
