---
title: "feat: 51guapi comprehensive upgrade — rebrand, refactor, deploy"
type: feat
status: active
date: 2026-06-17
origin: docs/brainstorms/2026-06-17-comprehensive-scan-upgrade-requirements.md
supersedes:
  - docs/plans/2026-06-16-004-refactor-51publisher-unified-naming-plan.md
  - docs/plans/2026-06-16-005-refactor-remove-gossip-pipeline-plan.md
---

# feat: 51guapi comprehensive upgrade — rebrand, refactor, deploy

## Overview

Execute the full 7-wave transformation of the 51publisher monorepo into **51guapi (吃瓜小幫手)** : rename, strip the old publish pipeline, strengthen gossip scraping, add export, deploy, test, observe, document. Delivered as sequential waves with parallel sub-units where file dependencies allow.

**Target repo:** `redredchen02-rgb/51guapi` (new repo, after Wave 0 completes)

---

## Problem Frame

The codebase carries three critical bottlenecks:

1. **Product identity collision** — README, manifest, package scope `@51guapi/*`, entrypoints, lib modules all say "51publisher 发帖填充助手". The confirmed direction is "51guapi 吃瓜小幫手" — gossip extraction & export, not form-filling.
2. **Dead code weight** — The entire publish pipeline (content.ts, quill-bridge, fillers, safety-gate, grounding-gate, publish-orchestrator, batch-orchestrator) and the acgs51 adapter constitute ~4000 lines of dead code post-pivot. Every CI run compiles and tests them.
3. **Production gap** — E2E tests, Docker compose with reverse proxy, observability, and structured logging are all incomplete. The server has never run outside local dev.

---

## Scope Boundaries

### In Scope (7 Waves)

| Wave | Description | Priority |
|------|-------------|----------|
| **Wave 0** | Product identity rebrand + dead code removal | P0 (blocking) |
| **Wave 1** | Code health — file splitting, biome update, TS strictness | P1 |
| **Wave 2** | Infrastructure — Docker compose, CI fixes, env cleanup | P1 |
| **Wave 3** | Testing — E2E framework, integration tests, flaky detection | P2 |
| **Wave 4** | Performance — bundle monitoring, lazy load audit, backend caching | P3 |
| **Wave 5** | Observability — structured logging, healthz, metrics, TG alerts | P3 |
| **Wave 6** | Documentation — archive drift, API docs, architecture doc, pre-commit lint | P4 |

### Deferred for later
- Firefox support (post-v0.1)
- Visual regression screenshot diff in CI
- Migration to tRPC/GraphQL
- i18n/multi-language

### Outside this product's identity
- Publishing/filling third-party backends (removed in Wave 0)
- Generic scraping platform (focused on gossip domain)
- UX framework rewrite (no Tailwind/shadcn — CSS modules + plain React is sufficient)

### Deferred to Follow-Up Work
- Complete TypeScript `noExplicitAny` elimination beyond Wave 0's surface-level cleanup

---

## Key Technical Decisions

| Decision | Rationale |
|----------|-----------|
| **Wave 0 first, everything else after** | Product identity is the prerequisite for all file paths, imports, and docs. Renaming after splitting = double work. |
| **Rebrand in-place in current repo, then push to new repo** | Avoids coordination hell between two repos during active rename. One branch `feat/guapi-rebrand`, push to `redredchen02-rgb/51guapi` when green. |
| **Dead code removal BEFORE file splitting** | Some large files (batch-orchestrator, batch.ts, publish-orchestrator) will be deleted entirely. No point splitting them first. |
| **Strengthen gossip AFTER rebrand** | R11-R13 (multi-channel URL, export) depend on new product identity. Do them after cleanup. |
| **Docker Wave 2 parallel with Wave 0** | Zero file overlap — Docker config doesn't touch extension source or backend routes. |
| **E2E Wave 3 after deployment live** | E2E tests target a running server; no point setting them up before deployment exists. |

---

## Implementation Units

### Wave 0 — Product Identity Rebrand (P0)

#### U1. Supersede conflicting plans + create guapi branch

**Goal:** Mark the two plans that conflict with the new direction as superseded. Create `feat/guapi-rebrand` branch.

**Requirements:** (enabling - no direct R-IDs)

**Dependencies:** None

**Files:**
- Modify: `docs/plans/2026-06-16-004-refactor-51publisher-unified-naming-plan.md` — add `superseded_by: docs/plans/2026-06-17-002-feat-51guapi-comprehensive-upgrade-plan.md`
- Modify: `docs/plans/2026-06-16-005-refactor-remove-gossip-pipeline-plan.md` — add `superseded_by: docs/plans/2026-06-17-002-feat-51guapi-comprehensive-upgrade-plan.md`

**Approach:**
- Add `superseded_by` field to frontmatter of both plans
- `git checkout -b feat/guapi-rebrand`
- This is the working branch for all Wave 0 changes

**Test expectation:** none — metadata only

**Verification:** `grep "superseded_by" docs/plans/2026-06-16-004-* docs/plans/2026-06-16-005-*` shows the reference

---

#### U2. Remove publishing pipeline (content, quill-bridge, fillers, gates, publish, batch)

**Goal:** Delete all files in the "fill into third-party backend" chain.

**Requirements:** R5, R6, R7

**Dependencies:** U1 (branch exists)

**Files (delete):**
- `packages/extension/entrypoints/content.ts`
- `packages/extension/entrypoints/quill-bridge.content.ts`
- `packages/extension/lib/fillers.ts`
- `packages/extension/lib/fillers.test.ts`
- `packages/extension/lib/fillers-extra.test.ts`
- `packages/extension/lib/safety-gate.ts`
- `packages/extension/lib/safety-gate.test.ts`
- `packages/extension/lib/grounding-gate.ts`
- `packages/extension/lib/grounding-gate.test.ts`
- `packages/extension/lib/publish-orchestrator.ts`
- `packages/extension/lib/publish-orchestrator.test.ts`
- `packages/extension/lib/publish.ts`
- `packages/extension/lib/publish.test.ts`
- `packages/extension/lib/publish-feedback.ts`
- `packages/extension/lib/publish-feedback.test.ts`
- `packages/extension/lib/batch-orchestrator.ts`
- `packages/extension/lib/batch-run.ts`
- `packages/extension/lib/batch-run.test.ts`
- `packages/extension/lib/batch-approve.ts`
- `packages/extension/lib/batch-approve-core.test.ts`
- `packages/extension/lib/batch-approve-gate.test.ts`
- `packages/extension/lib/batch-item-ops.ts`
- `packages/extension/lib/batch-item-ops.test.ts`
- `packages/extension/lib/batch.ts`
- `packages/extension/lib/batch.test.ts`
- `packages/extension/lib/batch-sync.ts`
- `packages/extension/lib/batch-sync.test.ts`
- `packages/extension/lib/first-flight-orchestrator.ts`
- `packages/extension/lib/first-flight.ts`
- `packages/extension/lib/first-flight.test.ts`
- `packages/extension/lib/first-flight-orchestrator.test.ts`
- `packages/extension/entrypoints/sidepanel/BatchReviewPanel.tsx`
- `packages/extension/entrypoints/sidepanel/BatchReviewPanel.test.tsx`
- `packages/extension/entrypoints/sidepanel/BatchView.tsx`
- `packages/extension/entrypoints/sidepanel/batch-review/` (entire directory)
- `packages/extension/entrypoints/sidepanel/today-batch/` (entire directory)
- `packages/extension/entrypoints/sidepanel/firstflight/` (entire directory)
- `packages/extension/entrypoints/sidepanel/DryRunReport.tsx`
- `packages/extension/entrypoints/sidepanel/DryRunReport.test.tsx`
- `packages/extension/entrypoints/sidepanel/FillResultPanel.tsx`
- `packages/extension/entrypoints/sidepanel/HistoryPanel.tsx`
- `packages/extension/entrypoints/sidepanel/HistoryPanel.test.tsx`
- `packages/extension/tests/e2e/fixtures/` (entire directory — Quill fixtures)
- `packages/extension/tests/e2e/*fill*` (any fill-related E2E tests)

**Approach:**
- Batch delete all listed files
- Remove content.ts and quill-bridge from `wxt.config.ts` entrypoints array
- Clean `packages/extension/lib/index.ts` or any barrel exporting deleted modules
- Clean `packages/extension/entrypoints/sidepanel/App.tsx` — remove imports and Route cases for BatchReview, FillResult, History, DryRunReport, FirstFlight
- Clean `entrypoints/background.ts` — remove message type handlers for publish/batch messages

**Test scenarios:**
- Happy path: `pnpm --filter @51guapi/extension compile` passes
- Happy path: `pnpm --filter @51guapi/extension test` passes (existing tests)
- Edge: `grep -r "fillers\|safety-gate\|grounding-gate\|publish-orchestrator\|batch-orchestrator\|first-flight" packages/extension/src/` returns nothing (dist/ excluded)
- Edge: `grep "content\.ts\|quill-bridge" packages/extension/wxt.config.ts` returns nothing

**Verification:** `pnpm -r compile` green; `grep -r "from.*fillers\|from.*safety-gate\|from.*grounding-gate\|from.*publish-orchestrator\|from.*batch-orchestrator" packages/` returns nothing

**Patterns to follow:**
- Clean barrel exports like `lib/index.ts` or `entrypoints/background.ts` imports
- Use `grep -r` to find dangling imports, not manual speculation

---

#### U3. Remove acgs51 adapter + ACGS51 env vars + 51acgs.com from SSRF allowlist

**Goal:** Delete the comic source adapter and all references to it.

**Requirements:** R8, R9, R10

**Dependencies:** U2 (pipeline removal first ensures no remaining import chains)

**Files (delete):**
- `packages/backend/src/scraper/adapters/acgs51-adapter.ts`
- `packages/backend/src/scraper/adapters/acgs51-adapter.test.ts`

**Files (modify):**
- `packages/backend/src/scraper/adapters/index.ts` — remove acgs51Adapter export
- `packages/backend/src/scraper/scraper-config.ts` — remove acgs51 from site configs
- `packages/backend/src/scraper/scheduler.ts` — remove acgs51 cron entry
- `packages/backend/src/scraper/auto-generate.ts` — remove acgs51 branch
- `packages/backend/src/env-check.ts` — remove ACGS51_* checks
- `packages/backend/src/index.ts` — remove ACGS51_* import/environment wiring
- `packages/backend/.env.example` — remove ACGS51_* variables
- `packages/backend/src/scraper/ssrf-allowlist.ts` — remove `51acgs.com` from entries
- `docs/ops-runbook.md` — remove 51acgs.com references
- `CLAUDE.md` — remove 51acgs.com mentions

**Test scenarios:**
- Happy path: `pnpm --filter @51guapi/backend compile` passes
- Happy path: `pnpm --filter @51guapi/backend test` passes
- Edge: env-check passes without `ACGS51_*` env vars (no "missing required env" error)
- Edge: `grep -r "ACGS51\|51acgs" packages/backend/` returns nothing (excluding `node_modules/`)
- Integration: scraper routes should work without acgs51 adapter registered

**Verification:** backend starts without ACGS51_* env vars; `grep -r "acgs51\|ACGS51" packages/` returns nothing

---

#### U4. Rename all packages from @51guapi/* → @51guapi/*

**Goal:** Update package scopes, all import paths, and pnpm --filter references.

**Requirements:** R1, R2, R3

**Dependencies:** U2, U3 (dead code removed first, fewer paths to rename)

**Files (modify):**
- `package.json` (root) — `name: "@51guapi/monorepo"` → `"@51guapi/monorepo"`
- `packages/extension/package.json` — `name: "..."` → `"@51guapi/extension"`, `version: "0.1.0"`
- `packages/backend/package.json` — `name: "..."` → `"@51guapi/backend"`, `version: "0.1.0"`
- `packages/shared/package.json` — `name: "..."` → `"@51guapi/shared"`, `version: "0.1.0"`
- All `.ts` files importing `@51guapi/*` — replace with `@51guapi/*`
- `.github/workflows/ci.yml` — replace all `--filter @51guapi/*` with `--filter @51guapi/*`
- `.github/workflows/release.yml` — same
- `scripts/check-all.sh` — replace filter references
- `scripts/setup.sh` — same
- `scripts/start-backend.sh` — same
- `scripts/setup.mjs` — same
- `CLAUDE.md` — replace package references
- `AGENTS.md` — replace package references

**Approach:**
- Use `ast-grep` or `sed` for batch rename: `@51guapi/` → `@51guapi/` across all `.ts`, `.json`, `.yml`, `.sh`, `.md` files
- Archive docs are exempt (docs/plans/archive/, docs/brainstorms/archive/)
- Pin all three packages to `0.1.0` (new product identity)
- Verify `pnpm install` after rename (lockfile updates)

**Test scenarios:**
- Happy path: `pnpm -r compile` green
- Happy path: `pnpm test` green
- Happy path: `grep -r "@51guapi/" packages/ --include="*.ts" --include="*.json"` returns nothing (dist/, node_modules/ excluded)
- Integration: CI workflow has correct filter references

**Verification:** `pnpm -r compile && pnpm -r test` both green; `grep -r "@51guapi/" packages/ .github/ --include="*.ts" --include="*.json" --include="*.yml" --include="*.sh"` returns nothing

---

#### U5. Rebrand user-facing strings (manifest, UI, README, docs)

**Goal:** All user-visible text says "51guapi 吃瓜小幫手" not "51publisher 发帖填充助手".

**Requirements:** R1, R4

**Dependencies:** U4 (package names settled first)

**Files (modify):**
- `packages/extension/wxt.config.ts` — manifest `name` and `description`
- `packages/extension/entrypoints/sidepanel/App.tsx` — title bar string
- `README.md` — full rewrite for 51guapi identity
- `docs/install-and-usage.md` — rebrand
- `docs/batch-usage-guide.md` — rebrand
- `docs/auto-generate-guide.md` — rebrand
- `docs/dry-run-strategy.md` — rebrand
- `packages/backend/.env.example` — rebrand comments
- Any `.ts` file with "51publisher 发帖填充助手" or "51publisher" in comments (not archive)

**Approach:**
- Global search and replace: `51publisher` → `51guapi` in user-facing strings
- `发帖填充助手` → `吃瓜小幫手`
- `发帖` → `吃瓜` where relevant (but verify context — not all occurrences may map)
- `README.md` gets a full rewrite: new product positioning, new quickstart

**Test scenarios:**
- Happy path: `grep -r "51publisher" packages/extension/ --include="*.ts" --include="*.tsx" --include="*.json" --include="*.md" | grep -v node_modules | grep -v archive` returns nothing (for user-facing strings)
- Happy path: `pnpm build:extension` produces manifest with correct name
- Visual: Load extension, confirm sidepanel title says "吃瓜小幫手"

**Verification:** Extension manifest `name` = "51guapi 吃瓜小幫手"; README mentions "51guapi" not "51publisher"

---

#### U6. Push to new repo + cleanup

**Goal:** Push `feat/guapi-rebrand` to `redredchen02-rgb/51guapi`, verify CI green.

**Requirements:** R14

**Dependencies:** U1–U5

**Approach:**
- `git remote add guapi git@github.com:redredchen02-rgb/51guapi.git`
- `git push guapi feat/guapi-rebrand`
- Open PR against 51guapi main
- Wait for CI green
- Merge

**Test expectation:** none — CI/ops

**Verification:** PR green, merged to `redredchen02-rgb/51guapi` main

---

### Wave 1 — Code Health (after rebrand)

#### U7. Split bg-handlers.ts into domain handler modules

**Goal:** Break the 1025-line handler factory into domain-separated files.

**Requirements:** R15

**Dependencies:** U5 (after rebrand, file paths settled)

**Files:**
- Create: `packages/extension/lib/handlers/draft-handlers.ts` — draft/pending CRUD
- Create: `packages/extension/lib/handlers/settings-handlers.ts` — settings R/W
- Create: `packages/extension/lib/handlers/scrape-handlers.ts` — scrape/extract
- Create: `packages/extension/lib/handlers/connection-handlers.ts` — connection test
- Create: `packages/extension/lib/handlers/export-handlers.ts` — export (if ready)
- Create: `packages/extension/lib/handlers/index.ts` — barrel
- Modify: `packages/extension/lib/bg-handlers.ts` — reduce to re-export from handlers/
- Modify: `packages/extension/entrypoints/background.ts` — import path update

**Approach:**
- Map all handler functions in bg-handlers.ts to domain categories
- Extract each category into its own file under `handlers/`
- Keep `bg-handlers.ts` as thin barrel for backward compat during transition

**Execution note:** Characterization-first — write a smoke integration test (`createHandlers` registers all message types without throwing) before touching production code.

**Test scenarios:**
- Happy path: all handler types route to correct new module
- Edge: empty deps object → should not throw (graceful degradation)
- Regression: existing handler integration tests pass unchanged
- Integration: `createHandlers` register count equals previous (no handler dropped)

**Verification:** `pnpm --filter @51guapi/extension test` green; handler count unchanged

---

#### U8. Split App.tsx into route-based view modules

**Goal:** Break 462-line App.tsx into separate view modules.

**Requirements:** R15

**Dependencies:** U5

**Files:**
- Create: `packages/extension/entrypoints/sidepanel/views/AuthView.tsx`
- Create: `packages/extension/entrypoints/sidepanel/views/MainView.tsx`
- Create: `packages/extension/entrypoints/sidepanel/views/SettingsView.tsx`
- Create: `packages/extension/entrypoints/sidepanel/views/PendingTopicsView.tsx` (migrate existing)
- Create: `packages/extension/entrypoints/sidepanel/views/index.ts`
- Modify: `packages/extension/entrypoints/sidepanel/App.tsx` — reduce to router + lazy imports

**Approach:**
- Extract each view from App.tsx's switch/match block into its own file
- Views already use `React.lazy()` — maintain that
- PendingTopicsView.tsx already exists at 314L, just move to views/ and re-import

**Test scenarios:**
- Happy path: all existing view routes still render
- Edge: unknown route → fallback to main
- Regression: lazy loading still works (no bundle regression)

**Verification:** sidepanel loads all views at runtime; `pnpm test` green

**Patterns to follow:** existing `React.lazy()` pattern in App.tsx

---

#### U9. Split storage.ts into adapter + operation layers

**Goal:** Break 566-line storage barrel into separate domain modules.

**Requirements:** R15

**Dependencies:** U5

**Files:**
- Create: `packages/extension/lib/storage/settings-storage.ts`
- Create: `packages/extension/lib/storage/draft-storage.ts`
- Create: `packages/extension/lib/storage/safety-storage.ts`
- Create: `packages/extension/lib/storage/index.ts`
- Modify: `packages/extension/lib/storage.ts` — thin re-export

**Test scenarios:**
- Happy path: all storage operations work after refactor
- Regression: existing storage tests pass unchanged

**Verification:** `pnpm --filter @51guapi/extension test` green

---

#### U10. Biome update + Node 22 in CI + branch cleanup

**Goal:** Update toolchain versions and clean stale branches.

**Requirements:** R17, R18

**Dependencies:** U5

**Files:**
- Modify: `.github/workflows/ci.yml` — Node 20→22
- Modify: `.github/workflows/release.yml` — Node 20→22
- Modify: `packages/extension/package.json` + `packages/backend/package.json` + `packages/shared/package.json` — Biome `^2.5.0` → `^2.6.0` (or latest stable)
- Modify: `biome.json` — update `$schema` version
- (No file change for branches — `git branch -d` commands)

**Approach:**
- `npm view @biomejs/biome version` → update range in all 4 package.json files
- Run `pnpm biome migrate` if needed
- `git branch --merged main | grep -v "\* main" | xargs git branch -d` to clean merged branches (after confirming safety)

**Test scenarios:**
- Happy path: `pnpm lint:ci` green after biome upgrade
- Happy path: CI runs on Node 22
- Happy path: `git branch` shows cleaned list

**Verification:** CI pipeline uses Node 22; biome format/lint passes

---

#### U11. Test file splitting (batch tests, background tests)

**Goal:** Break the monolithic test files into domain-separated test files.

**Requirements:** R16

**Dependencies:** U2 (batch-related tests may be deleted not split, if Wave 0 removed batch pipeline)

**Files (split):**
- `packages/extension/lib/batch.test.ts` (723L) — if batch not deleted; split by domain
- `packages/extension/__tests__/entrypoints/background.test.ts` (1520L) — split by handler type

**Approach:**
- Evaluate which test files survive Wave 0 dead code removal
- For survivors, split by `describe` block domain into separate files

**Test expectation:** none until Wave 0 scope is finalized — revisit after dead code removal

---

### Wave 2 — Infrastructure & Deployment

#### U12. Production Docker Compose with reverse proxy

**Goal:** Full docker-compose.yml with Caddy reverse proxy + auto SSL + healthcheck consumer.

**Requirements:** R20

**Dependencies:** U5 (after rebrand, filenames settled)

**Files:**
- Modify: `docker-compose.yml` — add Caddy service, healthcheck, restart policy
- Create: `deploy/Caddyfile` — Caddy config with auto SSL
- Create: `deploy/.env.example` — production env vars documentation
- Modify: `packages/backend/Dockerfile` — review for multi-stage production readiness (currently exists)

**Approach:**
- Caddy handles TLS termination + reverse proxy to backend port 3001
- Backend service gets `restart: unless-stopped` and `healthcheck` matching `/api/v1/healthz`
- Volume for SQLite data persists across restarts
- `.env` file for production secrets (not committed)

**Test scenarios:**
- Happy path: `docker compose up -d` → `curl http://localhost:3001/api/v1/healthz` returns 200
- Happy path: Caddy reverse proxy → `curl https://localhost` → proxied to backend
- Edge: `docker compose down` + `up` → data still persists

**Verification:** `docker compose up -d` and health endpoint responding

---

#### U13. CI/CD fixes (release.yml conditional steps, env example cleanup)

**Goal:** Fix Node 22 in CI, make `docker save` conditional, clean .env.example.

**Requirements:** R22, R23

**Dependencies:** U10 (Node 22 update), U12 (Docker)

**Files:**
- Modify: `.github/workflows/release.yml` — Node 20→22, conditional `docker save` step
- Modify: `packages/backend/.env.example` — clean placeholders, remove old vars

**Approach:**
- Add `if: ${{ runner.os == 'Linux' }}` to docker save step
- `.env.example`: remove `ACGS51_*`, `change-this` values, add `ALLOWED_HOSTS` and `CORS_ORIGIN` documentation

**Test expectation:** none — CI config

**Verification:** release workflow runs without docker save error on non-Linux runners

---

### Wave 3 — Testing

#### U14. E2E test framework with Playwright + WXT

**Goal:** Create realistic browser E2E tests for the 51guapi sidepanel.

**Requirements:** R24

**Dependencies:** U6 (rebrand to new repo), U12 (deployment live)

**Files (new):**
- `packages/extension/tests/e2e-51guapi/settings.test.ts` — modify endpoint, save, verify
- `packages/extension/tests/e2e-51guapi/gossip-flow.test.ts` — lock URL, extract, preview
- `packages/extension/tests/e2e-51guapi/ssrf-block.test.ts` — unauthorized host blocked
- `packages/extension/tests/e2e-51guapi/auth-flow.test.ts` — login + session persistence
- `packages/extension/vitest.e2e-51guapi.config.ts` — E2E vitest config
- `packages/extension/tests/e2e-51guapi/fixtures/` — minimal HTML fixtures

**Approach:**
- Use Playwright to load the unpacked extension
- Reuse existing WXT E2E structure (stubs pattern from `tests/e2e/`)
- Target 3 critical paths: settings modification, gossip extract flow, auth flow
- SSRF block test uses a blocked hostname and verifies 403

**Test scenarios:**
- Happy path: sidepanel settings page opens, endpoint URL saved correctly
- Happy path: gossip extraction flow from URL to preview
- Error path: unauthorized URL → 403 blocked message
- Integration: auth flow login → token storage → subsequent requests authenticated

**Verification:** `pnpm --filter @51guapi/extension test:e2e` (or equivalent) green

---

#### U15. Integration tests for api-fetch and cross-layer paths

**Goal:** Cover extension ↔ backend integration with real HTTP (no mocks).

**Requirements:** R25

**Dependencies:** U6, U14 (E2E framework)

**Files (new):**
- `packages/extension/tests/integration/api-fetch.test.ts`
- `packages/extension/tests/integration/auth.test.ts`

**Approach:**
- Start backend via `node dist/index.js` in test `beforeAll`
- Hit real endpoints from extension client modules

**Test scenarios:**
- Happy path: `apiFetch` with valid token → 200 + body
- Error path: `apiFetch` with expired token → 401 + re-auth flow
- Error path: `apiFetch` to offline backend → graceful error message

**Verification:** integration tests pass against real (test-mode) backend

---

### Wave 4 — Performance

#### U16. Bundle size monitoring via wxt analyze

**Goal:** Add bundle size check to CI.

**Requirements:** R27

**Dependencies:** U6

**Files:**
- Modify: `.github/workflows/ci.yml` — add `pnpm --filter @51guapi/extension wxt analyze` step
- Create: `packages/extension/.size-limit.json` (if using size-limit) or CI comment threshold

**Approach:**
- `wxt analyze` shows per-entrypoint bundle sizes
- Set a CI warning threshold (e.g., alert if >500KB any entrypoint)

**Test expectation:** none — CI config

**Verification:** CI reports bundle size

---

#### U17. Lazy loading audit

**Goal:** Confirm all sidepanel views are dynamically imported.

**Requirements:** R28

**Dependencies:** U8 (App.tsx split)

**Approach:**
- Review all `React.lazy()` imports in App.tsx
- Check bundle output for code-splitting
- Add missing lazy imports for any view that was moved in U8

**Test scenarios:**
- Happy path: bundle analysis shows code-split chunks for each view
- Edge: initial load does not include all view code

**Verification:** `wxt analyze` shows separate chunk per view

---

### Wave 5 — Observability

#### U18. Structured logging audit

**Goal:** Ensure all backend routes and services use consistent pino logging with requestId + operation name + duration.

**Requirements:** R30

**Dependencies:** U6

**Files:**
- Modify: `packages/backend/src/app.ts` — ensure requestId logging middleware
- Modify: `packages/backend/src/routes/*.ts` — audit each route's logging

**Approach:**
- Fastify has built-in request id via `request.id`
- Audit each route handler for `request.log.info(...)` at start and end
- Ensure operation name is logged (e.g., `"op": "extract-gossip-facts"`)

**Test scenarios:**
- Happy path: hitting any route produces a log line with requestId + op + durationMs

**Verification:** `pnpm dev:backend`, hit a route, check log output for all three fields

---

#### U19. Healthz enhancement + TG alert improvement

**Goal:** Add dependency checks to healthz endpoint and extend TG alerts.

**Requirements:** R31, R33

**Dependencies:** U12 (Docker deploys healthcheck)

**Files:**
- Modify: `packages/backend/src/routes/healthz.ts` — add `llm`, `storage`, `scraper` status checks
- Modify: `packages/backend/src/services/telegram.ts` — add metric-threshold-based alerting

**Approach:**
- Healthz returns `{"status":"ok","checks":{"llm":"ok","storage":"ok","scraper":"ok"}}`
- Degraded but non-fatal → still `200` with `checks.llm: "degraded"`
- TG alerts: extend from scraper-only to also fire on high error rate (e.g., >5% LLM failures in 5min window)

**Test scenarios:**
- Happy path: `GET /api/v1/healthz` returns all checks OK
- Degraded path: stop LLM service → healthz returns `checks.llm: "error"` but overall `status: "degraded"`
- Integration: TG alert fires when error rate exceeds threshold

**Verification:** `curl /api/v1/healthz` shows expanded check results

---

### Wave 6 — Documentation

#### U20. Archive drift docs + write Architecture.md

**Goal:** Move 29/30 brainstorms, 4 completed plans, 3 ideation docs to archive; write concise architecture doc.

**Requirements:** R34, R35, R36, R38

**Dependencies:** U6 (identities settled)

**Files:**
- Move: `docs/brainstorms/` (29 files) → `docs/brainstorms/archive/` (keep guapi rebrand + feedback-ui)
- Move: `docs/plans/` (4 completed) → `docs/plans/archive/`
- Move: `docs/ideation/` (3 files) → `docs/ideation/archive/`
- Create: `docs/architecture.md` — three-world model, storage dual-track, SSRF guard, key flows

**Approach:**
- Use `git mv` for archive moves to preserve history
- Architecture.md should be concise (<2 pages), covering only decisions that future contributors must understand

**Test expectation:** none — documentation

**Verification:** `ls docs/brainstorms/` shows only kept files; `docs/architecture.md` exists

**Patterns to follow:** existing `CLAUDE.md` architecture section (extract key diagrams to standalone doc)

---

#### U21. Pre-commit lint hook

**Goal:** Add biome check to pre-commit hook (currently only compile).

**Requirements:** R39

**Dependencies:** U10 (Biome update)

**Files:**
- Modify: `scripts/git-hooks/pre-commit` — add `pnpm lint:ci` or `biome check --write`

**Approach:**
- Append to existing pre-commit: `biome check packages/ --write --no-errors-on-unmatched`
- Fail-fast if biome finds errors

**Test expectation:** none — git hooks

**Verification:** make a lintable change → pre-commit catches it

---

## Implementation Order

```
Wave 0: U1 → U2 → U3 → U4 → U5 → U6  (sequential — each depends on previous)
                                
Wave 1: U7 ─┐                             
            ├── U7→U8→U9 can be parallel  
Wave 1: U8 ─┤   (different file domains)  
            └── but all depend on U5       
Wave 1: U9 ─┘                             
Wave 1: U10 ─── can run parallel to U7-U9 
Wave 1: U11 ─── after U2 (dead code removal clarifies what survives)
                                
Wave 2: U12 ─── can run parallel to Wave 1 (no file overlap)
Wave 2: U13 ─── after U10 + U12
                                
Wave 3: U14 ─── after U6 (repo live) + U12 (deployment)
Wave 3: U15 ─── after U14 (E2E framework)
                                
Wave 4: U16 ─── after U6
Wave 4: U17 ─── after U8
                                
Wave 5: U18 ─── after U6
Wave 5: U19 ─── after U12
                                
Wave 6: U20 ─── after U6 (best done last — lots of docs go stale during Waves 0-2)
Wave 6: U21 ─── after U10
```

---

## Risks & Dependencies

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Wave 0 dead-code removal breaks compilation | Medium | `pnpm -r compile` after each deletion group; commit per unit |
| Rename `@51guapi/*` → `@51guapi/*` misses import paths | Medium | `grep -r` sweep before final commit |
| Branch `feat/guapi-rebrand` diverges from main during Wave 0 | Low | Work in this branch; merge main periodically |
| Existing E2E tests depend on removed pipeline | High (if tests reference publish/fill) | Delete test files that cover removed pipeline in U2 |
| `51guapi` repo access not ready | Low | Wave 0 work is in current repo; can push when ready |
| `xhssex.com` (xiaohongshu) scraping runs into anti-bot | Medium | Will need Playwright stealth mode; defer to implementation |

---

## System-Wide Impact

| Surface | Impact |
|---------|--------|
| Extension background SW | Removed ~12 message types (publish, batch, fill); added export handler |
| Sidepanel UI | Removed 4+ views (batch, fill-result, history, firstflight); rebuilt PendingTopics |
| Backend scraper | Removed acgs51 adapter; added generic gossip site adapter |
| Backend routes | Removed publish-related; added export routes |
| Backend API | `/api/v1/gossip/*` routes preserved (unlike old 005 plan), `/api/v1/publish/*` removed |
| CI/CD | Updated Node 22, Biome latest, bundle monitoring |
| Docker | Added Caddy reverse proxy with auto SSL |
| Dev workflows | Pre-commit now also lints; stale branches cleaned |
| Documentation | ~36 files archived; new architecture.md written |

---

## Assumptions

- The guapi rebrand is the confirmed product direction (no reversal to 51publisher publishing)
- The new repo `redredchen02-rgb/51guapi` push access exists
- The Quill third-party backend is no longer a target (publishing pipeline removal is permanent)
- The xiaohongshu/gossip scraping targets won't require fundamentally different extraction from the current `fact-extractor`

---

## Sources & References

- `docs/brainstorms/2026-06-17-comprehensive-scan-upgrade-requirements.md` — origin requirements (R1-R39, AE1-AE7)
- `docs/solutions/best-practices/incremental-pr-adversarial-verification-2026-06-15.md` — PR strategy (small units, CI green gate)
- `docs/solutions/runtime-errors/metrics-counters-reset-on-restart-2026-06-17.md` — observability pattern (persistent counters)
- `docs/solutions/developer-experience/extension-http-client-testability-injection-seam-2026-06-15.md` — testability pattern
- `docs/solutions/developer-experience/vitest-excludes-dist-phantom-backend-p0-2026-06-15.md` — test infra pattern
- `docs/solutions/security-issues/fixture-secret-gate-false-green-relative-path-2026-06-15.md` — CI safety pattern
- `docs/solutions/developer-experience/claude-in-chrome-script-redaction-backend-verify-2026-06-05.md` — backend verification pattern
- Superseded: `docs/plans/2026-06-16-004-refactor-51publisher-unified-naming-plan.md` (opposite direction: @51publisher scope)
- Superseded: `docs/plans/2026-06-16-005-refactor-remove-gossip-pipeline-plan.md` (opposite direction: remove gossip)
