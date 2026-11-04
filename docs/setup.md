# Local setup

This guide takes a clean checkout to a running MIRAIWERK demo.

## 1. Prerequisites

- **Python 3.12+** (`python3 --version`) with `venv`
- Node.js **20 or newer** (`node --version`) and npm 10+ (frontend only)
- Docker Engine with Compose v2
- Free ports:
  - **55434** for PostgreSQL
  - **4000** for the API (and Django admin)
  - **5173** for the Vite dev server

The database deliberately uses port `55434` on the host to avoid colliding with other local PostgreSQL containers.

## 2. Install dependencies

From the repository root:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.txt
npm install
```

The Python backend lives under `backend/` (Django + FastAPI). `uv`-style installs work just as well if you prefer them — it only ever reads `.venv` via relative paths in the npm scripts. `npm install` covers the frontend and `packages/schemas`.

## 3. Configure the environment

```bash
cp .env.example .env
cp .env.example backend/.env
```

Why both?

- The backend loads the first available of `backend/.env` and the root `.env`.
- Vite and the Playwright config read the root `.env`.

Neither file is committed. `.gitignore` excludes `.env` and `.env.local`.

The demo works with the defaults. AI keys are optional:

```dotenv
# Leave empty for labelled deterministic mode.
GEMINI_API_KEY=
MODEL_API_KEY=
```

Before deploying anywhere, replace the placeholder `JWT_SECRET` and set a distinct `DJANGO_SECRET_KEY`:

```bash
openssl rand -hex 32
```

> Never put a Gemini or Meta key in a `VITE_*` variable or in frontend code. Keys are read only by the API process.

Development defaults to Django's console email backend, so password-reset and notification emails print to the API log and the forgot-password response includes a `devToken`. Configure `EMAIL_*` in both env files to send real mail; see §11.

## 4. Start PostgreSQL

```bash
npm run db:up
```

This starts the `miraiwerk-db` container from `docker-compose.yml` using the `postgres:16-alpine` image and a named volume.

Verify it is healthy:

```bash
docker ps --filter name=miraiwerk-db
```

Or check directly:

```bash
docker exec miraiwerk-db pg_isready -U miraiwerk -d miraiwerk
```

## 5. Apply migrations

```bash
npm run db:migrate
```

Migrations are Django migrations in `backend/platform_app/migrations/`: the initial schema, database defaults, the `parent_version_id` relationship, `0004_security_notifications` (rate limits, notifications, preferences, email delivery, audit request IDs) and `0005_append_only_audit` (PostgreSQL triggers). Apply them with `python manage.py migrate`; create new ones with `python manage.py makemigrations` after editing `platform_app/models.py`.

The append-only triggers block `UPDATE` and `DELETE` on `security_audit`, `audit_events` and `decision_audit`. Test cleanup and destructive local reseeds opt out for the current database session with `SELECT set_config('miraiwerk.audit_maintenance', 'on', false);`. Production jobs must never set that flag.

## 6. Seed the demo

```bash
npm run db:seed
```

This resets the product tables and creates:

- 4 demo users: Maya (owner, staff), Arjun (manager), Lena (member), Priya (viewer)
- 1 organization and 2 workspaces
- a seeded team, project members and workspace members
- 1 commerce relaunch project at plan version 2 (plan v2 is the deterministic seed output)
- 5 tickets: one approved decision, four pending decisions
- documents, a meeting, discussion threads and workspace audit history
- scenario runs and AI-call telemetry

The seed is deterministic apart from generated IDs and timestamps. It uses labelled deterministic rules by default — no network calls, finishes in seconds. Pass `--ai` (`python backend/manage.py seed_demo --ai`) to run analysis through the configured AI provider instead.

To rebuild everything from scratch:

```bash
npm run db:reset
```

That drops the volume, re-runs migrations and re-seeds in one command. It is destructive.

## 7. Run the app

```bash
npm run dev
```

This runs the backend and frontend dev servers together with `concurrently`.

| Service | URL |
| --- | --- |
| Frontend | <http://localhost:5173> |
| API | <http://localhost:4000/api> |
| Health | <http://localhost:4000/api/health> |
| Django admin | <http://localhost:4000/admin> |

The backend dev script runs `collectstatic` before uvicorn, so the Django admin is styled on a clean checkout. If you launch uvicorn directly, run `cd backend && ../.venv/bin/python manage.py collectstatic --noinput` once first.

A healthy response looks like:

```json
{
  "status": "ok",
  "time": "2026-11-02T15:17:39.994Z",
  "ai": "gemini",
  "aiLabel": "Google Gemini · gemini-3.5-flash-lite"
}
```

The `ai` value is `gemini` when the Gemini provider is configured and `deterministic-demo` when no provider key is present. Selecting `AI_PROVIDER=meta` also yields the labelled deterministic fallback in this build, because the Meta adapter is not implemented in Python.

## 8. Sign in

Open <http://localhost:5173>. The login page lists the seeded identities and pre-fills the demo password.

| User | Email | Workspace role |
| --- | --- | --- |
| Maya Chen | `maya.chen@miraiwerk.demo` | owner |
| Arjun Patel | `arjun.patel@miraiwerk.demo` | manager |
| Lena Ortiz | `lena.ortiz@miraiwerk.demo` | member |
| Priya Shah | `priya.shah@miraiwerk.demo` | viewer |

Demo password: `Miraiwerk!2026`.

Sessions use a short-lived bearer access token plus a rotating refresh token in an httpOnly cookie. The API also accepts `x-user-id` directly when `AUTH_ALLOW_DEMO=true`, which is useful for scripted demos and integration tests.

## 9. Verify the installation

```bash
RATE_LIMIT_ENABLED=false npm run test:backend
npm run test:frontend
npm run test:e2e
npm run build
```

The backend pytest suite needs PostgreSQL running and migrated. It creates its own users and project, then deletes both. `RATE_LIMIT_ENABLED=false` keeps repeated local runs from exhausting the login window; the dedicated security tests exercise the limiter directly with monkeypatched settings. The normal backend test count is **55** and the frontend count is **14**. The E2E suite starts its own backend and frontend on the standard ports; stop `npm run dev` first if it is still running.

The full E2E run is **16 tests** (15 journeys plus one authenticated setup). Playwright signs in once and reuses `storageState`; unauthenticated access tests explicitly opt out. The RippleMap journey creates its own ticket and pending decision through the API, so it does not depend on leftover seed state.

Playwright uses `/opt/google/chrome/chrome` by default. Override it with `PLAYWRIGHT_CHROMIUM_PATH` if Chrome lives elsewhere.

## 10. Optional: enable an AI provider

### Gemini (default)

Add a server-side key to `backend/.env` and the root `.env`:

```dotenv
AI_PROVIDER=gemini
GEMINI_API_KEY=your-key
GEMINI_MODEL=gemini-3.5-flash-lite
GEMINI_BASE_URL=https://generativelanguage.googleapis.com/v1beta
GEMINI_TIMEOUT_MS=45000
GEMINI_MAX_RETRIES=3
AI_FALLBACK_ON_ERROR=true
```

### Meta Model API (optional — not shipped in the Python build)

```dotenv
AI_PROVIDER=meta
MODEL_API_KEY=your-key
META_BASE_URL=https://api.meta.ai/v1
META_MODEL=muse-spark-1.3
META_TIMEOUT_MS=45000
META_MAX_RETRIES=2
AI_FALLBACK_ON_ERROR=true
```

The Python backend ships the **Gemini** provider. If `AI_PROVIDER=meta` is selected, or Gemini is not configured, MIRAIWERK responds with labelled deterministic rules and records `degraded`/`notice` accordingly. Meta is never claimed as output.

Restart the API process, then check:

```bash
curl -s http://localhost:4000/api/health
```

The `ai` field should report `gemini` when a Gemini key is configured and `deterministic-demo` otherwise. Selecting `AI_PROVIDER=meta` produces the labelled deterministic fallback; Meta is never claimed as output. New plan drafts and ticket proposals will record the matching provider and model name.

If the model call fails:

- With `AI_FALLBACK_ON_ERROR=true`, the response uses deterministic rules and is marked `degraded` with a notice.
- With `AI_FALLBACK_ON_ERROR=false`, analysis fails visibly; the ticket is retained with `analysis_failed` and no proposal.

## 11. Production configuration

Set `APP_ENV=production` on the API process. Startup then validates configuration and refuses to boot if any of the following is wrong:

| Requirement | Variable |
| --- | --- |
| Strong, non-default secrets | `JWT_SECRET`, `DJANGO_SECRET_KEY` (32+ chars) |
| Explicit hosts | `ALLOWED_HOSTS` (no `*`) |
| CORS origins | `FRONTEND_ORIGINS` or `WEB_ORIGIN` |
| Secure cookies | `COOKIE_SECURE=true` |
| HTTPS | `SECURE_SSL_REDIRECT=true` |
| Real email backend | `EMAIL_BACKEND` not Django's console backend |
| No demo sign-in | `AUTH_ALLOW_DEMO=false` |

A representative production block:

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

If a reverse proxy terminates TLS, set `TRUST_X_FORWARDED_PROTO=true` and forward `X-Forwarded-Proto`. In production the API also applies trusted-host checks, CSP, HSTS, frame denial, referrer and permissions policies, and returns `x-request-id` on every response.

Rate limits are PostgreSQL-backed fixed windows shared by every API process. Defaults are five failed login attempts per account and thirty per IP per minute, five registrations per IP, three password resets per account, 120 refreshes per IP, and 100 AI calls per user / 500 per workspace per day. Override them with `RATE_LIMIT_*`; a throttled response is `429 RATE_LIMITED` with `retryAfter`.

## 12. Notifications and email

Notifications are created by backend events. The in-app bell and preference switches are available without extra configuration.

To create due-soon, overdue and milestone reminders, run once a day from cron, systemd or a scheduler:

```bash
cd backend && ../.venv/bin/python manage.py notify_reminders
```

The command is idempotent per day through notification dedupe keys, so a retry does not duplicate messages. Notification emails respect each user's category preferences; security notifications are always on. Delivery attempts are recorded in the `email_deliveries` table and can be inspected in the Django admin.

Development without SMTP prints messages to the API log and returns `devToken` from `POST /api/auth/password/forgot`. Production never returns the token.

## Troubleshooting

### `ECONNREFUSED 127.0.0.1:55434`

The database is not running or is bound to a different port.

```bash
npm run db:up
docker ps --filter name=miraiwerk-db
```

If port `55434` is occupied by another service, change the host port in `docker-compose.yml` and update `DATABASE_URL` in both env files.

### `database "miraiwerk" does not exist`

The container may have been created with different credentials. Remove the old volume only if you do not need its data:

```bash
docker compose down -v
npm run db:up
npm run db:migrate
npm run db:seed
```

### API returns `401 UNAUTHENTICATED`

The access token is missing, expired and could not be refreshed, or an `x-user-id` header references a deleted user. There is deliberately no implicit anonymous fallback — sign in again, or use a known demo identity explicitly:

```bash
curl -s http://localhost:4000/api/projects \
  -H 'x-user-id: usr_maya'
```

Without a bearer token or the demo header, the API returns `401 UNAUTHENTICATED`. If the seed has not run, the demo users do not exist.

### Approval returns `403 FORBIDDEN`

Only `owner` and `pm` project roles can approve. Workspace `owner`, `admin` and `manager` map to those roles; members can still create, analyse and simulate. Viewer attempts are rejected.

### Approval returns `409 STALE_PROPOSAL` or `DECISION_NOT_PENDING`

The plan advanced after the proposal was computed. This is intentional. Re-analyse the ticket to generate a new proposal against the current plan version.

### Approval returns `409 SCENARIO_REQUIRED` or `SCENARIO_STALE`

The selected option has no stored scenario or the stored scenario no longer matches the plan. Run the simulation again, then approve.

### `400 WORKSPACE_REQUIRED`

Workspace-scoped endpoints (decisions, documents, meetings, threads, notifications, notification preferences, teams, workload, audit) need an `x-workspace-id` header. The browser sends it automatically after bootstrap; scripted calls must include it.

### `429 RATE_LIMITED`

The endpoint hit a shared PostgreSQL-backed fixed window. The response includes `retryAfter` (seconds) and an `error.details` scope. Wait for the window to reset, or tune `RATE_LIMIT_LOGIN_ACCOUNT`, `RATE_LIMIT_LOGIN_IP`, `RATE_LIMIT_AI_USER_DAILY` and related variables. For repeated local test runs, set `RATE_LIMIT_ENABLED=false`.

### Password-reset email does not arrive

Development uses Django's console backend by default: look for the message in the API log and use `devToken` from the response. To send real mail, set `EMAIL_BACKEND`, `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_HOST_USER`, `EMAIL_HOST_PASSWORD` and `EMAIL_USE_TLS`. Inspect `email_deliveries` for the attempt and error. Production refuses to start with the console backend.

### Notifications are missing

Check the user's notification preferences (security is always on; other categories can be muted), confirm the recipient is a project or workspace member, and remember that `notify_reminders` must be scheduled separately. Dedupe keys suppress repeat events for the same entity and day.

### Web cannot reach the API

Confirm `VITE_API_BASE_URL` points at `http://localhost:4000/api` and that the API is running. Vite only exposes variables prefixed with `VITE_`.

### Model calls time out

Increase `GEMINI_TIMEOUT_MS`, or lower `GEMINI_MAX_RETRIES`. If a configured call fails, `AI_FALLBACK_ON_ERROR=true` serves labelled deterministic rules instead of a 502; there is also `AI_PROVIDER=deterministic` to opt out of network calls entirely.

### E2E browser cannot start

Playwright is configured to use `/opt/google/chrome/chrome`. Install Chrome or set:

```bash
PLAYWRIGHT_CHROMIUM_PATH=/path/to/chrome npm run test:e2e
```

### Port already in use

- API: change `PORT` in both env files.
- Web: run `npm run dev -w @miraiwerk/frontend -- --port 5174`, or update the Vite config.
- Database: change the host side of the Compose port mapping and `DATABASE_URL`.

## Resetting demo data after a walkthrough

```bash
npm run db:reset
```

This restores the seeded plan version 2, five tickets and four pending decisions. It is the fastest way to return to a clean demo state after approving a decision.
