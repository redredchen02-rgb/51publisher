# Changelog

## [1.0.0] - 2026-06-17

### Added
- 首页最新漫画列表爬取
- 专题文章列表爬取（支持 6 个子分类翻页）
- 漫画详情页 JSON-LD 结构化数据解析
- 详情页 HTML 补充提取（作者、状态、观看量、章节数）
- 章节列表爬取
- 章节图片 URL 提取
- 图片批量下载（异步并发，Semaphore 控制）
- 增量更新模式（`--incremental`）
- 搜索结果爬取（支持翻页）
- JSON/CSV 导出（支持合并导出）
- SQLite 数据存储（WAL 模式）
- HTTP 连接池复用
- 异步并发爬取（默认 3 并发）
- CLI 命令行工具

### Data Quality
- 漫画字段覆盖率：author 100%, tags 100%, categories 99%, status 100%, bookmark_count 99%
- 文章字段覆盖率：title 100%, summary 100%, tags 100%

### Fixed
- upsert_comic 使用 COALESCE 保护已有详细数据，防止首页重爬覆盖
- 漫画状态提取支持"连载"/"完结"/"未知"三种状态
- 匿名作者（佚名）正确提取
- tags/categories 覆盖率从 20% 提升到 100%

### Optimized
- HTTP 客户端改为连接池复用，减少 TCP 握手开销
- 异步限速修正，3 并发真正并行执行
- 搜索结果支持翻页
- `--all` 默认包含 `--details`
- 导出同时生成 `latest.json` 快捷文件

### Infrastructure
- 添加 schema_version 表，支持数据库 schema 版本追踪
- init_db() 现在支持增量迁移，避免重复执行 DDL

## [0.1.0] - 2026-06-17 (初始版本)

### Added
- 基础爬虫框架
- 首页/专题/搜索列表爬取
- 漫画详情页 CSS 选择器解析
- SQLite 数据存储
- JSON/CSV 导出
- CLI 命令行工具
