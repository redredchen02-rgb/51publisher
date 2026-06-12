# Changelog

## [0.1.0] — 2026-06-12

First release. Chrome MV3 extension + Fastify 5 backend, batch publish with human approval gate.

### Added

- **今日一键备稿**：在待审选题池点击「今日一键备稿」，自动抓取质量分最高的 top-3 选题直接生成批次草稿，全程无需手动选择
- **逐篇审读闸门**：批次审批前必须展开逐篇阅读每份草稿；已读进度实时显示「已读 N/M 篇」，未读完则发布按钮置灰
- **否决单条草稿**：审核面板新增「否决」按钮，可对单条草稿执行拒绝操作（`awaiting-approval → aborted`），不影响其他草稿
- **已发布帖子注册表**：每次成功发布后记录 `published_posts` 表，支持按 `source_title` 查询历史发布记录，防止重复发帖
- **发布健康监控**：revisit job 定期回查已发布帖子的在线状态（HTTP HEAD check），发现离线或删除时更新 `outcome` 并触发 Telegram 告警
- **内容抓取管线**：acgs51 站点适配器 + 定时爬取调度器 + LLM 事实提取 + SQLite pending 待审池
  - 列表发现模式（`ACGS51_LIST_URL`）：适配器支持 `fetchList()` 批量抓取作品列表
  - 质量分 API：选题池支持 `sort_by=score` 和 `fold_threshold` 折叠低分选题
- **AI 质量引擎**：每条草稿生成后自动进行四维 AI 评审（内容丰富度、社区口吻、标题质量、分类准确性），不达标则定向重写
- **Telegram 告警客户端**：抓取连续失败或健康监控异常时自动推送 Telegram 通知
- **macOS launchd 自动启动**：`scripts/launchd/` 提供后端 daemon plist 及安装/卸载脚本
- **待审池 UI**：内联事实编辑、封面缩略图、手动触发抓取按钮
- **提示工程升级**：类别/标签约束注入、few-shot 样例对、recommendedTags 词汇表编辑器
- **防幻觉加固**：结构化生成 + 事实注入硬闸门，模型不能生成未提供链接
- **模型列表动态拉取**：从 endpoint 获取可用模型，下拉选择
- **发布后质量追踪**：degrade-stats 批次退化统计、draft-diff AI vs 人工差异检测、FewShotPairEditor 编辑器

### Changed

- **版本號統一**：所有 package 版本號統一為 0.1.0，monorepo 結構 (`packages/extension/` + `packages/backend/` + `@51publisher/shared`)
- **Backend 結構收斂**：重組為 config / middleware / routes / services / stores / scrapers / utils 分層目錄，index.ts 瘦身至 ~20 行

### Fixed

- **published-posts upsert 重复行**：`publish_url` 作为 upsert key 时 id 冲突问题
- **discardBatchItem 并发崩溃**：`handleDiscardBatchItem` 缺少 try/catch 导致 Service Worker 崩溃
- **ACGS51_LIST_URL 未传入 addSiteConfig**：列表发现模式静默失效
- **SSRF 安全加固**：关闭 credentials bypass 和 protocol 降级攻击
- `urlSource` 赋值路径修复、few-shot 导入分隔符解析修复
- iframe 内嵌表单定位、管理员 tab host 定位

### Security

- JWT 鉴权（HS256 + 24h 过期）+ fail-closed 启动校验
- SSRF 防护：DNS 解析校验、redirect hop 验证、host allowlist
- XSS 防护：DOMPurify 消毒正文 HTML
- 密钥隔离：API key 仅存 chrome.storage.local
- pre-commit 脱敏闸门 + pre-push 密钥扫描

### Infrastructure

- CI 从 GitLab 迁移至 GitHub Actions
- Docker 多阶段构建优化（仅生产依赖）
- Release 自动化：tag push 触发 GitHub Release，附带扩展 .zip 和 Docker 镜像
