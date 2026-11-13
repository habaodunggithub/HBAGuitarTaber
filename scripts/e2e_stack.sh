#!/usr/bin/env bash
# Throwaway full stack for end-to-end tests: API (serving the built SPA) + a real pull worker.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export UV_PROJECT_ENVIRONMENT="${UV_PROJECT_ENVIRONMENT:-$HOME/.cache/taber/venv}"
export TABER_DATA_DIR="$(mktemp -d)"
export TABER_WORKER_TOKEN="e2e-token-$(date +%s)-0123456789"
export TABER_PORT="${E2E_PORT:-8765}"
export TABER_SPA_DIR="$ROOT/apps/web/dist"
export TABER_REAPER_INTERVAL_S=5
cd "$ROOT"
uv run --no-sync taber worker --api "http://127.0.0.1:$TABER_PORT" --poll 0.4 --cache-dir "$TABER_DATA_DIR/worker-cache" \
  --tracker "${E2E_TRACKER:-pyin}" &
WORKER=$!
trap 'kill $WORKER 2>/dev/null || true; rm -rf "$TABER_DATA_DIR"' EXIT INT TERM
uv run --no-sync taber-api
