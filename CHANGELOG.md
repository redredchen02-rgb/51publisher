# Changelog

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
