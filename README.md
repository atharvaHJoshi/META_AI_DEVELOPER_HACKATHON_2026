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
- Optional Meta OAuth sign-in, session listing/revocation, password reset, and a seeded demo-login path that production refuses to enable.
- Projects, teams, task board (Kanban), task dependencies, milestones, roadmap and workload views.
- Documentation records, meeting scheduling with AI summaries and action-item conversion, discussion threads with replies and solved state.
- Markdown notes with `Write / Preview / Split` tabs, a sanitised GFM renderer and an empty-state preview; Mermaid diagram records with a responsive split workbench, lazy-loaded live rendering, inline syntax errors and AI-assisted drafts.
- Workspace audit trail, organization management, settings and a read-only code-workspace surface.

### Security and operations
- Production configuration fails closed: strong secrets, explicit hosts and origins, secure cookies, HTTPS redirect, HSTS and a real email backend are required before the API starts.
- PostgreSQL-backed fixed-window rate limits for login (per account and IP), registration, password reset, refresh and AI workflows, with `429` and `retryAfter` responses.
- Request correlation IDs on every API response and structured security audit records linked to the request.
- CSP, HSTS, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` and `Permissions-Policy` headers.
- PostgreSQL triggers make the security, project and decision audit tables append-only; the Django admin exposes them read-only.
- Database-checking health endpoint and synchronous AI quotas per user and workspace.

### Notifications and email
- Workspace-scoped notification centre with unread/all tabs, mark-read, mark-all-read, pagination and deep links.
- Backend events create notifications for task assignment, ticket intake, decision proposals/outcomes, meeting scheduling, discussion @mentions and approaching milestones.
- Per-category preferences across eight categories with independent in-app and email switches; security notifications cannot be disabled.
- SMTP/SES-compatible transactional email for password reset, invitations, task assignment, decision outcomes, meeting invitations and generic alerts, with a delivery log.
- `notify_reminders` creates idempotent due-soon, overdue and milestone reminders for cron or a future scheduler.

### AI and trust
- Google Gemini adapter by default, using JSON-schema structured responses, bounded retries, timeouts and read-only tools.
- A labelled deterministic mode (`miraiwerk-rules-v1`) whenever no provider key is configured; it is never presented as a model result.
- Explicit `degraded` labelling when a configured model call fails and fallback is enabled.
- A 40-case labelled evaluation benchmark with generated reports. The data and report are preserved in git history from the TypeScript AIML package; porting the harness to the Python rules is tracked in the progress report.

## Stack

| Layer | Choice |
| --- | --- |
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, React Router, Mermaid |
| Backend | Python 3.12+, Django 6 (ORM, migrations, admin) + FastAPI, Pydantic |
| AIML | `backend/aiml` — Gemini + labelled deterministic rules + policy (Meta provider is configuration-only in the Python build) |
| Data | PostgreSQL 16 |
| Shared contracts | `packages/schemas` (Zod runtime contracts for the frontend) |
| Simulation | `backend/ripplemap` (dependency scheduling and RippleMap scenario diffing) |
| AI | Gemini by default, labelled deterministic fallback; Meta selection degrades safely |
| Security | Django email/auth primitives, PostgreSQL rate limits and append-only audit triggers |
| Tests | pytest, TestClient, Vitest, Playwright |
| Local infrastructure | Docker Compose (`miraiwerk-db` on port **55434**) |

## Architecture

```text
frontend/ ─────────────────────────────┐
  React pages, RippleMap, platform UI  │  JSON over HTTP
                                       ▼
backend/ (ASGI app on port 4000)
  ├─ /api        FastAPI — HTTP API, Pydantic validation, JWT auth
  ├─ /admin      Django admin — staff-only operator console
  ├─ platform_app Django models, migrations, ORM, admin registrations
  ├─ api/        routers, request validation, request IDs and security headers
  ├─ services/   business logic, authorization, rate limits, email and notifications
  ├─ ripplemap/  deterministic graph scheduler and scenario simulator
  ├─ aiml/       Gemini provider, deterministic rules, policy, schemas
  └─ manage.py   migrate, seed_demo, create_admin, notify_reminders
                                       │
                                       ▼
                                 PostgreSQL
```

The backend is a modular monolith: one deployable ASGI app serving both the API and the Django admin, with explicit service boundaries and no distributed-system theatre. The AIML layer stays a pure library: it never opens a database connection and never exposes a secret to the browser. Django owns the schema, migrations, ORM and admin; FastAPI owns the HTTP surface.

## Repository layout

```text
.
├── frontend/                 React workspace, RippleMap, delivery and collaboration UI
├── backend/                  Python backend — Django (ORM/admin/migrations) + FastAPI API
│   ├── platform_app/         models, admin, password hashing, `seed_demo`, `notify_reminders`
│   ├── api/                  FastAPI app, routers, Pydantic validation, security middleware
│   ├── services/             business logic, rate limits, email and notifications
│   ├── ripplemap/            deterministic scheduler and scenario simulator
│   ├── aiml/                 Gemini provider, deterministic rules, policy
│   ├── miraiwerk/            ASGI composition (FastAPI + Django admin)
│   └── tests/                pytest: RippleMap, API, security/notifications and Django admin tests
├── packages/
│   └── schemas/              Shared Zod contracts and TypeScript types (frontend)
├── e2e/                      Playwright browser journeys
├── docs/                     Architecture, API, setup, evidence contract, progress report
├── run-backend.sh            Start Django + FastAPI (migrations, static, :4000)
├── run-frontend.sh           Start the Vite dev server (:5173)
├── docker-compose.yml        PostgreSQL 16 on host port 55434
└── .env.example              Safe configuration template (no secrets)
```

## Quick start

### Prerequisites

- Docker (or a PostgreSQL 16 instance)
- **Python 3.12+** with `venv`
- Node.js **20+** and npm 10+ (for the frontend)

### 1. Install

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.txt
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
npm run db:migrate   # Django migrations
npm run db:seed      # curated demo scenario (deterministic rules; --ai to use a provider)
```

### 4. Run the app

Run each script in its own terminal:

```bash
./run-backend.sh    # Django + FastAPI on :4000
./run-frontend.sh   # Vite dev server on :5173
```

Or start both together with `npm run dev`.

- Frontend: <http://localhost:5173>
- API: <http://localhost:4000/api> (health: <http://localhost:4000/api/health>)
- Django admin: <http://localhost:4000/admin> (staff users only; run `npm run admin` to create or promote one)

Sign in with any seeded identity — the login page lists them and pre-fills the demo password. The seed also marks Maya as staff, so the Django admin at `/admin` signs in with the same credentials.

### Demo identities

| User | Email | Workspace role | Can do |
| --- | --- | --- | --- |
| Maya Chen | `maya.chen@miraiwerk.demo` | owner | Everything, including approve/reject |
| Arjun Patel | `arjun.patel@miraiwerk.demo` | manager | Everything, including approve/reject |
| Lena Ortiz | `lena.ortiz@miraiwerk.demo` | member | Create, analyse, simulate; cannot approve |
| Priya Shah | `priya.shah@miraiwerk.demo` | viewer | Read-only access |

Demo password for all seeded accounts: `Miraiwerk!2026`.

The seed creates a commerce relaunch project with five tickets: one approved decision that already produced plan version 2, plus four pending decisions covering an incident, a feature request, a vague report, and a duplicate-looking ticket with a different root cause. It also seeds an organization, two workspaces, a team, documents, a meeting and discussion threads.

## Production configuration

`APP_ENV=production` makes the API validate its configuration before serving traffic. It refuses to start when:

- `JWT_SECRET` or `DJANGO_SECRET_KEY` is missing, a documented development default, or shorter than 32 characters.
- `ALLOWED_HOSTS` is missing or contains a wildcard.
- No `FRONTEND_ORIGINS`/`WEB_ORIGIN` is configured for CORS.
- `COOKIE_SECURE` or `SECURE_SSL_REDIRECT` is disabled.
- `EMAIL_BACKEND` is Django's console backend.
- `AUTH_ALLOW_DEMO` is enabled.

A minimal production environment looks like:

```dotenv
APP_ENV=production
DJANGO_SECRET_KEY=<64+ random characters>
JWT_SECRET=<64+ random characters>
ALLOWED_HOSTS=app.example.com
FRONTEND_ORIGINS=https://app.example.com
CSRF_TRUSTED_ORIGINS=https://app.example.com
COOKIE_SECURE=true
SECURE_SSL_REDIRECT=true
SECURE_HSTS_SECONDS=31536000
TRUST_X_FORWARDED_PROTO=true
AUTH_ALLOW_DEMO=false

EMAIL_BACKEND=django.core.mail.backends.smtp.EmailBackend
EMAIL_HOST=smtp.example.com
EMAIL_PORT=587
EMAIL_HOST_USER=...
EMAIL_HOST_PASSWORD=...
EMAIL_USE_TLS=true
DEFAULT_FROM_EMAIL=MIRAIWERK AI <no-reply@example.com>
```

Development defaults to Django's console email backend, so reset messages print to the API log and the forgot-password response includes `devToken`. Production requires a real backend and never returns the token. Rate-limit thresholds are configurable through `RATE_LIMIT_*` variables; see `backend/core/config.py` for the full list.

`python manage.py notify_reminders` should run daily from cron or a scheduler. It is idempotent per day through notification dedupe keys.

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
| `/forgot-password`, `/reset-password` | Password recovery |
| `/settings` | Profile, notification preferences, sessions and AI status |
| `/organization`, `/roles`, `/audit` | Workspace administration |

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Run backend and frontend together |
| `npm run dev:backend` | Run only the API (uvicorn, port 4000) |
| `npm run dev:frontend` | Run only the web app |
| `npm run build` | Build schemas and frontend |
| `npm test` | Run the backend pytest suite and frontend tests |
| `npm run test:backend` | Run the pytest integration + unit suite |
| `npm run test:frontend` | Run frontend component/unit tests |
| `npm run test:e2e` | Run the Playwright browser journeys |
| `npm run db:up` | Start the PostgreSQL container |
| `npm run db:down` | Stop the container (data volume is preserved) |
| `npm run db:migrate` | Apply pending Django migrations |
| `npm run db:seed` | Reset demo data and recreate the curated scenario |
| `npm run db:reset` | Drop the volume, re-migrate and re-seed |
| `npm run admin` | Create a Django staff user for `/admin` |

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

### Meta Model API (optional — not shipped in the Python build)

```dotenv
AI_PROVIDER=meta
MODEL_API_KEY=...
META_BASE_URL=https://api.meta.ai/v1
META_MODEL=muse-spark-1.3
META_TIMEOUT_MS=45000
META_MAX_RETRIES=2
```

The Python backend ships the **Gemini** provider. If `AI_PROVIDER=meta` is selected, or Gemini is not configured, MIRAIWERK uses its labelled deterministic rules — the proposal says so in `modelProvider` and a `degraded`/`notice` when applicable; Meta is never claimed as output.

Set these on the server only. The Gemini provider calls the structured-output generateContent endpoint with bounded retries and timeouts; if a configured model call fails and `AI_FALLBACK_ON_ERROR=true`, the proposal is explicitly marked `degraded`; it is never presented as a successful model result.

The browser never receives the key. `VITE_*` variables are public by definition and are limited to the API base URL.


## Evidence and decision guarantees

- **No invented deadlines.** Milestone dates come from the brief or the planning rules and are labelled planning estimates. Capacity is never fabricated.
- **Three evidence states.** Every claim is `observed`, `inferred` or `unknown`. Links to requirements, tasks and milestones are inferred until a human confirms scope.
- **Deterministic simulation.** RippleMap applies the proposed graph change in code and returns an input hash, validation state, plan diff, milestone deltas, critical path and metrics.
- **Stored scenarios.** Approval requires a matching stored scenario for the selected option and the proposal's baseline version.
- **Stale protection.** If the plan advances after a proposal is computed, siblings are marked stale and approval returns `409`. Re-analyse the ticket to regenerate the decision.
- **Human approval.** Only `owner` and `pm` (workspace `owner`/`admin`/`manager`) may approve. Member/viewer attempts return `403`.
- **Versioned outcomes.** Accept/split create a new plan snapshot and `plan.versioned` audit. Defer/duplicate/clarify preserve the plan and record the decision outcome.
- **Append-only history.** Decision and project audit events are exposed through the history page and API, and PostgreSQL triggers reject updates or deletes on all audit tables.

Read the full contract in [`docs/evidence-contract.md`](docs/evidence-contract.md).

## Tests

```bash
npm test                 # backend pytest suite + frontend tests (needs PostgreSQL for backend)
npm run test:backend     # RippleMap unit tests + API integration tests
npm run test:frontend    # frontend unit/component tests
npm run test:e2e         # Playwright journeys (starts its own dev servers)
```

- `backend/ripplemap`: scheduling, cycle detection, scenario validity, milestone deltas, critical path, deterministic hashing — verified against the original TypeScript engine output.
- `backend` (55 tests): isolated PostgreSQL integration tests for project creation, ticket analysis, simulation, approval versioning, stale rejection, scenario requirements, defer semantics, RBAC and validation errors; security tests cover production config, shared rate limits, append-only audit triggers, email delivery, notifications and preferences.
- `frontend` (14 tests): formatting helpers, shared UI primitives, the Markdown preview renderer, Mermaid rendering and password-recovery forms.
- `e2e` (15 journeys plus one authenticated setup): sign-in/access, viewer permissions, RippleMap approval, ticket intake and analysis, Kanban, documentation, discussions, meetings, responsive navigation and API failure states.

The backend integration suite requires the database container and Django migrations to be running. Use `RATE_LIMIT_ENABLED=false` when running the suite repeatedly against one database so login attempts do not trip the production limits.

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
- [`backend/README.md`](backend/README.md) — the Django + FastAPI backend layout and operations
- [`backend/pytest.ini`](backend/pytest.ini) — pytest entry for the backend suite
