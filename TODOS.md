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

- **BatchItem id 无批次作用域 (non-blocking)** | **Priority:** P3
  条目 id 当前为 `topic` 或简单序号，跨批次运行可能碰撞，导致 published_posts 注册表出现
  主键冲突或轨迹记录混淆。建议改为 `${batchId}:${index}` 或 nanoid。
  发现于: feat/phase-2-measurement (2026-06-11)

## Completed
