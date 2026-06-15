# TODOS

## Backend / Infrastructure

(无未决项)

## Completed (Backend / Infrastructure)

- **Fix backend test dependencies in CI** | **Priority:** P0 | **Resolved (not reproducing):** 2026-06-15
  原报告:packages/backend/dist/ 下 8 个测试文件因缺失依赖（fastify、better-sqlite3、@51publisher/shared）而持续失败。
  核实:`packages/backend/vitest.config.ts` 已 `exclude: ["dist/**"]`,vitest 只跑 `src/` 源码,不收集 dist 下编译产物。
  `pnpm --filter publisher-backend test` 实跑 = 275 passed / 26 files,无依赖失败。`pnpm -r test` 亦绿。
  dist 下的 `*.test.js` 仅是旧 build 产物,不进测试。该 P0 在当前 GitHub Actions CI(`pnpm -r test`)下不复现。
  发现于: feat/phase-2-measurement (2026-06-11);关闭于: feat/harden-safety-net (2026-06-15)

## Architecture / Known Gaps

- **off-mode trajectory status 命名误导 (non-blocking)** | **Priority:** P3
  `handleApproveBatch` 在 `result.error === 'blocked'`（off 模式）时写入 `status: 'fill-completed'`，
  但该状态在语义上意味着"网关拦截(off模式)"而非"填充成功"。若批次在审批前被 kill，不写轨迹。
  建议：引入 `status: 'gateway-blocked'` 或 `'fill-only'` 明确区分；off 模式下 kill 亦应记录轨迹。
  发现于: feat/phase-2-measurement, adversarial review (2026-06-11)

## Completed

- **slotDiff semantic issue** | **Priority:** P2 | **Fixed:** 2026-06-12
  在 `batch-orchestrator.ts` 中集成 `computeSlotDiff`，比较 AI 原稿(publishedDraft)与最终发布草稿(draft)。

- **BatchItem id 无批次作用域** | **Priority:** P3 | **Fixed:** 2026-06-12
  BatchItem id 改为 `${batchId}:${index}` 格式，防止跨批次碰撞。

- **appendTrajectory read-modify-write 无锁** | **Priority:** P2 | **Fixed:** 2026-06-12
  引入 Promise 队列 `trajectoryQueue` 串行化所有轨迹写操作，防止并发丢记录。

- **handleApproveBatch 无并发锁** | **Priority:** P2 | **Fixed:** 2026-06-12
  添加 `_approveBatchInFlight` 布尔守卫，防止快速双击派发两次批准。

- **handleApproveBatch 持有过时批次快照导致 userEdited 被覆盖** | **Priority:** P2 | **Fixed:** 2026-06-12
  添加 `saveWithUserEditedMerge` 函数，每次保存前重新读取 storage 合并最新 `userEdited` 状态。

- **addFewShotPair 模块级 read-modify-write 无串行化** | **Priority:** P3 | **Fixed:** 2026-06-12
  引入 `fewShotQueue` Promise 队列串行化 `addFewShotPair` 和 `removeLastFewShotPair`。

- **off-mode 下缺少 appendTrajectory 调用** | **Priority:** P2 | **Verified:** 2026-06-12
  代码验证：off-mode 下 `result.dryRun === false`，`appendTrajectory` 已被正确调用。

- **backend auth-routes 测试超时** | **Priority:** P0 | **Fixed:** 2026-06-12
  使用 Vitest 4 语法为 rate-limit 测试增加 30s 超时。

- **backend auto-generate 测试逻辑错误** | **Priority:** P0 | **Fixed:** 2026-06-12
  删除重复且逻辑错误的测试用例。

- **extension App.test.tsx mock 路径不匹配** | **Priority:** P0 | **Fixed:** 2026-06-12
  添加 `../../../lib/storage` 的 mock 以匹配 useAutoSave hook 的导入路径。
