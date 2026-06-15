# Changelog

All notable changes to this project will be documented in this file.

## [0.2.1.0] - 2026-06-15

### Added

- **单元/组件测试覆盖**：新增 124 个测试。后端覆盖 config-store、metrics、scraper adapters(demo/template)、enrichment-utils、prompt store/routes、llm-config、app 路由；扩展覆盖 AuthView、DraftPreview、DryRunReport、ErrorBoundary、Settings、pending-client actions

### Fixed

- **测试加固(落地前评审)**：`app.test.ts` 的 `/docs/json` 断言改为带 token 校验 `200` + OpenAPI spec(此前 `< 500` 连 `404` 注册回归都放过)；`config-store`/`app` 测试新增 teardown 关闭泄漏的 better-sqlite3 WAL 句柄
- **去除测试噪声**：移除两处空断言(`toHaveProperty("textContent")`)、修正一个名不副实的测试标题(声称 `201/200` 实则硬断言 `200`)

## [0.2.0.0] - 2026-06-11

### Added

- **Few-shot 视觉编辑器**：设置页新增结构化 Few-shot 范例编辑器，支持增删改、上下排序（最多 8 条）；可从旧格式 `fewShotExamples` 一键导入并自动解析 `input/output` 结构
- **保存为范例**：已发布条目可一键存为 few-shot 范例，支持 5 秒撤销 Toast
- **备用 LLM 端点**：设置页新增可折叠的备用 endpoint/model 配置，主端点失败时自动回退
- **published_posts 注册表**：`authorized` 模式下发布成功后 best-effort 双写后端注册表（失败静默，trajectory 为本地 source of truth）
- **AI 原稿快照 + slot-level diff**：生成时保存 `publishedDraft` 快照，发布后计算字段级 diff 并写入轨迹，用于统计操作者编辑率
- **度量基础（U1-U5）**：`DegradeStats`（降级字段统计）、`UsageStats`（token 用量）、`FillStats`（填充率）类型与聚合函数；降级汇总条、fill 率摘要、轨迹条目扩展字段
- **Golden-set 评估基线**：`docs/eval/` 新增 golden-set JSON 评估基准（R10）
- **VERSION 文件**：引入 4 位版本号规范（0.2.0.0）

### Fixed

- **PK 冲突**：`published_posts` 记录 id 改为 `batch.id:item.id`，防止多批次运行时主键碰撞导致第 2 批起全部静默丢失
- **urlSource 永远 undefined**：`lib/publish.ts` 现在在 `extractUrl()` 返回 URL 时正确设置 `urlSource: 'from_save'`
- **Toast 计时器泄漏**：5 秒自动消失计时器改用 `useRef` 管理，新 toast 替换旧 toast 时正确取消前一个计时器
- **Import 丢失结构**：`handleImport` 现在解析 `input\n---\noutput` 格式，正确还原 `input` 和 `output` 字段
- **markGenerating 不重置 userEdited**：re-queue 时正确将 `userEdited` 清为 `false`
- **addFewShotPair TOCTOU**：`BatchView` 新增 `savingItems` Set 防止同条目双击并发写入
- **确认按钮并发保护**：批次审批确认按钮加 `disabled={!!busy}` 防重复点击
- **backendUrl SSRF**：Settings 保存时校验 backendUrl 必须为 localhost/127.0.0.1；`published-posts-client` fetch 前二次校验
- **background.ts 双重类型转换**：`result.urlSource` 直接访问，移除 `as unknown as Record` 绕路
- **CONTENT_SLOTS 含非 AI 字段**：从 slot-diff 计算中移除 `postStatus`、`publishedAt`、`mediaId`（由人工填写，不应计入 AI 编辑信号）
- **日文注释**：`draft-diff.ts` 中的日文注释改为中文

### Changed

- **存储读取并行化**：`published-posts-client` 将 `getSettings` + `getBackendToken` 改为 `Promise.all` 并发读取
- **FewShotPairEditor 无障碍**：textarea 绑定 `id`/`htmlFor`；禁用态按钮增加 `opacity: 0.4` 视觉反馈；字号 12px → 13px
- **设置页无障碍**：备用端点折叠按钮增加 `aria-expanded`；Toast div 增加 `role="status" aria-live="polite"`
- **降级标签对比度**：状态标签颜色 `#888` → `#555`

## [0.1.0] - 2026-06-09

Initial release — batch fill + review panel + safety modes + trajectory auditing.
