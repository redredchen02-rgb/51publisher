#!/usr/bin/env bash
# One-click backend startup with build-freshness check and healthz smoke test.
# Usage: bash scripts/start-backend.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST_JS="$REPO_ROOT/packages/backend/dist/index.js"
SRC_GLOB="$REPO_ROOT/packages/backend/src"
HEALTHZ_URL="http://localhost:3001/api/v1/healthz"

# Rebuild if dist is missing or any src file is newer than the dist entry point.
needs_build() {
  [[ ! -f "$DIST_JS" ]] && return 0
  # find returns output only when a newer source file exists
  [[ -n "$(find "$SRC_GLOB" -name "*.ts" -newer "$DIST_JS" 2>/dev/null)" ]]
}

if needs_build; then
  echo "[start-backend] dist is stale or missing — building…"
  (cd "$REPO_ROOT" && pnpm --filter publisher-backend build)
fi

# Load env from the standard location (mirrors launchd/start-backend.sh logic).
ENV_FILE="${PUBLISHER_ENV_PATH:-$HOME/.51publisher/.env}"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "[start-backend] ERROR: .env not found at $ENV_FILE" >&2
  echo "  Copy packages/backend/.env.example → $ENV_FILE and fill in values." >&2
  exit 1
fi
set -a
# shellcheck source=/dev/null
source "$ENV_FILE"
set +a

echo "[start-backend] Starting backend…"
node "$DIST_JS" &
BACKEND_PID=$!

# Poll healthz up to 10 times (1 s apart) to confirm the server is up.
for i in $(seq 1 10); do
  sleep 1
  if curl -sf "$HEALTHZ_URL" >/dev/null 2>&1; then
    echo "[start-backend] Backend is up (pid $BACKEND_PID). $HEALTHZ_URL → ok"
    exit 0
  fi
  echo "[start-backend] Waiting for healthz… ($i/10)"
done

echo "[start-backend] ERROR: healthz did not return 200 after 10 s." >&2
kill "$BACKEND_PID" 2>/dev/null || true
exit 1
