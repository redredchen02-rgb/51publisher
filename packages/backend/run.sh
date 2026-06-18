#!/bin/bash
cd "$(dirname "$0")"
# Auto-load .env if present (e.g. SCRAPER_BASE_URL); no-op when absent.
[ -f .env ] && set -a && . ./.env && set +a
python3 -m scraper.main "$@"
