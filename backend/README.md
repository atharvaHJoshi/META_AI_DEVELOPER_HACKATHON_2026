# Backend — MIRAIWERK AI

The backend is a single deployable ASGI app on port **4000**.

```text
/api        FastAPI application — the HTTP API the frontend consumes
/admin      Django admin — staff-only operator console
```

```text
manage.py                 Django entry point (migrate, seed_demo, create_admin)
miraiwerk/
  settings.py             Django settings (loads backend/.env then repo root .env)
  asgi.py                 ASGI composition: Django admin + FastAPI in one process
platform_app/             Django app — models, migrations, admin, seed command
  management/commands/seed_demo.py
api/                      FastAPI application
  app.py                  factory, exception handlers (error envelope), middleware
  deps.py                 current-user dependency and workspace header resolution
  schemas.py              Pydantic request models (mirrors the documented contract)
  routers/                one router per resource area
services/                 business logic — plan, tickets, decisions, tasks, collab
  snapshot.py             plan bundle load/persist, snapshots
  authz.py                workspace/organization/project role resolution
ripplemap/                deterministic scheduler and scenario simulator
aiml/                     Gemini provider, deterministic rules, policy
core/                     config, errors, security (JWT/opaque tokens), serialisers
tests/                    pytest: RippleMap, API and Django admin tests
```

Django owns the schema, migrations, ORM and admin. FastAPI owns the HTTP surface. Django emulates `ON DELETE CASCADE` in Python, so FK constraints are `DEFERRABLE INITIALLY DEFERRED` with `NO ACTION` — use the ORM or dependency-ordered SQL, not bare `DELETE`.

## Commands

Run from the repository root:

```bash
npm run dev:backend     # uvicorn miraiwerk.asgi:application (port 4000)
npm run db:migrate      # apply Django migrations
npm run db:seed         # deterministic demo scenario (python manage.py seed_demo --ai for provider)
npm test                # backend pytest suite
npm run admin           # create a Django staff user
```

`manage.py check`, `makemigrations`, `migrate`, `collectstatic` and `seed_demo` all work as usual from `backend/`:

```bash
cd backend && ../.venv/bin/python manage.py seed_demo --ai
```

The integration suite (`backend/tests/test_api_integration.py`) exercises the ASGI app end-to-end against PostgreSQL, creating and deleting its own fixtures. It is not hermetic — it needs the `miraiwerk-db` container (or `DATABASE_URL`) and applied migrations.

## Configuration

The process reads the first available of `backend/.env` and the repository root `.env`. Server-only values: `JWT_SECRET`, `DATABASE_URL`, provider keys (`GEMINI_API_KEY`), Meta OAuth (`META_APP_ID`/`META_APP_SECRET`). The browser only ever sees `VITE_*` variables.

- Without an AI key, or with `AI_PROVIDER=deterministic`, the API reports `deterministic-demo` and never claims a model result.
- With `AI_PROVIDER=gemini`, proposals record the Gemini model name; a configured call that fails degrades to labelled rules (`degraded: true`) when `AI_FALLBACK_ON_ERROR=true`.
- `AI_PROVIDER=meta` is accepted but Meta is not shipped in this build; selection falls back honestly to deterministic rules.

## Admin access

The seeded demo owner is staff: Maya Chen (`maya.chen@miraiwerk.demo` / `Miraiwerk!2026`) signs in at `/admin` with the same product password — no separate admin credential store. For other operators, use `npm run admin` or flag an existing user with `is_staff`.
