# MIRAIWERK AI

**The intelligence engine for projects that move forward.**

MIRAIWERK AI is an AI-native project delivery platform built around one question: *if this ticket or decision moves, what else moves with it?*

It combines a multi-tenant delivery workspace (organizations, workspaces, teams, tasks, roadmaps, documentation, meetings and discussions) with **RippleMap** — a deterministic change-impact engine — and evidence-labelled AI analysis. A model may propose; only an authorized human can approve a plan change.

> Precise German engineering × Japanese forward thinking × modern English technology.

---

## The core loop

```text
Brief ──► Generated plan ──► Ticket intake ──► AI analysis
                                                    │
                                                    ▼
                              Human approval ◄── RippleMap impact simulation
                                                    │
                                                    ▼
                                      Versioned plan + audit trail
```

1. **Brief** — describe the project, goal, dates and stated constraints.
2. **Draft plan** — generate requirements, milestones, tasks, dependencies, assumptions and missing information.
3. **Ticket intake** — capture an incident, bug, feature request, debt item or vague report.
4. **Analysis** — classify the ticket, separate observed evidence from inferred links, list unknowns and propose accept/split/defer/clarify/duplicate options.
5. **RippleMap** — apply the proposed change to the dependency graph and compute schedule, effort, milestone and critical-path impact in deterministic code.
6. **Decision** — an owner, admin or manager approves, rejects, defers, links a duplicate or requests clarification.
7. **Versioning** — accept/split create a new plan version and decision audit. Defer/duplicate/clarify record the outcome without silently changing the plan.

## What ships

### Decision intelligence
- Plan generator with review-before-commit, explicit assumptions and missing information.
- Ticket intake and analysis with three evidence states (`observed`, `inferred`, `unknown`), unknowns, clarifying questions, duplicate candidates and proposed tasks.
- Deterministic RippleMap simulation for every decision option, including before/after milestone dates, critical path and plan diffs.
- Transactional approvals with stale-proposal detection, stored-scenario revalidation, optimistic plan versioning and append-only audit history.
- Role-based project permissions: `owner`/`pm` approve, `member` creates and analyses, `viewer` is read-only.

### Delivery platform
- Multi-tenant organizations and workspaces with role-based access (`owner`, `admin`, `manager`, `member`, `viewer`).
- Email/password authentication using Argon2id, short-lived JWT access tokens and rotating refresh tokens in an httpOnly cookie.
- Optional Meta OAuth sign-in, session listing/revocation, password reset and a seeded demo-login path.
- Projects, teams, task board (Kanban), task dependencies, milestones, roadmap and workload views.
- Documentation records, meeting scheduling with AI summaries and action-item conversion, discussion threads with replies and solved state.
- Workspace audit trail, organization management, settings and a read-only code-workspace surface.

### AI and trust
- Google Gemini adapter by default, with an optional Meta Model API adapter — both use JSON-schema structured responses, bounded retries, timeouts and read-only tools.
- A labelled deterministic mode (`miraiwerk-rules-v1`) whenever no provider key is configured; it is never presented as a model result.
- Explicit `degraded` labelling when a configured model call fails and fallback is enabled.
- A 40-case labelled evaluation benchmark with generated reports.

## Stack

| Layer | Choice |
| --- | --- |
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, React Router |
| Backend | Node.js 20+, Express, TypeScript, Zod |
| AIML | `aiml/` — Gemini + Meta adapters, prompts, deterministic rules, policy, benchmark |
| Data | PostgreSQL 16 |
| Shared contracts | `packages/schemas` (Zod runtime contracts and inferred types) |
| Simulation | `packages/ripplemap` (dependency scheduling and RippleMap scenario diffing) |
| AI | Gemini by default, Meta Model API optional, labelled deterministic fallback |
| Tests | Vitest, Supertest, Testing Library, Playwright |
| Local infrastructure | Docker Compose (`miraiwerk-db` on port **55434**) |

## Architecture

```text
frontend/ ─────────────────────────────┐
  React pages, RippleMap, platform UI  │  JSON over HTTP
                                       ▼
backend/ ────────────────────────────────────────────────────────────
  routes → services → db / RippleMap / AIML                          │
  ├─ auth: register, login, refresh, sessions, OAuth, demo identity  │
  ├─ platform: organizations, workspaces, teams, tasks, roadmap      │
  ├─ collaboration: documents, meetings, discussions, audit          │
  ├─ projects: brief, plan generation, plan versions                 │
  ├─ tickets: intake, analysis, proposal persistence                 │
  └─ decisions: simulation, approval, rejection, clarification       │
                                       │
                     ┌─────────────────┼─────────────────┐
                     ▼                 ▼                 ▼
              aiml/             packages/ripplemap  packages/schemas
       model + rules + policy    graph scheduling   runtime contracts
                     │                 │                 │
                     └─────────────────┴────────┬────────┘
                                                ▼
                                           PostgreSQL
```

The backend is a modular monolith: one deployable API, explicit service boundaries, no distributed-system theatre. The AIML layer is a pure library package: it never opens a database connection and never exposes a secret to the browser.

## Repository layout

```text
.
├── frontend/                 React workspace, RippleMap, delivery and collaboration UI
├── backend/                  Express API, services, migrations, seed, integration tests
├── aiml/                     AI/ML layer: Gemini + Meta adapters, rules, policy
│   ├── src/
│   ├── scripts/evaluate.ts   Benchmark runner
│   └── evaluations/          40-case labelled benchmark and generated reports
├── packages/
│   ├── schemas/              Shared Zod contracts and TypeScript types
│   └── ripplemap/            Deterministic graph scheduler and impact simulator
├── e2e/                      Playwright browser journeys
├── docs/                     Architecture, API, setup, evidence contract, progress report
├── docker-compose.yml        PostgreSQL 16 on host port 55434
└── .env.example              Safe configuration template (no secrets)
```

## Quick start

### Prerequisites

- Node.js **20+**
- Docker (or a PostgreSQL 16 instance)
- npm 10+

### 1. Install

```bash
npm install
```

### 2. Configure

```bash
cp .env.example .env
cp .env.example backend/.env
```

No secret is required for the demo. Leave `GEMINI_API_KEY` and `MODEL_API_KEY` empty to run in **labelled deterministic mode**. The defaults already point at the Docker database on port `55434`. Generate a real `JWT_SECRET` before deploying anywhere.

### 3. Start PostgreSQL, migrate, and seed

```bash
npm run db:up
npm run db:migrate
npm run db:seed
```

### 4. Run the app

```bash
npm run dev
```

- Frontend: <http://localhost:5173>
- Backend: <http://localhost:4000>
- Health: <http://localhost:4000/api/health>

Sign in with any seeded identity — the login page lists them and pre-fills the demo password.

### Demo identities

| User | Email | Workspace role | Can do |
| --- | --- | --- | --- |
| Maya Chen | `maya.chen@miraiwerk.demo` | owner | Everything, including approve/reject |
| Arjun Patel | `arjun.patel@miraiwerk.demo` | manager | Everything, including approve/reject |
| Lena Ortiz | `lena.ortiz@miraiwerk.demo` | member | Create, analyse, simulate; cannot approve |
| Priya Shah | `priya.shah@miraiwerk.demo` | viewer | Read-only access |

Demo password for all seeded accounts: `Miraiwerk!2026`.

The seed creates a commerce relaunch project with five tickets: one approved decision that already produced plan version 2, plus four pending decisions covering an incident, a feature request, a vague report, and a duplicate-looking ticket with a different root cause. It also seeds an organization, two workspaces, a team, documents, a meeting and discussion threads.

## Main routes

| Route | Page |
| --- | --- |
| `/` | Overview: portfolio, decision queue, AI mode |
| `/projects` | Projects |
| `/projects/:projectId` | Project workspace (plan, board, roadmap, history) |
| `/tasks` | Task board |
| `/roadmap` | Milestones and schedule |
| `/teams` | Teams and workload |
| `/ai/plan` | AI plan generator |
| `/tickets` | Ticket inbox |
| `/tickets/new` | Ticket intake |
| `/tickets/:ticketId` | Ticket detail and decision proposal |
| `/ripplemap`, `/ripplemap/:decisionId` | RippleMap simulation and approval |
| `/history` | Plan versions, decisions and audit |
| `/docs` | In-product decision documentation |
| `/meetings` | Meetings and action items |
| `/discussions` | Discussion threads |
| `/code` | Code workspace surface |
| `/organization`, `/roles`, `/audit`, `/settings` | Workspace administration |

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Run backend and frontend together |
| `npm run dev:backend` | Run only the API |
| `npm run dev:frontend` | Run only the web app |
| `npm run build` | Build schemas, RippleMap, AIML, backend and frontend |
| `npm run typecheck` | Typecheck every workspace |
| `npm test` | Run RippleMap unit tests and backend integration tests |
| `npm run test:frontend` | Run frontend component/unit tests |
| `npm run test:e2e` | Run the Playwright browser journeys |
| `npm run test:all` | Run unit, integration, frontend and E2E suites |
| `npm run evaluate` | Run the 40-case AIML ticket benchmark and regenerate reports |
| `npm run db:up` | Start the PostgreSQL container |
| `npm run db:down` | Stop the container (data volume is preserved) |
| `npm run db:migrate` | Apply pending SQL migrations |
| `npm run db:seed` | Reset demo data and recreate the curated scenario |
| `npm run db:reset` | Drop schema, re-migrate and re-seed in one step |

## AI providers

### Gemini (default)

```dotenv
AI_PROVIDER=gemini
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-3.5-flash-lite
GEMINI_BASE_URL=https://generativelanguage.googleapis.com/v1beta
GEMINI_TIMEOUT_MS=45000
GEMINI_MAX_RETRIES=3
AI_FALLBACK_ON_ERROR=true
```

### Meta Model API (optional)

```dotenv
AI_PROVIDER=meta
MODEL_API_KEY=...
META_BASE_URL=https://api.meta.ai/v1
META_MODEL=muse-spark-1.3
META_TIMEOUT_MS=45000
META_MAX_RETRIES=2
META_TOOLS=true
```

Set these on the server only. The adapter calls an OpenAI-compatible Chat Completions endpoint with JSON-schema response formats. If no key is configured, the API reports `deterministic-demo` and `miraiwerk-rules-v1` in the UI and in proposal metadata. If a configured model call fails and `AI_FALLBACK_ON_ERROR=true`, the proposal is explicitly marked `degraded`; it is never presented as a successful model result.

The browser never receives the key. `VITE_*` variables are public by definition and are limited to the API base URL.

## Evaluation

```bash
npm run evaluate
```

The benchmark measures ticket type, policy priority, recommendation, evidence discipline, proposal completeness and duplicate-candidate behaviour. The current generated report is in [`aiml/evaluations/report.md`](aiml/evaluations/report.md).

To compare against a model path, configure the provider and run:

```bash
npm run evaluate -w @miraiwerk/aiml -- --provider=meta
```

The deterministic score is a calibration check for the fallback rules, **not** evidence of model quality. See [`docs/evidence-contract.md`](docs/evidence-contract.md) for the rules behind the labels.

## Evidence and decision guarantees

- **No invented deadlines.** Milestone dates come from the brief or the planning rules and are labelled planning estimates. Capacity is never fabricated.
- **Three evidence states.** Every claim is `observed`, `inferred` or `unknown`. Links to requirements, tasks and milestones are inferred until a human confirms scope.
- **Deterministic simulation.** RippleMap applies the proposed graph change in code and returns an input hash, validation state, plan diff, milestone deltas, critical path and metrics.
- **Stored scenarios.** Approval requires a matching stored scenario for the selected option and the proposal's baseline version.
- **Stale protection.** If the plan advances after a proposal is computed, siblings are marked stale and approval returns `409`. Re-analyse the ticket to regenerate the decision.
- **Human approval.** Only `owner` and `pm` (workspace `owner`/`admin`/`manager`) may approve. Member/viewer attempts return `403`.
- **Versioned outcomes.** Accept/split create a new plan snapshot and `plan.versioned` audit. Defer/duplicate/clarify preserve the plan and record the decision outcome.
- **Append-only history.** Decision and project audit events are exposed through the history page and API.

Read the full contract in [`docs/evidence-contract.md`](docs/evidence-contract.md).

## Tests

```bash
npm test                 # RippleMap + backend integration (needs PostgreSQL)
npm run test:frontend    # frontend unit/component tests
npm run test:e2e         # Playwright journeys (starts its own dev servers)
```

- `packages/ripplemap`: scheduling, cycle detection, scenario validity, milestone deltas, critical path, deterministic hashing.
- `backend`: isolated PostgreSQL integration tests for project creation, ticket analysis, simulation, approval versioning, stale rejection, scenario requirements, defer semantics, RBAC and validation errors.
- `frontend`: formatting helpers and shared UI primitives.
- `e2e`: sign-in/access, viewer permissions, RippleMap approval, ticket intake and analysis, Kanban, documentation, discussions, meetings, responsive navigation and API failure states.

The backend integration suite requires the database container and migrations to be running.

## Deliberately out of scope

MIRAIWERK is a planning and decision system, not an autonomous engineering platform. This build does **not** include a code editor with repository write access, a coding agent, virtual meetings, universal ticketing integrations, autonomous plan changes, complex multi-agent orchestration, billing, or model fine-tuning. Those are deferred so the core decision loop stays inspectable.

## Documentation

- [`docs/setup.md`](docs/setup.md) — detailed local setup and troubleshooting
- [`docs/architecture.md`](docs/architecture.md) — modules, data model, simulation and approval flow
- [`docs/api.md`](docs/api.md) — HTTP contracts with examples
- [`docs/evidence-contract.md`](docs/evidence-contract.md) — evidence, unknowns, model labelling and approval rules
- [`docs/demo-script.md`](docs/demo-script.md) — a seven-minute walkthrough for judges and reviewers
- [`docs/progress-report.md`](docs/progress-report.md) — current build report and verified state
- [`docs/merge-notes.md`](docs/merge-notes.md) — how the MIRAIWERK and Nirnaya codebases were merged
- [`aiml/evaluations/README.md`](aiml/evaluations/README.md) — benchmark format and interpretation
