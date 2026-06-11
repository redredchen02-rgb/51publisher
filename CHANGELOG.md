# Changelog

## [0.3.0] — 2026-06-11

### Features

- **学习与度量 (Phase 2)**: 发布后质量追踪基础架构
  - `degrade-stats`: 批次级别退化统计聚合（退化率、字段分布、平均信心分）
  - `draft-diff`: AI 草稿 vs 人工编辑的 slot 级差异检测，`userEdited` 信号精准识别
  - `published-posts-client`: 发布记录注册表，记录 batchItemId → publishedUrl + aiDraft 快照
  - `FewShotPairEditor`: 侧边栏 Few-shot 样例对编辑器（增删排序、输入/输出文本域）
  - 轨迹扩展：`slots` 字段记录每个发布步骤的字段级 diff
- **可靠性修复**: confirm 按钮 busy 状态防重复提交、published_posts PK 改为 `${batchId}:${itemId}` 防冲突
- **安全**: backendUrl SSRF 验证扩展至 published-posts-client，URL scheme 白名单（localhost/127.0.0.1 only）
- **无障碍**: FewShotPairEditor 移动按钮 aria-label、textarea label/id 绑定、toast aria-live

### Fixes

- `urlSource` 赋值路径修复（从 `from_save` / `derived_id` 正确传递）
- import 圆回测试：few-shot 导入的 `---` 分隔符解析修复，防止数据丢失
- `aggregateDegradeStats` 提升至组件顶层，避免条件式 hook 违规
- `CONTENT_SLOTS` 排除 `postStatus`/`publishedAt`/`mediaId` 等非 AI 字段，避免污染编辑信号

### Architecture

- Phase 2 迁移至 monorepo 结构 (`packages/extension/` + `@51publisher/shared`)
- `toastTimer` 类型修正为 `number | null`（WXT 浏览器环境兼容）

## [0.2.0] — 2026-06-09

### Features

- **自动抓取内容管线** (`feat/batch-reliability-ux`): acgs51 站点适配器 + 定时爬取调度器 + LLM 事实提取 (json_schema strict / json_object fallback) + SQLite pending 待审池
- **待审池 UI**: 内联事实编辑、封面缩略图、手动触发抓取按钮
- **提示工程升级**: 类别/标签约束注入、few-shot 样例对、recommendedTags 词汇表编辑器
- **填充改进**: cover_url 字段映射、checkbox substring fallback、分类自由文本 → 后端词汇表归一化
- **防幻觉加固**: 结构化生成 + 事实注入硬闸门，模型不能生成未提供链接
- **模型列表动态拉取**: 从 endpoint 获取可用模型，下拉选择

### Fixes

- **安全**: SSRF 关闭 credentials bypass (`http://evil@host/`) 和 protocol 降级攻击
- **安全**: `fetchAdapters` 客户端类型错误修复 (适配器名称现在正确传递)
- iframe 内嵌表单定位 (layuiAdmin 后台)
- 管理员 tab 按 host 定位而非 active tab

### Tests

- 覆盖率从 72% 提升至 ~87%
- 新增：fact-extractor fallback 路径、scraper-routes SSRF allowlist (含 credentials/protocol 向量)

## [0.1.0] — 2026-06-03

Initial release — Chrome MV3 extension + Fastify backend, batch publish with human approval gate.
