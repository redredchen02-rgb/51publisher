# TODOS

## Phase 5 — Deferred Items

- **scripts/start-backend.sh** convenience startup wrapper
  **Priority:** P1
  **Description:** Build-freshness check → `node dist/index.js` → poll `/healthz` until 200. Eliminates "ran stale dist" footgun for local dev. Deferred from `docs/plans/2026-06-11-003`.

- **`gate-failed` BatchItemStatus + `gateFailReason` / `pendingTopicId` on BatchItem**
  **Priority:** P1
  **Description:** Add `gate-failed` to `BatchItemStatus` union, `gateFailReason: string` and `pendingTopicId: string` optional fields to `BatchItem` in `packages/shared/src/types.ts`. Required for eager grounding gate in runBatch. Deferred from `docs/plans/2026-06-11-003`.

- **`dailyBatchSize` setting in Settings type**
  **Priority:** P1
  **Description:** Add `dailyBatchSize?: number` to the `Settings` interface in shared. Used by 今日一键备稿 to cap how many topics the button suggests. Deferred from `docs/plans/2026-06-11-003`.

- **Eager grounding gate pre-check in `runBatch`**
  **Priority:** P1
  **Description:** In `batch-orchestrator.ts` `runBatch`, after generating a draft and before `filled` state, call `evaluateGrounding` → if not satisfied, transition to `gate-failed` (not `aborted`). Lets operator see which drafts need human fact-completion vs which are fully grounded. Deferred from `docs/plans/2026-06-11-003`.

## Completed

<!-- Completed items will be moved here -->
