#!/bin/bash
# Package the Python backend source into a reproducible tarball.
# Output: dist/backend-<CHANGELOG version>.tar.gz  (dist/ is gitignored)
# Runtime data (data/, exports/, *.db), caches and build dirs are excluded.
set -euo pipefail
cd "$(dirname "$0")/.."
SRC="packages/backend"

VERSION="$(grep -m1 -oE '\[[0-9]+\.[0-9]+\.[0-9]+\]' "$SRC/CHANGELOG.md" | tr -d '[]' || true)"
VERSION="${VERSION:-0.0.0}"
OUT="dist/backend-${VERSION}.tar.gz"

mkdir -p dist
rm -f "$OUT"

tar \
  --exclude='data' \
  --exclude='exports' \
  --exclude='dist' \
  --exclude='__pycache__' \
  --exclude='.pytest_cache' \
  --exclude='.benchmarks' \
  --exclude='*.db' --exclude='*.db-shm' --exclude='*.db-wal' \
  --exclude='.DS_Store' \
  -czf "$OUT" -C packages backend

echo "built $OUT"
