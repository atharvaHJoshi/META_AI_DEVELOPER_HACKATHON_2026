#!/usr/bin/env bash
# Start the MIRAIWERK backend: Django migrations/static + FastAPI/ASGI on :4000.
# Usage: ./run-backend.sh
# Overrides: API_HOST (0.0.0.0), API_PORT (4000), RELOAD (0)
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

PYTHON="$ROOT_DIR/.venv/bin/python"
if [[ ! -x "$PYTHON" ]]; then
  echo "error: Python virtualenv not found at $ROOT_DIR/.venv" >&2
  echo "create it with:" >&2
  echo "  python3 -m venv .venv && .venv/bin/python -m pip install -r backend/requirements.txt" >&2
  exit 1
fi

HOST="${API_HOST:-0.0.0.0}"
PORT="${API_PORT:-4000}"

echo "==> Applying Django migrations (PostgreSQL must be running: npm run db:up)"
"$PYTHON" backend/manage.py migrate --noinput

echo "==> Collecting Django admin static files"
"$PYTHON" backend/manage.py collectstatic --noinput --verbosity 0 >/dev/null

echo "==> MIRAIWERK API listening on http://${HOST}:${PORT}"
echo "    Health: http://localhost:${PORT}/api/health"
echo "    Admin:  http://localhost:${PORT}/admin"

ARGS=(
  -m uvicorn miraiwerk.asgi:application
  --app-dir "$ROOT_DIR/backend"
  --host "$HOST"
  --port "$PORT"
  --log-level warning
)
if [[ "${RELOAD:-0}" == "1" ]]; then
  ARGS+=(--reload --reload-dir "$ROOT_DIR/backend")
fi

exec "$PYTHON" "${ARGS[@]}"
