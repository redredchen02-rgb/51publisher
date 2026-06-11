# TODOS

## Phase 5 — Deferred Items

(无)

## Completed

- **`dailyBatchSize` setting in Settings type**
  **Completed:** 2026-06-11 (release-readiness, docs/plans/2026-06-11-004)
  shared `Settings` 增加 `dailyBatchSize?: number`;Settings.tsx 露出输入框(1-20,默认 5);clamp 在 `lib/storage.ts`;后端 `batch-store.ts` 同步补 `gate-failed` 状态与 `gateFailReason`/`pendingTopicId` 字段。

- **Eager grounding gate pre-check in `runBatch`**
  **Completed:** 2026-06-11 — 实际已于 phase5 分支实现(`batch-orchestrator.ts` runBatch 内 evaluateGrounding → markGateFailed,fail-open),本条目此前未同步核销。

- **scripts/start-backend.sh** convenience startup wrapper
  **Completed:** v0.5.0.0 (2026-06-11)
  Implemented in `scripts/start-backend.sh`: build-freshness check → `node dist/index.js` → polls `GET /api/v1/healthz` until 200.

- **`gate-failed` BatchItemStatus + `gateFailReason` / `pendingTopicId` on BatchItem**
  **Completed:** v0.5.0.0 (2026-06-11)
  Landed in `packages/extension/lib/batch.ts` (not shared/types.ts as originally scoped). `BatchItemStatus` includes `gate-failed`; `BatchItem` has `gateFailReason?: string` and `pendingTopicId?: string`; `markGateFailed()` helper added.
