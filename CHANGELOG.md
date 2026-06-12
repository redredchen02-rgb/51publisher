# Changelog

## [0.1.0] — 2026-06-12

### Changed

- **版本號統一**：所有 package 版本號重設為 0.1.0（原 0.5.0），CHANGELOG 版本格式統一為三段式
- **Backend 結構收斂**：重組為 config / middleware / routes / services / stores / scrapers / utils 分層目錄
- **index.ts 瘦身**：server 建構邏輯抽出至 `app.ts`，入口降至 ~20 行

## [0.5.0] — 2026-06-11

### Added

- **今日一键备稿**：在待审选题池点击「今日一键备稿」，自动抓取质量分最高的 top-3 选题直接生成批次草稿，全程无需手动选择
- **逐篇审读闸门**：批次审批前必须展开逐篇阅读每份草稿；已读进度实时显示「已读 N/M 篇」，未读完则发布按钮置灰
- **否决单条草稿**：审核面板新增「否决」按钮，可对单条草稿执行拒绝操作（`awaiting-approval → aborted`），不影响其他草稿
- **已发布帖子注册表**：每次成功发布后记录 `published_posts` 表，支持按 `source_title` 查询历史发布记录，防止重复发帖
- **发布健康监控**：revisit job 定期回查已发布帖子的在线状态（HTTP HEAD check），发现离线或删除时更新 `outcome` 并触发 Telegram 告警
- **内容抓取管线升级**：
  - 列表发现模式（`ACGS51_LIST_URL`）：适配器支持 `fetchList()` 批量抓取作品列表，单次 cron 周期最多发现 `ACGS51_LIST_BUDGET`（默认 20）条新选题
  - 质量分 API：选题池支持 `sort_by=score`（综合字段完整度 × 新鲜度衰减 × 已发布惩罚）和 `fold_threshold` 折叠低分选题
  - 结构化拒绝原因：`RejectionReason` enum 约束拒绝字段，防止自由文本污染
  - 重复检测：`source_url` 唯一索引，`savePendingTopic` 返回是否重复
- **Telegram 告警客户端**：抓取连续失败 3 次或健康监控异常时自动推送 Telegram 通知，支持 SSRF guard 和管理员域名脱敏
- **macOS launchd 自动启动**：`scripts/launchd/` 提供后端 daemon plist 及安装/卸载脚本，运行 `bash scripts/launchd/install.sh` 即可让后端开机自启
- **`/healthz` 健康检查端点**：无需鉴权，返回 `{ok:true}`，供 launchd 和监控探针使用
- **选题质量排序 API**：`GET /api/v1/pending-topics?sort_by=score&fold_threshold=0.5`

### Fixed

- **published-posts upsert 重复行**：`publish_url` 作为 upsert key 时，修复了使用新生成 id 而非现有记录 id 导致的重复行插入问题
- **ACGS51_LIST_URL 未传入 addSiteConfig**：`env-check` 校验通过但列表发现模式静默失效；现已正确写入站点配置
- **discardBatchItem 并发崩溃**：`handleDiscardBatchItem` 缺少 try/catch，并发 approveBatch 竞争时 Service Worker 会因未处理异常崩溃；现改为捕获异常并返回原批次

## [0.4.0.0] — 2026-06-11

### Added

- **AI 质量引擎 (Phase 3)**: 每条草稿生成后自动进行四维 AI 评审，不达标则定向重写，全程 fail-open 不阻断发布
  - 四维评审标准：内容丰富度、社区口吻、标题质量、分类准确性（内置中文提示，可在设置页覆盖）
  - 批次审核面板新增「✦ 已自评优化」badge，并在汇总行显示本批次优化条数
  - 设置页新增「AI 评审标准」文本框，留空使用内置四维标准，填写自定义标准即时生效
  - 评审/重写 token 用量独立记录于 `reviewCostTokens`，不计入生成用量
  - 轨迹记录新增 `aiReviewTriggered`（`undefined`=未触发/fail-open，`false`=通过，`true`=重写成功）
- **后端新路由**：`POST /api/v1/drafts/review` 和 `POST /api/v1/drafts/rewrite`，受 JWT 鉴权保护，LLM endpoint/key 固定于 env

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
