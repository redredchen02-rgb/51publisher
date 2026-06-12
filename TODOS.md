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

- **appendTrajectory read-modify-write 无锁 (non-blocking)** | **Priority:** P2
  `appendTrajectory` 在 background.ts 中做 getTrajectory → push → saveTrajectory，高并发（多条目并发发布）
  时可能丢失 record。需要队列化写入或 storage.set 的 CAS 重试。
  发现于: feat/phase-2-measurement (2026-06-11)

- **off-mode 下缺少 appendTrajectory 调用 (non-blocking)** | **Priority:** P2
  `handleRunBatch` 仅在 mode !== 'off' 时调用 `appendTrajectory`。off 模式的发布轨迹不会被记录，
  导致 trajectory 视图在 off 模式下永远为空。
  发现于: feat/phase-2-measurement (2026-06-11)

- **handleApproveBatch 无并发锁 (non-blocking)** | **Priority:** P2
  `APPROVE_BATCH` 消息处理器无 in-flight 布尔守卫；快速双击可派发两次批准。
  确认按钮已加 `disabled={!!busy}` 前端守卫，但 background 层仍缺后端幂等保护。
  发现于: feat/phase-2-measurement (2026-06-11)

- **handleApproveBatch 持有过时批次快照导致 userEdited 被覆盖 (non-blocking)** | **Priority:** P2
  `handleApproveBatch` 入口一次性读取 `getBatch()`，整个循环持有本地副本。
  用户在 item 1 发布期间勾选 item 2 的"已修改"，`handleMarkItemEdited` 写入 storage，
  但 `handleApproveBatch` 下一次 `saveBatch(batch)` 以过时副本覆写，`userEdited` 变回 false。
  修复：在轨迹块内 re-read `getBatch()` 获取最新 `userEdited` 值，或仅重读目标 item。
  发现于: feat/phase-2-measurement, adversarial review (2026-06-11)

- **addFewShotPair 模块级 read-modify-write 无串行化 (non-blocking)** | **Priority:** P3
  `addFewShotPair` / `removeLastFewShotPair` 均在 await 边界跨越时存在竞态。
  `savingItems` 防重仅保护同 itemId 的双击；不同 item 并发调用仍可产生 9 条记录或丢失 undo。
  修复：通过模块级 Promise 队列串行化所有 few-shot 写操作。
  发现于: feat/phase-2-measurement, adversarial review (2026-06-11)

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
