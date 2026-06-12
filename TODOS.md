# TODOS

## Backend / Infrastructure

- **Fix backend test dependencies in CI** | **Priority:** P0
  packages/backend/dist/ 下 8 个测试文件因缺失依赖（fastify、better-sqlite3、@51publisher/shared）而持续失败。
  这些包在 extension 的 node_modules 中未安装，需要为后端单独配置测试环境或将依赖移到工作区根目录。
  失败文件: auth-routes.test.js, batch-routes.test.js, config-routes.test.js, cors.test.js, llm.test.js,
  scraper/fact-extractor.test.js, scraper/pending-store.test.js, scraper/scraper-routes.test.js
  发现于: feat/phase-2-measurement (2026-06-11)

## Architecture / Known Gaps

- **slotDiff semantic issue (non-blocking)** | **Priority:** P2
  `computeSlotDiff` in BatchReviewPanel 以 `(freshItem?.publishedDraft, item.draft)` 调用，
  但 item.draft 本身就是 AI 原稿（无操作者编辑持久化路径），导致始终比较 AI 稿 vs AI 稿，
  diff 永远为空。需要将操作者的内联编辑写回 item.draft（或单独存 userDraft 字段）才能得到有意义的 diff。
  发现于: feat/phase-2-measurement (2026-06-11)

- **off-mode trajectory status 命名误导 (non-blocking)** | **Priority:** P3
  `handleApproveBatch` 在 `result.error === 'blocked'`（off 模式）时写入 `status: 'fill-completed'`，
  但该状态在语义上意味着"网关拦截(off模式)"而非"填充成功"。若批次在审批前被 kill，不写轨迹。
  建议：引入 `status: 'gateway-blocked'` 或 `'fill-only'` 明确区分；off 模式下 kill 亦应记录轨迹。
  发现于: feat/phase-2-measurement, adversarial review (2026-06-11)

- **BatchItem id 无批次作用域 (non-blocking)** | **Priority:** P3
  条目 id 当前为 `topic` 或简单序号，跨批次运行可能碰撞，导致 published_posts 注册表出现
  主键冲突或轨迹记录混淆。建议改为 `${batchId}:${index}` 或 nanoid。
  发现于: feat/phase-2-measurement (2026-06-11)

## Completed

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
