#!/bin/bash
# Package the Chrome extension into a reproducible zip for CWS upload / unpacked load.
# Output: dist/extension-<manifest.version>.zip  (dist/ is gitignored)
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
SRC="packages/extension"

VERSION="$(jq -r '.version' "$SRC/manifest.json")"
OUT="dist/extension-${VERSION}.zip"

mkdir -p dist
rm -f "$OUT"

# Zip from inside the package so archive paths are package-root-relative.
# Exclude dev-only artifacts (tests, lint/dev config) from the shippable package.
( cd "$SRC" && zip -rq "$ROOT/$OUT" . \
    -x "tests/*" \
    -x ".eslintrc.json" \
    -x "package.json" \
    -x "node_modules/*" \
    -x "*.zip" \
    -x ".DS_Store" )

echo "built $OUT"
