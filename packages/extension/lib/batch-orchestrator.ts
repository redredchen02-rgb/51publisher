// 批量编排入口 — 純 barrel，保持現有 import 路徑向後相容。
// 實作已按職責拆到子模組:
//   batch-run.ts        — runBatch + createSerialQueue + RunBatchDeps
//   batch-approve.ts    — approveBatch + ApproveBatchDeps + FirstFlightDispatch
//   batch-item-ops.ts   — discardBatchItem + regenItemWithFacts + retryItem + related types
export type {
	ApproveBatchDeps,
	FirstFlightDispatch,
} from "./batch-approve";
export { approveBatch } from "./batch-approve";
export type {
	RegenItemWithFactsDeps,
	RetryItemDeps,
} from "./batch-item-ops";
export {
	discardBatchItem,
	regenItemWithFacts,
	retryItem,
} from "./batch-item-ops";
export type { RunBatchDeps } from "./batch-run";
export { createSerialQueue, runBatch } from "./batch-run";
