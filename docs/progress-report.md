# MIRAIWERK AI — Progress Report

**Report date:** 4 November 2026  
**Status:** Python backend rebuild complete; end-to-end demo working; production hardening and deferred integrations remain  
**Repository:** `/home/aathi/Documents/HACKATHON/META_AI_HACKATHON_2026`  
**Product:** MIRAIWERK AI  
**Tagline:** The intelligence engine for projects that move forward.

> This report replaces the October 2026 Node/Express snapshot. The backend it described was rebuilt in Python during November 2026. Django 6 owns the schema, migrations, ORM and admin; FastAPI owns the HTTP API on the same `/api` contract; `backend/ripplemap` and `backend/aiml` are Python ports of the original TypeScript packages. The original TypeScript backend remains available in git history (`b612471`), but it is not part of the running build.

---

## 1. Executive summary

MIRAIWERK AI is an AI-native project delivery platform built around one question: **if this ticket or decision moves, what else moves with it?**

The product combines a multi-tenant delivery workspace with **RippleMap**, a deterministic change-impact engine, and evidence-labelled AI analysis. A model may propose; only an authorized human can approve a plan change.

**Current state (4 November 2026):**

- The complete product loop works end to end: brief → generated plan → ticket intake → AI analysis → RippleMap simulation → human decision → versioned plan and audit trail.
- The React frontend covers every primary route: overview, projects, task board, roadmap, teams, plan generator, tickets, RippleMap, history, documentation and diagrams, meetings, discussions, code-workspace boundary, organization, roles, audit, settings and onboarding.
- Documentation now has a **Markdown authoring workbench** with `Write / Preview / Split` tabs and a sanitised GFM renderer, plus a responsive **Mermaid diagram workbench** with live rendering and inline syntax errors.
- The backend is a single ASGI application: FastAPI for `/api`, Django admin for `/admin`, Django ORM for persistence, PostgreSQL 16 for data.
- The deterministic fallback is explicitly labelled `deterministic-demo` / `miraiwerk-rules-v1`; it is never presented as a model result.

### Verified snapshot

| Check | Command | Result |
| --- | --- | --- |
| Backend tests | `npm run test:backend` | **45 passed** |
| Frontend unit/component tests | `npm run test:frontend` | **11 passed** (4 files) |
| End-to-end browser journeys | `npm run test:e2e` | **15 passed** (8 specs) |
| TypeScript typecheck | `npm run typecheck` | **Passing** |
| Production build | `npm run build` | **Passing** |
| API health | `GET /api/health` | `{"status":"ok","ai":"gemini",...}` |

### Recent change history

| Commit | Change |
| --- | --- |
| `313d141` | Rebuilt the backend on Django 6 + FastAPI, preserving the `/api` contract. |
| `8acd4f0` | Added standalone `run-backend.sh` and `run-frontend.sh` launchers. |
| `55affdd` | Rendered Mermaid diagrams live in documentation. |
| `cb9be53` | Made Mermaid previews responsive and fixed diagram-label truncation. |
| `2311197` | Introduced the contained split-pane Mermaid workbench. |
| _working tree_ | Markdown `Write / Preview / Split` preview, sanitisation, tests, E2E coverage and this report. |

---

## 2. The core loop

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

---

## 3. Architecture as built

```text
frontend/ (React 18 + TypeScript + Vite)
   │  JSON + bearer token / demo identity
   ▼
backend/ (one ASGI process on port 4000)
   ├── /api    FastAPI — HTTP API, Pydantic validation, JWT auth
   ├── /admin  Django admin — staff-only operator console
   ├── platform_app  Django models, migrations, ORM, admin, seed command
   ├── api/          routers + request schemas
   ├── services/     business logic and authorization
   ├── aiml/         Gemini provider, deterministic rules, policy, schemas
   └── ripplemap/    deterministic scheduling and scenario simulation
   ▼
PostgreSQL 16 (container `miraiwerk-db`, host port 55434)
```

### Boundaries

- **Django owns the schema.** All 29 models, three migrations, ORM access, admin registrations and demo seeding live in `backend/platform_app`.
- **FastAPI owns HTTP.** Routers parse and validate requests, resolve the caller and return contract-shaped JSON. Business rules live in `backend/services`, not in route handlers.
- **AIML and RippleMap are pure libraries.** They have no knowledge of Django, FastAPI or PostgreSQL. The dependency direction is one-way: `frontend → api → services → aiml/ripplemap`.
- **One deployment unit.** The app is a modular monolith, not a distributed system. There is no service mesh, message broker or second database.
- **The browser never receives a model key.** Provider keys are server-side environment variables; `VITE_*` variables are limited to the API base URL.
- **Authorization is server-side.** Hiding a navigation item is never the control; every workspace, project and decision route re-resolves the effective role.

### Runtime surfaces

| Surface | URL |
| --- | --- |
| Frontend | <http://localhost:5173> |
| API | <http://localhost:4000/api> |
| Health | <http://localhost:4000/api/health> |
| Django admin | <http://localhost:4000/admin> |

The frontend and backend are started independently with `./run-backend.sh` and `./run-frontend.sh`; both are currently running.

---

## 4. Backend — completed work

### 4.1 Platform foundation

- Django 6.1 project with PostgreSQL via `DATABASE_URL` (defaults to the Docker container on port 55434).
- 29 models covering identity, tenancy, delivery, decision intelligence, AI telemetry and collaboration.
- Three migrations, including database defaults and the plan-version parent relationship.
- 29 Django admin registrations with list displays, filters, search fields and raw-ID widgets.
- Management commands:
  - `seed_demo` — resets and recreates the curated demo scenario through the same service layer as the API.
  - `create_admin` — creates or promotes a Django staff user.
- ASGI composition in `backend/miraiwerk/asgi.py`: `/api` and `/admin` served by one process, WhiteNoise for admin static files.
- FastAPI middleware for CORS, security headers (`X-Content-Type-Options`, `Referrer-Policy`) and Django connection cleanup after each request.
- Consistent error envelope, validation-error handling and `GET /api/health`.
- 75 HTTP endpoints across 10 routers (74 domain endpoints plus health).

### 4.2 Authentication and session security

- Email/password registration and login, demo-identity login and logout.
- Argon2id password hashing (memory cost 19 MiB, time cost 2, parallelism 1); legacy scrypt hashes from the Express service still verify.
- Password policy: minimum 10 characters, at least one letter and one number.
- Short-lived JWT access tokens (15 minutes by default) and opaque refresh tokens (30 days).
- Rotating refresh tokens stored as hashes; refresh-token reuse revokes the entire session family and writes a security-audit event.
- Refresh token in an httpOnly, SameSite=Lax cookie; `COOKIE_SECURE` is configurable for HTTPS deployments.
- Session listing and revocation from the settings page.
- Password-reset tokens are one-time, hashed at rest and expiry-bound. In development the raw token is returned as `devToken`; **production email delivery is not wired yet** (see §8).
- Optional Meta OAuth start/callback flow with state validation and account linking.
- Profile editing: name, title and avatar colour.
- Security audit records registration, login, demo login, logout, refresh reuse, password changes, role changes and member changes, with IP/user-agent metadata.

### 4.3 Multi-tenancy and role-based access

- Organizations → workspaces → teams → members, with separate organization and workspace membership.
- Five workspace roles: `owner`, `admin`, `manager`, `member`, `viewer`.
- Effective workspace role is the higher of explicit workspace membership and inherited organization membership.
- Workspace roles map onto project roles:

  | Workspace role | Project role |
  | --- | --- |
  | `owner` / `admin` | `owner` |
  | `manager` | `pm` (approval authority) |
  | `member` | `member` |
  | `viewer` | `viewer` |

- Project approval is restricted to project `owner`/`pm`; members can create and analyse, viewers are read-only.
- Organization and workspace administration: create, update, invite, change role, remove member.
- Workspace settings, team creation, team membership, workload aggregation, audit listing and onboarding.
- Stale or cross-tenant record references in model output are discarded and reported as warnings.

### 4.4 Decision intelligence

#### Plan generation

- Project brief intake with name, goal, description, start/target dates and constraints (team, capacity, technology, non-negotiables, release policy).
- Gemini structured-output generation with bounded retries, timeouts and Pydantic validation.
- Deterministic planning templates for commerce and generic projects when no provider is configured.
- Graph validation before a plan can be committed: unique task IDs, known dependency endpoints, no self-dependencies, no cycles, positive estimates.
- Explicit vs. inferred requirements; assumptions, missing information and risks surfaced in the review UI.
- No project is created until the user reviews and confirms the draft.
- Plan version 1 and an audit event are written at project creation.

#### Ticket intake and analysis

- Ticket types: incident, bug, feature request, technical debt, vague report.
- Three evidence states: `observed`, `inferred`, `unknown`.
- Analysis contract: classification, urgency, impacts, related records, evidence excerpts, unknowns, clarifying questions, duplicate candidates, recommended option and rationale, accept/split proposal.
- Deterministic rule analyser for repeatable demos and tests; Gemini analyser for model output.
- Policy layer applied after classification: escalation components, production-incident rules, severity, P0 evidence requirements, non-defect P0 rejection and response-window labels.
- Duplicate candidates are proposals, never automatic merges.
- Prompt-injection handling: ticket text is treated as untrusted data; unknown record IDs are sanitised out.

#### RippleMap simulation

- Pure-Python graph validation, working-day scheduling, cycle detection with a readable cycle path and topological ordering.
- Deterministic scenario computation for accept, split, defer, duplicate and clarify options.
- Outputs: input hash, validation state, plan diff, before/after milestone dates, critical path, effort and schedule metrics.
- Scenario runs persisted with their input hash so approval can revalidate them.
- RippleMap output verified against the original TypeScript engine by unit tests.

#### Decision and versioning guarantees

- Approval requires a stored scenario matching the selected option and the proposal's baseline plan version.
- If the plan advances after a proposal is computed, sibling proposals are marked stale and approval returns `409`.
- Only workspace `owner`/`admin`/`manager` (project `owner`/`pm`) may approve; member and viewer attempts return `403`.
- Accept/split create a new immutable plan snapshot and a `plan.versioned` audit event.
- Reject, defer, duplicate and clarify record the outcome without changing the plan.
- Decision audit and project audit events are append-only; plan versions are never edited in place.

### 4.5 Delivery platform

- Project list and creation, project plan retrieval, project tickets and project history.
- Task board: list by project, create, edit status/assignee/priority/effort, board columns and permission-aware actions.
- Task dependencies: add and remove, validated against the current plan graph.
- Milestones: create and edit target dates and status.
- Roadmap endpoint with scheduled tasks and milestone dates.
- Workspace workload aggregation by assignee.
- Teams and team membership.
- Bulk project seed with five tickets: one approved decision (plan version 2) and four pending decisions covering an incident, a feature request, a vague report and a duplicate-looking ticket with a different root cause.

### 4.6 Collaboration

- **Documents** — list/create/update/delete workspace or project documents; Markdown and diagram document types; draft/review/published status.
- **Meetings** — schedule, edit, attach to a project, record notes, change status.
- **Meeting AI** — summarise notes into a structured summary and convert action items into tasks.
- **Discussions** — create threads, categories (`general`, `decision`, `question`, `risk`), replies, solved state and project association.
- **Audit** — workspace security events and project audit events, with search, outcome filter and CSV export in the UI.

### 4.7 AI layer and trust labelling

- Gemini adapter using the structured-output `generateContent` endpoint.
- Optional Meta Model API configuration is surfaced honestly, but **the Python build does not ship a Meta adapter**: selecting Meta falls back to labelled deterministic rules and says so.
- Deterministic fallback identifiers:
  - `provider: "deterministic-demo"`
  - `model: "miraiwerk-rules-v1"`
- When a configured model call fails and `AI_FALLBACK_ON_ERROR=true`, the result is marked `degraded` with a notice; it is never presented as successful model output.
- AI calls recorded in `ai_calls` with workflow, provider, model, latency, success, degraded flag, error and usage JSON.
- AI status endpoint exposes provider, model, configured flags and fallback state without exposing keys.
- Workspace AI usage totals are shown on the settings and code-workspace pages.
- The original 40-case labelled evaluation harness has **not yet been ported** to the Python rules; its data and report remain in git history under `aiml/evaluations/` (see §8).

### 4.8 API surface

| Router | Prefix | Endpoints | Covers |
| --- | --- | --- | --- |
| `health` | `/api/health` | 1 | Liveness, provider label, timestamp |
| `auth` | `/api/auth` | 14 | Register, login, demo, refresh, logout, me, profile, sessions, forgot/reset, OAuth status/start/callback |
| `bootstrap` | `/api/bootstrap` | 1 | Session bootstrap: user, organizations, workspaces, projects |
| `projects` | `/api/projects` | 6 | List, generate plan, create, plan, tickets, history |
| `tickets` | `/api/tickets` | 3 | Create, get, analyse |
| `decisions` | `/api/decisions` | 6 | List, get, simulate, approve, reject, clarify |
| `tasks` | `/api` | 8 | Project tasks, task update, dependencies, roadmap, milestones |
| `collab` | `/api` | 14 | Documents, meetings, meeting AI, threads and replies |
| `organizations` | `/api/organizations` | 5 | List/create, members, member role updates |
| `workspaces` | `/api/workspaces` | 14 | List/create, detail/update, members, teams, workload, audit, onboarding |
| `ai` | `/api/ai` | 3 | Status, document draft, usage |

All endpoints are documented with request/response examples in [`docs/api.md`](api.md).

### 4.9 Data model

**Identity and tenancy:** `User`, `Session`, `OAuthAccount`, `OneTimeToken`, `SecurityAudit`, `Organization`, `OrganizationMember`, `Workspace`, `WorkspaceMember`, `Team`, `TeamMember`.

**Delivery:** `Project`, `ProjectMember`, `PlanVersion`, `Requirement`, `Milestone`, `Task`, `TaskDependency`, `AuditEvent`.

**Decision intelligence:** `Ticket`, `TicketLink`, `DecisionProposal`, `ScenarioRun`, `DecisionAudit`, `AiCall`.

**Collaboration:** `Document`, `Meeting`, `ForumThread`, `ForumReply`.

Key properties:

- Application-generated text IDs (`prj_`, `req_`, `task_`, `tkt_`, `dec_`, `scn_`, `audit_`) keep seeded and API-created records identical in shape.
- `plan_versions.snapshot_json` stores a complete reconstructable plan bundle.
- `scenario_runs.input_hash` is the approval guard against stale or mismatched simulations.
- `decision_audit` records before/after state; `audit_events` is the project-level timeline.
- Tasks carry `source_ticket_id`, so approved work remains traceable to the intake record.

### 4.10 Operations

- `run-backend.sh` applies migrations, collects admin static files and starts Uvicorn on `:4000`.
- `run-frontend.sh` builds shared packages and starts Vite on `:5173` with the `/api` proxy.
- `npm run db:up`, `db:migrate`, `db:seed`, `db:reset`, `admin` cover local operations.
- `seed_demo` is deterministic by default; `--ai` opts into the configured provider.
- Staff users can use the same credentials for the Django admin.

---

## 5. Frontend — completed work

### 5.1 Shell and design system

- Responsive `AppShell` with grouped navigation (Workspace, Change intelligence, Collaboration, Administration), workspace switcher, breadcrumbs, project/module search and a keyboard-accessible mobile navigation.
- Role-aware navigation; pages still rely on API authorization rather than hidden links.
- Shared UI primitives: buttons, cards, fields, inputs, selects, textareas, badges, alerts, modals, tabs, tooltips, avatars, stat cards, progress bars, empty/error/loading states.
- Tailwind design tokens for canvas, surface, ink, line, primary, sage, warning and danger.
- Consistent relative/absolute date formatting, role labels and status tones.

### 5.2 Routes

| Route | Page |
| --- | --- |
| `/login`, `/register`, `/auth/callback` | Authentication and OAuth callback |
| `/onboarding` | Workspace activation |
| `/` | Overview: project health, decisions, milestones, workload |
| `/projects` | Projects |
| `/projects/:projectId` | Project workspace: overview, board, list, roadmap, dependencies, history |
| `/tasks` | Task board |
| `/roadmap` | Milestones and schedule |
| `/teams` | Teams and workload |
| `/ai/plan` | AI plan generator with review-before-commit |
| `/tickets`, `/tickets/new`, `/tickets/:ticketId` | Ticket inbox, intake, detail and proposal |
| `/ripplemap`, `/ripplemap/:decisionId` | Decision queue and simulation/approval |
| `/history` | Plan versions, decisions and audit |
| `/docs` | Markdown notes and Mermaid diagrams |
| `/meetings` | Meetings, summaries and action items |
| `/discussions` | Discussion threads |
| `/code` | Code-workspace boundary (deferred integration) |
| `/organization`, `/roles`, `/audit`, `/settings` | Administration |

### 5.3 Decision workflow UI

- **Plan generator** — brief form, generated draft, requirement/assumption/unknown review, editable milestones/tasks and explicit provider provenance.
- **Ticket inbox and detail** — filters, intake form, ticket signal, evidence ledger, unknowns, duplicate candidates, proposal options, decision audit and model provenance.
- **RippleMap** — decision queue, search/project filter, option selection, impact summary, milestone deltas, plan diff, critical path and approval action with clear permission/error states.
- **History** — plan versions, decision outcomes and project audit events.
- **Project workspace** — plan progress, task board, list view, roadmap, dependencies and history tabs.

### 5.4 Delivery and collaboration UI

- Overview with active projects, pending decisions, open tickets, blocked/overdue counts, health, upcoming milestones, needs-attention queue and workload.
- Projects, task board with permission-aware columns, roadmap and team/workload views.
- Documentation library grouped into notes and diagrams, with create/edit/save/delete, status, AI draft, dirty-state confirmation and conflict-aware save errors.
- Meetings with scheduling, notes, AI summary, action-item conversion and status changes.
- Discussions with category/solved filters, search, thread creation, replies and solved state.
- Organization and workspace administration, role matrix and assignments, audit search/export, profile and session settings, AI configuration status.
- Code workspace page that states the integration boundary explicitly instead of showing fake repositories or commits.

### 5.5 Documentation and diagram workbench (newest work)

The documentation page was upgraded using Nirnaya's Markdown editor and diagram workbench as the UX reference, while retaining MIRAIWERK's stronger Mermaid renderer.

**Markdown authoring**

- `Write / Preview / Split` tabs on Markdown documents.
  - **Write** — full-height monospace editor with character count.
  - **Preview** — rendered document with GFM headings, lists, task lists, tables, blockquotes, links, code, images and horizontal rules.
  - **Split** — editor and preview side by side from `lg`, stacked below it.
- Rendering uses `marked` with GFM enabled and `DOMPurify` sanitisation before the HTML reaches the DOM.
- Raw HTML is sanitised; scripts and event handlers are stripped.
- External links open in a new tab with `rel="noreferrer noopener"`.
- Empty documents show a deliberate empty state instead of a blank panel.
- `.prose-mirai` typography styles the rendered output consistently with the application.
- Document tabs reset to `Write` when the selected document changes.

**Mermaid diagrams**

- Diagram documents keep a dedicated side-by-side source/preview workbench from `lg`.
- Both panes use a fixed `60vh` height with internal scrolling, so long diagrams never stretch the page.
- Below `lg`, source and preview stack vertically; the document library moves from a sidebar to a two-column block and only becomes a sidebar at `2xl`.
- Mermaid is lazy-loaded, so the base application bundle does not pay for the renderer.
- Live preview is debounced (300 ms) and race-protected: only the latest request may replace the SVG.
- Theme-aware rendering follows the document palette and re-renders when the theme changes.
- Parse/render failures are surfaced inline; the previous successful diagram is discarded rather than misrepresenting the current source.
- Empty source has a dedicated empty state; rendering state exposes `aria-busy`.
- The app's generic `.label` utility was renamed to `.meta-label` (32 usages) because Mermaid's internal SVG `.label` class was truncating diagram text.

**AI assistance**

- `AI draft` generates a document draft through the backend assistant service and inserts it into the editor for review; nothing is saved automatically.
- The provenance/notice makes clear when deterministic rules produced the draft.

**Tests and manual verification**

- `frontend/src/__tests__/markdown-preview.test.tsx` covers GFM rendering, sanitisation and the empty state.
- `e2e/collaboration.spec.ts` exercises Write → Preview → Split → Write before saving.
- `e2e/docs-diagram.spec.ts` renders a diagram live and asserts an inline syntax error.
- Manual checks at 1440 px and 375 px showed no horizontal overflow; the preview and editor remained within the page at both widths.

---

## 6. Verification detail

### 6.1 Backend suite (45 tests)

| File | Tests | Coverage |
| --- | --- | --- |
| `backend/tests/test_ripplemap.py` | 8 | Working-day scheduling, cycle detection, dangling dependencies, deterministic scheduling, accept/defer simulation, input-hash stability |
| `backend/tests/test_api_integration.py` | 13 | Health, project creation, tenant isolation, RBAC, ticket creation/analysis, simulation, approval versioning, stale protection, stored-scenario requirement, defer semantics, validation errors |
| `backend/tests/test_api_surface.py` | 22 | Registration/login/session/password flows, organizations, workspaces, teams, tasks, milestones, dependencies, documents, meetings, discussions, AI assists, reject/clarify outcomes |
| `backend/tests/test_admin.py` | 2 | Staff admin login/registry pages, non-staff denial |

The suites are hermetic: they create their own users/workspaces/projects and clean up through the Django ORM. They require PostgreSQL and applied migrations.

### 6.2 Frontend suite (11 tests)

| File | Tests | Coverage |
| --- | --- | --- |
| `frontend/src/__tests__/format.test.ts` | 3 | Formatting helpers |
| `frontend/src/__tests__/markdown-preview.test.tsx` | 3 | GFM rendering, sanitisation, empty state |
| `frontend/src/__tests__/ui.test.tsx` | 2 | Shared UI primitives |
| `frontend/src/__tests__/mermaid.test.tsx` | 3 | Lazy render success/error, stale-render protection |

### 6.3 End-to-end suite (15 tests, 8 specs)

| Spec | Tests | Journey |
| --- | --- | --- |
| `access.spec.ts` | 4 | Unauthenticated redirect, sign-in destinations, keyboard route into content, unknown-email failure |
| `platform.spec.ts` | 2 | Owner AI status/usage, viewer read-only visibility |
| `tickets.spec.ts` | 1 | Ticket creation and labelled analysis before review |
| `ripplemap.spec.ts` | 1 | Simulate, approve and record an immutable plan version |
| `kanban.spec.ts` | 1 | Permission-aware task board columns |
| `collaboration.spec.ts` | 3 | Document create/edit/preview/delete, discussion reply and solved state, meeting action-item conversion |
| `docs-diagram.spec.ts` | 1 | Live Mermaid render and inline syntax error |
| `responsive-failure.spec.ts` | 2 | Mobile navigation, documentation API failure state |

### 6.4 Manual checks

- Markdown preview and split view at 1440 px and 375 px: no horizontal overflow.
- Editor and preview heights remain bounded at `60vh` in split mode.
- Diagram labels render in full after the `.meta-label` rename.
- Existing user-created document **“Payment Release and Record system”** is preserved in the running database. Do not run `npm run db:seed` unless a destructive reset is intended.

---

## 7. Current demo state

- Backend and frontend are running on ports 4000 and 5173.
- PostgreSQL container `miraiwerk-db` is healthy on port 55434.
- AI status reports Gemini (`gemini-3.5-flash-lite`) as the configured provider; deterministic fallback remains available and labelled.
- Demo identities:

  | User | Email | Workspace role | Can do |
  | --- | --- | --- | --- |
  | Maya Chen | `maya.chen@miraiwerk.demo` | owner | Everything, including approve/reject; staff admin |
  | Arjun Patel | `arjun.patel@miraiwerk.demo` | manager | Everything, including approve/reject |
  | Lena Ortiz | `lena.ortiz@miraiwerk.demo` | member | Create, analyse, simulate; cannot approve |
  | Priya Shah | `priya.shah@miraiwerk.demo` | viewer | Read-only access |

- Demo password: `Miraiwerk!2026`.

---

## 8. What remains to build

The core product is complete enough for a demo. The remaining work is grouped by priority; nothing below is claimed as finished.

### 8.1 Production hardening (highest priority)

| Area | Current state | Remaining work |
| --- | --- | --- |
| Secrets | Development fallback secrets in `JWT_SECRET` / `DJANGO_SECRET_KEY` | Require strong secrets in production; remove fallbacks; use a secret manager |
| Hosts and transport | `ALLOWED_HOSTS=["*"]`, HTTP by default | Restrict hosts, enforce HTTPS, HSTS, secure cookies, trusted proxy configuration |
| Rate limiting | None | Login/refresh/password-reset throttling, account lockout or backoff, per-IP and per-account limits |
| Email | Reset tokens generated; `devToken` returned in development | SMTP/provider transport, reset email template, invitation email, delivery failure handling |
| Observability | Basic logs and `ai_calls` telemetry | Structured request logs, correlation IDs, metrics, tracing, error reporting, health checks that include the database |
| Backups and retention | No automated policy | PostgreSQL backup/restore runbook, retention policy, migration rollback plan |
| Security headers | `nosniff` and `Referrer-Policy` | CSP, HSTS, frame-ancestors, permissions policy |
| CI/CD | Local commands only | Automated typecheck/tests/build/E2E, dependency and container scanning, migration checks |
| Task execution | AI calls run synchronously inside requests | Background jobs/queue for long model calls, retries and progress reporting |
| Audit guarantees | Append-only by convention | Database-level immutability/retention guarantees and exportable legal archive |

### 8.2 Product modules and features still to build

| Module | Current state | Remaining features |
| --- | --- | --- |
| **Notifications** | None | In-app notification centre, email digests, assignment/mention/decision/due-date alerts, read state and preferences |
| **Global search** | Project/module picker only | Full-text search across projects, tasks, tickets, documents, meetings and discussions, with filters and saved searches |
| **Document versioning** | Documents have `createdAt`/`updatedAt` only | Revision history, diff/restore, named versions, comments/mentions, review approvals and an audit of content changes |
| **Document organisation** | Flat workspace list grouped into notes/diagrams | Folders/spaces, tags, pinned/favourites, drag-and-drop ordering, templates |
| **Attachments and export** | Text-only documents/meetings | File attachments, image upload, PDF/Markdown bundle export, import from Markdown/Confluence |
| **Markdown + Mermaid** | Diagram source rendered only for diagram documents | Fenced Mermaid inside Markdown, syntax highlighting for code blocks, heading anchors/table of contents, auto-save |
| **Meetings** | Scheduling, notes, AI summary, action items | Calendar integration, invites, recurrence, transcripts, virtual-meeting links, attendance, action-item due dates/owners |
| **Discussions** | Threads, replies, categories, solved state | Real-time updates, mentions, moderation/reporting, attachments, subscriptions, pinned threads |
| **Reports and analytics** | Portfolio overview and audit export | Delivery/velocity/cycle-time reports, decision lead time, AI quality/cost dashboards, custom date ranges, scheduled exports |
| **Plan and roadmap** | Generated plans, task board, roadmap, dependencies | Drag-and-drop rescheduling, baselines, what-if scenarios beyond RippleMap, capacity-aware planning, calendar export |
| **Code workspace** | Honest deferred boundary page | Repository provider (GitHub App/OAuth), repo scoping, commit/PR linking, webhook verification, secret handling, code-to-task traceability |
| **AI provider coverage** | Gemini + labelled deterministic rules; Meta reported but not implemented | Meta Model API adapter in Python, provider routing policy, per-workspace budgets/quotas, cost caps, prompt/version registry, human feedback capture |
| **AI evaluation** | 40-case labelled data/report in git history only | Port the harness to Python, run it against the deterministic rules, publish regression reports and gate changes on them |
| **Assistant coverage** | Document drafts, meeting summaries, ticket/plan analysis | Project Q&A over plan context, decision explanations, risk detection, suggested next actions |
| **Enterprise administration** | Organization/workspace roles, Django admin | SSO/SAML/OIDC, SCIM provisioning, custom roles, billing/subscription, data residency and retention controls |
| **Platform reach** | Responsive web app | PWA/offline shell, mobile-specific flows, i18n/localisation, accessibility audit (WCAG 2.2 AA), browser support matrix |
| **Integrations** | None | Jira/Linear/GitHub Issues/Slack/Teams connectors, webhook subscriptions, calendar sync |
| **Quality tooling** | Unit, integration and E2E suites | Load/performance tests, visual regression, coverage thresholds, mutation testing, accessibility automation |

### 8.3 Deliberately out of scope

MIRAIWERK is a planning and decision system, not an autonomous engineering platform. This build intentionally does **not** include:

- A code editor with repository write access or a coding agent.
- Virtual meeting hosting or autonomous meeting bots.
- Universal ticketing integrations.
- Autonomous plan changes or approval by a model.
- Complex multi-agent orchestration.
- Billing and subscription management.
- Model fine-tuning.

These remain explicit product boundaries, not hidden gaps. The code-workspace page states the boundary in the UI rather than simulating an integration.

### 8.4 Known limitations

- **Synchronous AI calls.** A slow provider request occupies an HTTP worker; there is no queue or streaming progress.
- **Single-process demo posture.** The ASGI app runs as one Uvicorn process; there is no horizontal-scaling or session-affinity design yet.
- **No production email.** Password reset works only through the development `devToken` path.
- **No document revisions.** Plan versions are immutable, but documents themselves do not yet have revision history.
- **No full-text search.** The shell search covers projects and navigation, not document or ticket content.
- **No file uploads or exports** beyond the audit CSV.
- **Bundle size.** Mermaid's optional diagram engines are lazy-loaded but still large (the ELK chunk is ~1.5 MB before gzip); further code-splitting and an explicit chunk budget are pending.
- **The evaluation benchmark is not running in CI.** The rules are tested through 45 backend tests, but the 40-case labelled benchmark needs porting.
- **The Meta provider is configuration-only.** Selecting it produces a labelled deterministic fallback.
- **No notification or rate-limiting layer.** Security audit records events, but there is no proactive alerting.
- **Migrating production data from the Express schema** has not been rehearsed against a real dataset; the Python schema is verified against the seeded and test scenarios.

---

## 9. Recommended next sequence

1. **Production baseline** — secrets, host allowlist, HTTPS/cookies, CORS, CSP/HSTS, rate limiting and request logging.
2. **Email and notifications** — password reset, invitations, decision/assignment alerts.
3. **Evaluation harness** — port the 40-case benchmark, publish a Python report and wire it into CI.
4. **Document versioning and search** — revisions/diffs, comments, attachments, then full-text search.
5. **Provider and cost controls** — Meta adapter, quotas, budgets and AI usage dashboards.
6. **Repository integration** — GitHub App/OAuth, webhooks and commit/PR-to-task links, behind explicit consent.
7. **Enterprise groundwork** — SSO/SCIM, custom roles, retention and backup automation.
8. **Scale work** — background job queue, streaming AI responses and load testing.

---

## 10. Bottom line

The rebuild is complete and the demo is coherent: the decision loop is deterministic where it must be, the AI is labelled where it is used, and human approval remains the only way a plan changes. The documentation workbench now matches the quality of the rest of the product, with a sanitised Markdown preview and a responsive Mermaid workbench.

What remains is not “finish the app”; it is production hardening, notifications and search, document lifecycle features, provider/evaluation coverage, and the deliberately deferred repository and enterprise integrations.
