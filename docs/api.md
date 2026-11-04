# HTTP API

The MIRAIWERK AI backend exposes a JSON-over-HTTP API from `backend/`. It is stateless; PostgreSQL holds every durable record.

- Base URL: `http://localhost:4000/api`
- Content type: `application/json`
- Timestamps: ISO 8601 UTC strings
- IDs: application-generated strings with a prefix (`prj_`, `req_`, `ms_`, `task_`, `tkt_`, `dec_`, `scn_`, `da_`, `audit_`, `pv_`)
- API versioning: none in this build; the contracts live in `packages/schemas`

The frontend imports the same Zod contracts from `@miraiwerk/schemas`, so a shape change breaks typecheck before it becomes a runtime surprise. The backend validates requests with equivalent Pydantic models and returns `VALIDATION_ERROR` with flattened `fieldErrors`/`formErrors`.

## Authentication and roles

Authentication uses a bearer access token plus a rotating refresh token stored in an httpOnly cookie.

```http
Authorization: Bearer <accessToken>
```

Obtain a token from `POST /api/auth/login`, `POST /api/auth/register` or `POST /api/auth/demo`. Access tokens are short-lived; call `POST /api/auth/refresh` to rotate the refresh cookie and receive a new one.

For local demos and integration tests, when `AUTH_ALLOW_DEMO=true`, protected routes also resolve an identity from the `x-user-id` header:

```http
x-user-id: usr_maya
```

If neither credential is present, the API falls back to the seeded demo user (`maya.chen@miraiwerk.demo`). Unknown or suspended users return `401 UNAUTHENTICATED`.

Workspace-scoped routes also require an active workspace:

```http
x-workspace-id: ws_platform
```

Authorization is enforced server-side on every project- and workspace-scoped service call.

### Workspace roles → project roles

| Workspace role | Effective project role | Read | Create/analyse | Simulate | Approve / reject / clarify |
| --- | --- | :---: | :---: | :---: | :---: |
| `owner`, `admin` | `owner` | ✓ | ✓ | ✓ | ✓ |
| `manager` | `pm` | ✓ | ✓ | ✓ | ✓ |
| `member` | `member` | ✓ | ✓ | ✓ | — |
| `viewer` | `viewer` | ✓ | — | — | — |

`GET /api/bootstrap` returns the active user, organizations, workspaces and project summaries. `GET /api/auth/me` returns the authenticated session context.

## Endpoints

### Authentication

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/auth/register` | Create an account, optional organization and first workspace |
| `POST` | `/auth/login` | Email/password sign-in |
| `POST` | `/auth/demo` | Seeded demo sign-in by email |
| `POST` | `/auth/refresh` | Rotate the refresh cookie and issue a new access token |
| `POST` | `/auth/logout` | Revoke the current refresh token |
| `GET` | `/auth/me` | Current user, organizations and workspaces |
| `PATCH` | `/auth/profile` | Update name, title, avatar colour or timezone |
| `GET` | `/auth/sessions` | List active sessions |
| `DELETE` | `/auth/sessions/:id` | Revoke one session |
| `POST` | `/auth/password/forgot` | Issue a password-reset token |
| `POST` | `/auth/password/reset` | Complete a password reset |
| `GET` | `/auth/oauth/status` | Whether Meta OAuth is configured |
| `GET` | `/auth/oauth/meta/start` | Begin Meta OAuth |
| `GET` | `/auth/oauth/meta/callback` | Complete Meta OAuth |

### Decision intelligence

| Method | Path | Purpose | Required project role |
| --- | --- | --- | --- |
| `GET` | `/health` | Liveness + database check | none |
| `GET` | `/bootstrap` | Workspace context, projects, AI mode, counts | any authenticated |
| `GET` | `/ai/status` | Active provider/model label | any authenticated |
| `GET` | `/projects` | Projects visible to the caller | member of the project |
| `POST` | `/projects/generate-plan` | Draft a plan from a brief | any authenticated |
| `POST` | `/projects` | Commit a reviewed draft as plan v1 | any authenticated |
| `GET` | `/projects/:id/plan` | Current plan bundle | any member |
| `GET` | `/projects/:id/tickets` | Ticket queue with latest decision | any member |
| `GET` | `/projects/:id/history` | Plan versions, decision audit, project audit | any member |
| `GET` | `/decisions` | Workspace decision queue (`?status=pending\|all`) | any workspace member |
| `POST` | `/tickets` | Create an intake record | owner, pm, member |
| `GET` | `/tickets/:id` | Ticket, links, latest proposal, audits | any member |
| `POST` | `/tickets/:id/analyze` | Analyse and create a pending proposal | owner, pm, member |
| `GET` | `/decisions/:id` | One proposal, including stored scenarios | any member |
| `POST` | `/decisions/:id/simulate` | Recompute and store one option | owner, pm, member |
| `POST` | `/decisions/:id/approve` | Approve accept/split/defer/duplicate | owner, pm |
| `POST` | `/decisions/:id/reject` | Reject with a reason | owner, pm |
| `POST` | `/decisions/:id/clarify` | Request clarification without approving | owner, pm |

### Delivery platform

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/projects/:id/tasks` | Task board for a project |
| `POST` | `/projects/:id/tasks` | Create a task |
| `PATCH` | `/tasks/:id` | Update a task |
| `POST` | `/projects/:id/dependencies` | Add a task dependency |
| `DELETE` | `/projects/:id/dependencies` | Remove a task dependency |
| `GET` | `/projects/:id/roadmap` | Milestones and scheduled tasks |
| `POST` | `/projects/:id/milestones` | Create a milestone |
| `PATCH` | `/milestones/:id` | Update a milestone |
| `GET` | `/organizations` | Organizations for the caller |
| `POST` | `/organizations` | Create an organization and first workspace |
| `GET` | `/organizations/:id/members` | Organization members |
| `POST` | `/organizations/:id/members` | Add an organization member |
| `PATCH` | `/organizations/:id/members/:userId` | Change an organization role |
| `GET` | `/workspaces` | Workspaces for the caller |
| `POST` | `/workspaces` | Create a workspace |
| `GET` | `/workspaces/:id` | Workspace detail |
| `PATCH` | `/workspaces/:id` | Update a workspace |
| `GET` | `/workspaces/:id/members` | Workspace members |
| `POST` | `/workspaces/:id/members` | Add a workspace member |
| `PATCH` | `/workspaces/:id/members/:userId` | Change a workspace role |
| `DELETE` | `/workspaces/:id/members/:userId` | Remove a workspace member |
| `GET` | `/workspaces/:id/teams` | Teams in a workspace |
| `POST` | `/workspaces/:id/teams` | Create a team |
| `POST` | `/workspaces/:id/teams/:teamId/members` | Add a team member |
| `GET` | `/workspaces/:id/workload` | Per-member task workload |
| `GET` | `/workspaces/:id/audit` | Workspace audit events |
| `POST` | `/workspaces/:id/onboarding` | Complete workspace onboarding |

### Collaboration and AI assists

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/workspaces/:id/documents` | List documents (optional `?projectId=`) |
| `POST` | `/workspaces/:id/documents` | Create a document |
| `PATCH` | `/documents/:id` | Update a document |
| `DELETE` | `/documents/:id` | Delete a document |
| `GET` | `/workspaces/:id/meetings` | List meetings |
| `POST` | `/workspaces/:id/meetings` | Schedule a meeting |
| `PATCH` | `/meetings/:id` | Update a meeting |
| `POST` | `/meetings/:id/summarize` | Generate a summary and action items |
| `POST` | `/meetings/:id/actions` | Convert action items into tasks |
| `GET` | `/workspaces/:id/threads` | List discussion threads |
| `POST` | `/workspaces/:id/threads` | Create a thread |
| `GET` | `/threads/:id` | Thread with replies |
| `POST` | `/threads/:id/replies` | Add a reply |
| `PATCH` | `/threads/:id` | Mark a thread solved/unsolved |
| `POST` | `/ai/documents/draft` | Draft document content |
| `GET` | `/ai/usage` | AI usage grouped by workflow (optional `?workspaceId=`) |

`POST /ai/documents/draft` returns Markdown by default. Send `"docType": "diagram"` to request Mermaid source for a diagram document; the deterministic fallback is labelled and still returns valid Mermaid syntax.


## Error responses

All errors use one envelope:

```json
{
  "error": {
    "code": "STALE_PROPOSAL",
    "message": "The plan moved to version 3 after this proposal was generated. Re-analyse the ticket before approving.",
    "details": null
  }
}
```

| Status | Code | Meaning |
| --- | --- | --- |
| `401` | `UNAUTHENTICATED` | Missing/expired bearer token, no refresh cookie, unknown demo identity, or suspended account |
| `403` | `FORBIDDEN` | Caller is not a member, or lacks the required role |
| `404` | `PROJECT_NOT_FOUND` | Project does not exist |
| `404` | `TICKET_NOT_FOUND` | Ticket does not exist |
| `404` | `DECISION_NOT_FOUND` | Proposal does not exist |
| `409` | `DECISION_NOT_PENDING` | Proposal is approved, rejected, clarified, stale, or superseded |
| `409` | `STALE_PROPOSAL` | Plan advanced past the proposal baseline |
| `409` | `BASELINE_VERSION_MISMATCH` | Simulation request names a baseline other than the proposal's |
| `409` | `SCENARIO_REQUIRED` | No stored scenario exists for the selected option |
| `409` | `SCENARIO_STALE` | Stored scenario hash no longer matches a fresh computation |
| `422` | `VALIDATION_ERROR` | Request body failed Pydantic validation; `details` contains `fieldErrors` and `formErrors` |
| `422` | `INVALID_PLAN` | Draft or committed plan failed graph validation |
| `422` | `SCENARIO_INVALID` | Selected change leaves the graph invalid |
| `422` | `SPLIT_NOT_AVAILABLE` | Proposal has no split option |
| `422` | `USE_CLARIFY_ACTION` | `approve` was called with `clarify` |
| `422` | `NO_DUPLICATE_CANDIDATE` | `duplicate` approval without a candidate on the proposal |
| `422` | `INVALID_PROPOSED_CHANGE` | A stored change references a missing record |
| `422` | `INVALID_PLAN_AFTER_APPROVAL` | Applying the change would break the graph |
| `502` | `MODEL_UNAVAILABLE` | Model call failed with fallback disabled |
| `500` | `INTERNAL_ERROR` | Unexpected server failure |

A `404` for a project the caller cannot see is not returned as `403`; the project summary query is restricted to memberships, and deeper reads check membership explicitly. Treat both as access denied in a client.

---

## Health

### `GET /api/health`

No authentication. Checks the database with `SELECT 1`.

```bash
curl -s http://localhost:4000/api/health
```

```json
{
  "status": "ok",
  "time": "2026-11-02T15:17:39.994Z",
  "ai": "gemini",
  "aiLabel": "Google Gemini · gemini-3.5-flash-lite"
}
```

`ai` is `gemini` or `meta` when that provider is configured, and `deterministic-demo` when no key is present. It is never inferred from a browser value.

---

## Bootstrap and AI status

### `GET /api/bootstrap`

```bash
curl -s http://localhost:4000/api/bootstrap -H 'x-user-id: usr_maya'
```

```json
{
  "users": [
    {
      "id": "usr_maya",
      "name": "Maya Chen",
      "email": "maya.chen@miraiwerk.demo",
      "title": "Director of Product",
      "avatarColor": "#5B6CFF"
    }
  ],
  "projects": [
    {
      "id": "prj_ed864fd907d04f0eb7ee",
      "name": "Commerce Platform Relaunch",
      "goal": "Launch a reliable checkout experience without duplicate charges or broken order state.",
      "startDate": "2026-10-27",
      "targetDate": "2026-12-24",
      "status": "active",
      "currentPlanVersion": 2,
      "role": "owner",
      "memberCount": 4,
      "openTicketCount": 4,
      "pendingDecisionCount": 4,
      "milestoneCount": 3,
      "taskCount": 19,
      "nextMilestone": {
        "id": "ms_...",
        "title": "Foundation usable",
        "targetDate": "2026-11-10",
        "releaseGate": false
      }
    }
  ],
  "aiMode": {
    "provider": "gemini",
    "model": "gemini-3.5-flash-lite",
    "usesGemini": true,
    "usesMeta": false,
    "fallbackEnabled": true,
    "label": "Google Gemini · gemini-3.5-flash-lite"
  },
  "ticketCounts": {
    "open": 4,
    "pendingDecisions": 4,
    "approvedDecisions": 1
  }
}
```

### `GET /api/ai/status`

Returns the `aiMode` object only. Useful for a lightweight provider badge.

---

## Projects

### `GET /api/projects`

Returns projects where the caller is a member, newest activity first.

```json
{ "projects": [ { "id": "prj_...", "name": "Commerce Platform Relaunch", "role": "owner" } ] }
```

### `POST /api/projects/generate-plan`

Builds a draft from a brief. **Nothing is persisted.** Every authenticated user may generate; the project is only created by `POST /api/projects` after review.

Request body (`GeneratePlanInput`):

| Field | Type | Rules |
| --- | --- | --- |
| `name` | string | 2–160 chars |
| `goal` | string | 3–600 chars |
| `description` | string | 10–8000 chars |
| `startDate` | `YYYY-MM-DD` | required |
| `targetDate` | `YYYY-MM-DD \| null` | optional |
| `constraints.team` | string | optional, max 300 |
| `constraints.capacityPersonDays` | number | optional, 1–10000 |
| `constraints.technology` | string | optional, max 1000 |
| `constraints.nonNegotiables` | string | optional, max 2000 |

```bash
curl -s -X POST http://localhost:4000/api/projects/generate-plan \
  -H 'content-type: application/json' \
  -H 'x-user-id: usr_maya' \
  -d '{
    "name": "Merchant onboarding",
    "goal": "Let merchants submit KYC documents without email and manual re-keying.",
    "description": "Self-serve onboarding with document capture, status tracking and a compliance review queue. Four analysts support the process today; no new headcount.",
    "startDate": "2026-11-02",
    "targetDate": null,
    "constraints": {
      "team": "2 backend, 1 frontend, 1 designer",
      "technology": "React, Node.js, PostgreSQL",
      "nonNegotiables": "Every compliance decision needs immutable evidence."
    }
  }'
```

Response (`GeneratedPlan`, HTTP 200):

```json
{
  "draft": {
    "name": "Merchant onboarding",
    "goal": "Let merchants submit KYC documents without email and manual re-keying.",
    "description": "Self-serve onboarding with document capture, status tracking and a compliance review queue.",
    "startDate": "2026-11-02",
    "targetDate": null,
    "requirements": [
      {
        "tempId": "req_1",
        "title": "Capture KYC documents",
        "description": "Merchant can upload the required documents in one guided flow.",
        "acceptanceCriteria": ["All required documents can be uploaded"],
        "source": "explicit",
        "status": "proposed"
      }
    ],
    "milestones": [
      {
        "tempId": "ms_1",
        "title": "Compliance review ready",
        "description": "",
        "targetDate": null,
        "releaseGate": false
      }
    ],
    "tasks": [
      {
        "tempId": "task_1",
        "title": "Build document capture",
        "description": "Upload controls, validation and retry handling.",
        "requirementTempId": "req_1",
        "milestoneTempId": "ms_1",
        "estimateDays": 4,
        "priority": "P1",
        "ownerRole": "Engineering",
        "dependencies": []
      }
    ],
    "assumptions": ["The review queue is staffed by the existing analyst team."],
    "missingInformation": ["Current drop-off rate is not stated."],
    "risks": []
  },
  "provider": "deterministic-demo",
  "model": "miraiwerk-rules-v1",
  "degraded": false,
  "notice": null,
  "latencyMs": 12,
  "usage": null
}
```

`draft.tempId` values are local to the draft. The server replaces them with durable IDs when the project is created.

### `POST /api/projects`

Commits a reviewed `PlanDraft`. The server re-validates the graph and schedules tasks before writing anything. A successful create returns the full `ProjectPlan` with version `1` and writes `plan.created` to the project audit trail.

Request body (`CreateProjectInput`):

```json
{
  "draft": { "...": "the PlanDraft returned by generate-plan, optionally edited" },
  "generation": {
    "provider": "deterministic-demo",
    "model": "miraiwerk-rules-v1",
    "degraded": false
  },
  "constraints": {
    "team": "2 backend, 1 frontend",
    "capacityPersonDays": 120,
    "technology": "React, Node.js, PostgreSQL",
    "nonNegotiables": "No duplicate payment capture.",
    "policy": {
      "criticalResponseHours": 4,
      "highResponseDays": 2,
      "normalResponseDays": 7,
      "requireEvidenceForP0": true,
      "escalationComponents": ["payments", "checkout", "auth"],
      "releaseFreezeDays": 3
    }
  }
}
```

`generation` is metadata for the version summary; it does not change validation. `constraints.policy` is optional and defaults to the values in `ProjectPolicySchema`.

HTTP `201` response: `ProjectPlan`.

The current demo membership bootstrap adds every database user to a new project, assigning `owner` to the creator and demo roles by email. This is a hackathon convenience, not an invitation model.

### `GET /api/projects/:id/plan`

Returns the current working plan and its schedule.

```json
{
  "project": { "id": "prj_...", "currentPlanVersion": 2, "role": "owner" },
  "version": 2,
  "requirements": [
    {
      "id": "req_...",
      "projectId": "prj_...",
      "title": "Capture KYC documents",
      "description": "...",
      "acceptanceCriteria": ["..."],
      "source": "explicit",
      "status": "confirmed"
    }
  ],
  "milestones": [
    {
      "id": "ms_...",
      "title": "Payments release gate",
      "targetDate": "2026-11-17",
      "releaseGate": true,
      "status": "planned",
      "position": 2,
      "description": ""
    }
  ],
  "tasks": [
    {
      "id": "task_...",
      "title": "Build document capture",
      "status": "planned",
      "estimateDays": 4,
      "priority": "P1",
      "ownerRole": "Engineering",
      "plannedStart": "2026-10-28",
      "plannedFinish": "2026-11-02",
      "sourceTicketId": null
    }
  ],
  "dependencies": [
    {
      "predecessorId": "task_...",
      "successorId": "task_...",
      "dependencyType": "finishes_to_start"
    }
  ],
  "members": [
    {
      "userId": "usr_maya",
      "name": "Maya Chen",
      "title": "Director of Product",
      "role": "owner",
      "avatarColor": "#5B6CFF"
    }
  ],
  "constraints": { "team": "...", "capacityPersonDays": 260, "policy": { "...": "..." } },
  "assumptions": ["..."],
  "missingInformation": ["..."],
  "validation": { "valid": true, "errors": [], "warnings": [], "cycle": null }
}
```

`plannedStart` and `plannedFinish` are working-day planning estimates produced by RippleMap. They are not commitments, and they are not invented model dates.

### `GET /api/projects/:id/tickets`

Returns the queue with the latest proposal summary attached.

```json
{
  "tickets": [
    {
      "id": "tkt_810b14ddf518472b812c",
      "projectId": "prj_...",
      "title": "Customers charged twice after checkout retry",
      "ticketType": "incident",
      "status": "analyzed",
      "severityReported": "critical",
      "createdAt": "2026-10-26T15:20:00.000Z",
      "latestDecisionId": "dec_e0923610dc8f4e24a86a",
      "latestDecisionStatus": "pending",
      "latestRecommendation": "split",
      "latestPriority": "P0",
      "missingEvidenceCount": 3
    }
  ]
}
```

`missingEvidenceCount` is the number of recorded unknowns on the latest proposal, not a count of missing attachments.

### `GET /api/projects/:id/history`

Returns plan versions (newest first), decision audit entries (newest first), and up to 100 project audit events.

```json
{
  "versions": [
    {
      "id": "pv_...",
      "projectId": "prj_...",
      "versionNumber": 2,
      "parentVersionId": "pv_...",
      "changeSummary": "Split mitigation approved for ticket tkt_...: ...",
      "approvedBy": "usr_maya",
      "approvedByName": "Maya Chen",
      "createdAt": "2026-10-26T15:22:00.000Z"
    }
  ],
  "decisions": [
    {
      "id": "da_...",
      "decisionId": "dec_...",
      "action": "approved",
      "actorName": "Maya Chen",
      "reason": "Ship containment first, keep the durable fix on the plan.",
      "timestamp": "2026-10-26T15:22:00.000Z",
      "ticketId": "tkt_...",
      "ticketTitle": "Customers charged twice after checkout retry",
      "option": "split"
    }
  ],
  "auditEvents": [
    {
      "id": "audit_...",
      "action": "plan.versioned",
      "entityType": "project",
      "entityId": "prj_...",
      "actorName": "Maya Chen",
      "timestamp": "2026-10-26T15:22:00.000Z",
      "summary": "Plan version 2 created from decision dec_..."
    }
  ]
}
```

`decisions[].option` is the proposal's recommendation, not necessarily the option that was approved. Read `action` and the decision detail for the actual outcome.

---

## Tickets

### `POST /api/tickets`

Creates an intake record with status `new`. It does not analyse it.

Request body (`CreateTicketInput`):

| Field | Type | Rules |
| --- | --- | --- |
| `projectId` | string | required, caller must be owner/pm/member |
| `title` | string | 4–240 chars |
| `description` | string | 10–8000 chars |
| `source` | string | 2–80 chars, default `manual` |
| `ticketType` | enum \| null | `bug`, `incident`, `feature_request`, `technical_debt`, `clarification` |
| `affectedComponent` | string | optional, max 200 |
| `reportedImpact` | string | optional, max 2000 |
| `evidence` | string | optional, max 5000 |
| `reporter` | string | optional; defaults to `source` |
| `environment` | string | optional, max 120 |
| `severityReported` | enum | `critical`, `high`, `medium`, `low`, `unspecified` (default) |

```bash
curl -s -X POST http://localhost:4000/api/tickets \
  -H 'content-type: application/json' \
  -H 'x-user-id: usr_lena' \
  -d '{
    "projectId": "prj_...",
    "title": "Customers charged twice after checkout retry",
    "description": "Production incident: the payment confirmation request times out and the client retries. Some customers receive two captures for one order.",
    "source": "manual",
    "ticketType": "incident",
    "affectedComponent": "Payments / checkout retry",
    "reportedImpact": "14 customers charged twice; support has refunded 6.",
    "evidence": "Transactions pi_8841 and pi_8842 share idempotency key idem_5521 and produced two capture.succeeded webhooks.",
    "environment": "production",
    "severityReported": "critical"
  }'
```

HTTP `201` response: `TicketDetail` with `proposal: null` and no audits.

### `GET /api/tickets/:id`

Returns the ticket, its inferred links, the latest proposal (if any), and decision audit entries in chronological order.

```json
{
  "ticket": {
    "id": "tkt_...",
    "projectId": "prj_...",
    "title": "...",
    "description": "...",
    "ticketType": "incident",
    "status": "analyzed",
    "createdAt": "2026-10-26T15:20:00.000Z",
    "analyzedAt": "2026-10-26T15:20:03.000Z"
  },
  "links": [
    {
      "id": "link_...",
      "ticketId": "tkt_...",
      "entityType": "task",
      "entityId": "task_...",
      "entityLabel": "Harden payment retries",
      "relationshipType": "relates_to",
      "evidenceState": "inferred",
      "rationale": "The ticket names the payment retry path.",
      "confirmed": false
    }
  ],
  "proposal": { "...": "DecisionProposal, or null" },
  "audits": [
    {
      "id": "da_...",
      "decisionId": "dec_...",
      "actorId": "usr_maya",
      "actorName": "Maya Chen",
      "action": "approved",
      "reason": "...",
      "beforeJson": { "...": "..." },
      "afterJson": { "...": "..." },
      "timestamp": "2026-10-26T15:22:00.000Z"
    }
  ]
}
```

### `POST /api/tickets/:id/analyze`

Runs classification, evidence extraction, duplicate probing, policy adjustment, and scenario pre-computation against the **current** plan version. It supersedes any pending proposal for the same ticket and creates a new one.

```bash
curl -s -X POST http://localhost:4000/api/tickets/tkt_.../analyze \
  -H 'x-user-id: usr_maya'
```

Response: `TicketDetail` with the new proposal.

The proposal contains:

| Field | Notes |
| --- | --- |
| `basePlanVersion` | Plan version this proposal was computed against |
| `recommendation` | `accept`, `split`, `defer`, `duplicate`, or `clarify` |
| `classification` | Type, policy-adjusted priority, urgency, summary, impact |
| `policy` | Model priority vs final priority, rules applied, response window |
| `evidence[]` | Claim, `observed`/`inferred`/`unknown`, source, excerpt |
| `unknowns[]` | Facts the system did not establish |
| `clarifyingQuestions[]` | Questions to ask when the intake is unusable |
| `relatedRecords[]` | Advisory links to requirements, tasks, milestones, tickets |
| `duplicateCandidates[]` | Advisory lexical candidates, never automatic merges |
| `proposedChanges.accept` | Change applied if `accept` is approved |
| `proposedChanges.split` | Change applied if `split` is approved, or `null` |
| `modelProvider` | `meta` or `deterministic-demo` |
| `modelName` | Configured model or `miraiwerk-rules-v1` |
| `modelMeta` | `degraded`, latency, notice, tool names |
| `scenarioRuns[]` | Stored deterministic scenarios per option |

If the model is configured and fails with `AI_FALLBACK_ON_ERROR=true`, the proposal is created from deterministic rules with `modelMeta.degraded: true` and a notice. If fallback is disabled, the ticket is retained as `analysis_failed` and the request returns `502 MODEL_UNAVAILABLE`.

Pre-computation is not approval. The approval path still requires a stored scenario for the chosen option whose hash matches a fresh computation.

---

## Decisions

### `GET /api/decisions/:id`

Returns one `DecisionProposal`. Use this when you have a decision ID from the queue or bootstrap rather than a ticket ID.

### `POST /api/decisions/:id/simulate`

Recomputes one option against the current plan, stores a new `scenario_run`, and returns the `ScenarioResult`.

Request body:

```json
{ "option": "split", "baselineVersion": 2 }
```

`baselineVersion` is optional. When supplied, it must equal the proposal's `basePlanVersion`; otherwise the API returns `409 BASELINE_VERSION_MISMATCH`.

```bash
curl -s -X POST http://localhost:4000/api/decisions/dec_.../simulate \
  -H 'content-type: application/json' \
  -H 'x-user-id: usr_maya' \
  -d '{"option":"split","baselineVersion":2}'
```

Response highlights:

```json
{
  "option": "split",
  "label": "Split into containment and durable fix",
  "valid": true,
  "validationErrors": [],
  "validationWarnings": [],
  "diff": {
    "addedTasks": [
      {
        "id": "task_...",
        "title": "Contain duplicate payment capture",
        "milestoneId": "ms_...",
        "estimateDays": 1,
        "plannedStart": "2026-10-27",
        "plannedFinish": "2026-10-27"
      }
    ],
    "changedTasks": [],
    "removedTasks": [],
    "addedDependencies": [],
    "milestoneDeltas": [
      {
        "milestoneId": "ms_...",
        "title": "Payments release gate",
        "targetDate": "2026-11-17",
        "baselineDate": "2026-11-12",
        "simulatedDate": "2026-11-16",
        "deltaDays": 2,
        "targetDeltaDays": 0,
        "releaseGate": true,
        "breached": false
      }
    ],
    "criticalPathTaskIds": ["task_..."],
    "targetMilestoneId": "ms_...",
    "targetDeltaDays": 2
  },
  "metrics": {
    "tasksAdded": 3,
    "tasksChanged": 0,
    "tasksRemoved": 0,
    "dependenciesAdded": 2,
    "effortAddedDays": 6,
    "scheduleDeltaDays": 2,
    "milestonesShifted": 1,
    "milestonesBreached": 0,
    "affectedTaskCount": 4,
    "totalEffortDays": 148
  },
  "tasks": [],
  "milestones": [],
  "affectedTaskIds": [],
  "affectedMilestoneIds": [],
  "policyFindings": [],
  "assumptions": [],
  "capacity": {
    "statedCapacityPersonDays": 260,
    "scheduledEffortDays": 148,
    "utilizationPercent": 56.9,
    "note": "Capacity is derived from the stated person-days in the brief."
  },
  "inputHash": "b2c9a4f7d1e8c305",
  "computedAt": "2026-10-26T15:24:00.000Z"
}
```

Simulation is deterministic for the same graph, change, related-task set, and target milestone. `inputHash` fingerprints those inputs.

Errors:

- `404 DECISION_NOT_FOUND`
- `403 FORBIDDEN` for viewers
- `409 DECISION_NOT_PENDING` for stale, approved, rejected, clarified, or superseded proposals
- `409 BASELINE_VERSION_MISMATCH`
- `409 STALE_PROPOSAL` when the project version advanced; the proposal is marked stale in the same transaction

### `POST /api/decisions/:id/approve`

Request body:

```json
{
  "option": "split",
  "reason": "Ship containment today and keep the durable fix on the release plan."
}
```

- `option`: `accept`, `split`, `defer`, or `duplicate`
- `reason`: string, max 1000, default empty

`clarify` is rejected here; use `/clarify`.

Approval is transactional and requires **all** of the following:

1. Caller role is `owner` or `pm`.
2. Proposal status is `pending`.
3. Project `current_plan_version` equals the proposal's `basePlanVersion`.
4. A stored scenario exists for the requested option.
5. That scenario is valid.
6. Its `input_hash` equals a fresh deterministic computation against the current plan.

The option semantics:

| Option | Plan mutation | New version | Ticket status |
| --- | --- | --- | --- |
| `accept` | Applies the accept change | Yes | `accepted` |
| `split` | Applies the split change | Yes | `accepted` |
| `defer` | None | No | `deferred` |
| `duplicate` | None | No | `duplicate` |

Accept and split apply task additions/updates/removals and dependencies, re-schedule the graph, reject an invalid result, write a full plan snapshot as the next version, mark every other pending proposal in the project as `stale`, and write both a decision audit and project audit events (`decision.approved`, plus `plan.versioned` when a version was created).

Response (`DecisionOutcome`):

```json
{
  "proposal": { "...": "refreshed DecisionProposal" },
  "scenario": { "...": "ScenarioResult for the approved option" },
  "planVersionNumber": 3,
  "audit": {
    "id": "da_...",
    "decisionId": "dec_...",
    "actorId": "usr_maya",
    "actorName": "Maya Chen",
    "action": "approved",
    "reason": "Ship containment today and keep the durable fix on the release plan.",
    "beforeJson": { "status": "pending", "basePlanVersion": 2, "recommendation": "split" },
    "afterJson": { "status": "approved", "option": "split", "planVersionNumber": 3 },
    "timestamp": "2026-10-26T15:24:00.000Z"
  },
  "message": "Decision approved as \"split\". Plan version 3 now contains the approved change."
}
```

For `defer` and `duplicate`, `planVersionNumber` is `null` and the message states that the plan is unchanged.

### `POST /api/decisions/:id/reject`

```json
{ "reason": "The reported impact is not reproducible; close until a concrete example exists." }
```

`reason` is required (3–1000 chars). Rejection closes a pending proposal, sets the ticket to `rejected`, writes a decision audit and `decision.rejected` project event, and never changes the plan. Response: `DecisionOutcome` with `scenario: null` and `planVersionNumber: null`.

### `POST /api/decisions/:id/clarify`

```json
{
  "reason": "The report has no reproducible example or affected order.",
  "questions": [
    "Which browser and device showed the issue?",
    "What was the expected result versus the observed result?"
  ]
}
```

Sets the proposal to `clarified`, merges the supplied questions with any existing clarifying questions, sets the ticket to `needs_clarification`, and records the decision without touching the plan.

---

## End-to-end example

This assumes the demo seed exists and `jq` is installed. IDs change after every seed.

```bash
API=http://localhost:4000/api
MAYA=usr_maya

PROJECT_ID=$(curl -s "$API/bootstrap" -H "x-user-id: $MAYA" | jq -r '.projects[0].id')

INCIDENT_ID=$(curl -s "$API/projects/$PROJECT_ID/tickets" -H "x-user-id: $MAYA" \
  | jq -r '.tickets[] | select(.title | startswith("Customers charged twice")) | .id')

PROPOSAL_ID=$(curl -s "$API/projects/$PROJECT_ID/tickets" -H "x-user-id: $MAYA" \
  | jq -r '.tickets[] | select(.id == "'"$INCIDENT_ID"'") | .latestDecisionId')

# Inspect the recommendation and evidence.
curl -s "$API/decisions/$PROPOSAL_ID" -H "x-user-id: $MAYA" | jq '{
  recommendation,
  priority: .classification.priority,
  unknownCount: (.unknowns | length),
  options: [.scenarioRuns[].option] | unique
}'

# Recompute the split scenario and store it.
curl -s -X POST "$API/decisions/$PROPOSAL_ID/simulate" \
  -H 'content-type: application/json' \
  -H "x-user-id: $MAYA" \
  -d '{"option":"split","baselineVersion":2}' \
  | jq '{valid, inputHash, metrics, targetDeltaDays: .diff.targetDeltaDays}'

# Approve as Maya. The plan advances to version 3.
curl -s -X POST "$API/decisions/$PROPOSAL_ID/approve" \
  -H 'content-type: application/json' \
  -H "x-user-id: $MAYA" \
  -d '{"option":"split","reason":"Contain the duplicate captures before the payments gate."}' \
  | jq '{planVersionNumber, message, status: .proposal.status}'
```

The remaining pending decisions become `stale` because they were computed against version 2. Re-analyse their tickets to create fresh proposals against version 3.
