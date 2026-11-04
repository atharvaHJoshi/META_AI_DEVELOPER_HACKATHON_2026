#!/usr/bin/env bash
# Start the MIRAIWERK frontend (Vite) on :5173, proxying /api to the backend.
# Usage: ./run-frontend.sh
# Overrides: FRONTEND_HOST (0.0.0.0), FRONTEND_PORT (5173)
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

if [[ ! -d "$ROOT_DIR/node_modules" ]]; then
  echo "error: node_modules is missing" >&2
  echo "install dependencies with: npm install" >&2
  exit 1
fi

HOST="${FRONTEND_HOST:-0.0.0.0}"
PORT="${FRONTEND_PORT:-5173}"

echo "==> Building shared workspace packages"
npm run build:deps --silent

echo "==> MIRAIWERK frontend listening on http://${HOST}:${PORT}"
echo "    App: http://localhost:${PORT}"
echo "    API proxy: /api -> http://localhost:4000/api"

exec npm run dev -w @miraiwerk/frontend -- --host "$HOST" --port "$PORT" --strictPort
