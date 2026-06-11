# TODOS

## Phase 5 — Deferred Items

- **`dailyBatchSize` setting in Settings type**
  **Priority:** P1
  **Description:** Add `dailyBatchSize?: number` to the `Settings` interface in shared. Used by 今日一键备稿 to cap how many topics the button suggests. Deferred from `docs/plans/2026-06-11-003`.

- **Eager grounding gate pre-check in `runBatch`**
  **Priority:** P1
  **Description:** In `batch-orchestrator.ts` `runBatch`, after generating a draft and before `filled` state, call `evaluateGrounding` → if not satisfied, transition to `gate-failed` (not `aborted`). Lets operator see which drafts need human fact-completion vs which are fully grounded. Deferred from `docs/plans/2026-06-11-003`.

## Completed

- **scripts/start-backend.sh** convenience startup wrapper
  **Completed:** v0.5.0.0 (2026-06-11)
  Implemented in `scripts/start-backend.sh`: build-freshness check → `node dist/index.js` → polls `GET /api/v1/healthz` until 200.

- **`gate-failed` BatchItemStatus + `gateFailReason` / `pendingTopicId` on BatchItem**
  **Completed:** v0.5.0.0 (2026-06-11)
  Landed in `packages/extension/lib/batch.ts` (not shared/types.ts as originally scoped). `BatchItemStatus` includes `gate-failed`; `BatchItem` has `gateFailReason?: string` and `pendingTopicId?: string`; `markGateFailed()` helper added.
