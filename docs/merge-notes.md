# Unified Merge: MIRAIWERK AI + Nirnaya SPMT

This repository contains both products merged into one coherent platform rather than two applications behind a proxy. The merge kept MIRAIWERK's decision-intelligence loop as the core and folded the Nirnaya delivery-platform capabilities into the same frontend, backend and shared contracts.

The superseded source trees are preserved on disk under `.archive/` and excluded from the active build. There are no `*-legacy` or `unified-types` directories in the active tree.

## What was integrated

### MIRAIWERK AI (decision intelligence core)
- RippleMap deterministic change-impact simulation.
- AI-native ticket intake, evidence ledger and proposal analysis.
- Plan generation, review and immutable plan versioning.
- Human approval workflow with stale-proposal protection and audit trails.
- Gemini and Meta model adapters with a labelled deterministic fallback.
- 40-case evaluation benchmark.

### Nirnaya SPMT (delivery platform)
- Email/password authentication with Argon2id, JWT access tokens and rotating refresh tokens.
- Optional Meta OAuth, session management, profile and password-reset flows.
- Multi-tenant organizations and workspaces with five workspace roles.
- Teams, workload, task board, task dependencies, milestones and roadmap.
- Documentation records, meetings with AI summaries/action items, and discussion threads.
- Workspace audit events and administration pages.

## Where the code lives

| Concern | Location |
| --- | --- |
| Authentication routes/services | `backend/src/routes/auth.ts`, `backend/src/services/authService.ts`, `backend/src/security/` |
| Organization/workspace/team routes | `backend/src/routes/workspaces.ts`, `backend/src/services/orgService.ts` |
| Tasks, dependencies, roadmap | `backend/src/routes/tasks.ts`, `backend/src/services/taskService.ts` |
| Documents, meetings, discussions | `backend/src/routes/collab.ts`, `backend/src/services/collabService.ts` |
| Plan/ticket/decision intelligence | `backend/src/routes/{projects,tickets,decisions}.ts` and matching services |
| Shared platform contracts | `packages/schemas/src/platform.ts` |
| Platform UI | `frontend/src/pages/` (`OrganizationPage`, `TeamsPage`, `TasksPage`, `RoadmapPage`, `MeetingsPage`, `DiscussionsPage`, `SettingsPage`, `AuditPage`, `CodeWorkspacePage`) |
| MIRAIWERK UI | `frontend/src/pages/` (`AIPlanGeneratorPage`, `TicketsPage`, `TicketDetailPage`, `RippleMapPage`, `ProjectWorkspacePage`, `HistoryPage`) |

## Integration decisions

- **One identity model.** Workspace roles map onto project roles: workspace `owner`/`admin` → project `owner`; workspace `manager` → project `pm`; `member` → `member`; `viewer` → `viewer`. The API resolves this server-side on every project call.
- **One workspace header.** Workspace-scoped endpoints use `x-workspace-id`; authenticated requests use a bearer access token. The development-only `x-user-id` demo identity remains available when `AUTH_ALLOW_DEMO=true`.
- **One schema package.** Platform contracts were added to `packages/schemas/src/platform.ts`; there is no parallel `unified-types` package.
- **One AI layer.** The Nirnaya assistant endpoints reuse the same AIML provider adapters, deterministic rules and telemetry as ticket analysis.
- **One database.** Migration `002_unified_platform.sql` adds organizations, workspaces, teams, sessions, OAuth accounts, documents, meetings and forum tables alongside the original MIRAIWERK tables.

## Verification

The merged tree is verified by `npm run typecheck`, `npm test`, `npm run test:frontend`, `npm run test:e2e`, `npm run build` and `npm run evaluate`. See `docs/progress-report.md` for the current results and known limitations.
