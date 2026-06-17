# TODOS

## Backend / Infrastructure

- **metrics.test.ts 假阳性：直接改 counters 對象而非調用 record\* 函數** | **Priority:** P2
  `metrics.test.ts` 第 46-67 行「计数器递增后反映在输出中」直接修改 `counters` 對象而非調用 `record*()`。
  這代表如果未來 `record*` 調用被誤刪，該測試仍然通過。
  修法：將該 case 改用 `record*()` 函數覆蓋所有 4 個指標類別。
  發現於: test/unit-coverage-suite 对抗评审 (2026-06-15)

## Completed (Backend / Infrastructure)

- **Prometheus 指标生产环境从未递增** | **Priority:** P2 | **已验证（已于 `main` 接好）:** 2026-06-17
  原報告：`counters` 僅被 `getMetrics()` 讀取，生產代碼不遞增。
  核實：`recordDraft` 已在 `app.ts` POST /drafts/generate 的三個分支接好；
  `recordPublishAttempt`/`recordBatchCompleted` 已在 `batch-routes.ts` 接好；
  `recordScraperRun` 已在 `scraper-routes.ts` 接好。
  全部於 `origin/main` 即存在，非分支新增。僅餘上述測試假陽性需要修。
  发现于: test/unit-coverage-suite 对抗评审 (2026-06-15); 关闭于: refactor/remove-gossip-pipeline (2026-06-17)

- **Fix backend test dependencies in CI** | **Priority:** P0 | **Resolved (not reproducing):** 2026-06-15
  原报告:packages/backend/dist/ 下 8 个测试文件因缺失依赖（fastify、better-sqlite3、@51publisher/shared）而持续失败。
  核实:`packages/backend/vitest.config.ts` 已 `exclude: ["dist/**"]`,vitest 只跑 `src/` 源码,不收集 dist 下编译产物。
  `pnpm --filter publisher-backend test` 实跑 = 275 passed / 26 files,无依赖失败。`pnpm -r test` 亦绿。
  dist 下的 `*.test.js` 仅是旧 build 产物,不进测试。该 P0 在当前 GitHub Actions CI(`pnpm -r test`)下不复现。
  发现于: feat/phase-2-measurement (2026-06-11);关闭于: feat/harden-safety-net (2026-06-15)

## Extension / UI

- **TodayBatchView + BatchReviewPanel render 时多次 filter 无 useMemo** | **Priority:** P3
  TodayBatchView.tsx:41 有 8 次 Array.filter/every；BatchReviewPanel.tsx:74 有 3 次 filter + aggregateDegradeStats，均无 useMemo。
  数量小（通常 ≤20 条），当前不影响性能，但随批次增大会退化。
  修法：将所有 derived arrays 包进单个 `useMemo(() => { … }, [items])` 一次遍历。
  发现于: refactor/maintainability-test-refactor, performance specialist review (2026-06-16)

## Architecture / Known Gaps

_当前无开放性架构问题。_

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

- **off-mode trajectory status 命名误导** | **Priority:** P3 | **已過期（代碼被重構移除）:** 2026-06-17
  原報告：`handleApproveBatch` 在 off-mode 寫入誤導的 `fill-completed` 狀態。
  核實：`fill-completed` 字串及 `handleApproveBatch` 函數在當前 main 已不存在。
  batch 審批/軌跡系統已被重構，該問題已隨之消除。
  发现于: feat/phase-2-measurement, adversarial review (2026-06-11); 关闭于: refactor/remove-gossip-pipeline (2026-06-17)
  代码验证：off-mode 下 `result.dryRun === false`，`appendTrajectory` 已被正确调用。

- **backend auth-routes 测试超时** | **Priority:** P0 | **Fixed:** 2026-06-12
  使用 Vitest 4 语法为 rate-limit 测试增加 30s 超时。

- **backend auto-generate 测试逻辑错误** | **Priority:** P0 | **Fixed:** 2026-06-12
  删除重复且逻辑错误的测试用例。

- **extension App.test.tsx mock 路径不匹配** | **Priority:** P0 | **Fixed:** 2026-06-12
  添加 `../../../lib/storage` 的 mock 以匹配 useAutoSave hook 的导入路径。
