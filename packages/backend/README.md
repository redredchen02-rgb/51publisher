# 51acgs Scraper

51acgs.com 漫画/文章批量爬取工具，为代审池提供数据源。

## 功能

- 首页最新漫画列表爬取
- 专题文章列表爬取（支持翻页）
- 漫画详情页爬取（JSON-LD + HTML 双重解析）
- 章节列表 + 图片 URL 爬取
- 图片批量下载（异步并发）
- 增量更新模式
- JSON/CSV 导出

## 快速开始

```bash
# 安装依赖 + 初始化数据库
./setup.sh

# 查看状态
./run.sh stats

# 可选：覆盖爬取目标站（默认 51acgs.com）。run.sh 会自动加载 .env：
cp .env.example .env   # 然后编辑 .env 改 SCRAPER_BASE_URL
```

## 命令参考

| 命令 | 说明 |
|------|------|
| `scrape --all` | 全量爬取（列表 + 详情 + 章节） |
| `scrape --all --incremental` | 增量更新（仅新条目） |
| `scrape --all --pages 3` | 翻页爬取专题 |
| `scrape --source home` | 仅爬首页最新 |
| `scrape --source topics` | 仅爬专题文章 |
| `scrape --source comics` | 仅爬漫画详情 |
| `scrape --source chapters` | 爬取章节列表 |
| `scrape --source pages` | 爬取图片 URL |
| `scrape --search "NTR"` | 搜索并爬取 |
| `download --limit 500` | 下载图片到本地 |
| `export --format json --combined` | 导出合并 JSON |
| `export --format csv` | 导出 CSV |
| `list --source comics` | 列出漫画 |
| `list --source articles` | 列出文章 |
| `stats` | 查看数据库统计 |

## 项目结构

```
backend/
├── scraper/
│   ├── __init__.py
│   ├── config.py          # 站点配置
│   ├── models.py          # SQLite 数据模型
│   ├── client.py          # HTTP 客户端（连接池 + 异步）
│   ├── exporters.py       # JSON/CSV 导出
│   ├── main.py            # CLI 入口
│   └── crawlers/
│       ├── base.py        # 公共解析函数
│       ├── home.py        # 首页列表
│       ├── topics.py      # 专题列表 + 详情
│       ├── comics.py      # 漫画详情（JSON-LD）
│       ├── chapters.py    # 章节列表 + 图片 URL
│       └── search.py      # 搜索结果
├── data/
│   ├── scraper.db         # SQLite 数据库
│   └── images/            # 下载的图片
│       └── {comic_id}/{chapter_id}/*.jpeg
├── tests/                 # 51 个单元测试
├── exports/               # 导出文件
├── pyproject.toml         # 测试配置（pytest 路径）
├── requirements.txt
├── .env.example           # 配置模板（SCRAPER_BASE_URL）
├── setup.sh               # 安装脚本
├── run.sh                 # 启动脚本
├── README.md
└── CHANGELOG.md
```

## 数据字段

### 漫画 (comics)

| 字段 | 覆盖率 | 说明 |
|------|--------|------|
| title | 100% | 标题 |
| author | 100% | 作者 |
| tags | 100% | 标签 |
| categories | 99% | 分类 |
| chapter_count | 100% | 章节数 |
| publish_date | 100% | 发布日期 |
| update_date | 100% | 更新日期 |
| status | 100% | 状态（连载/完结/未知） |
| bookmark_count | 99% | 收藏数 |
| view_count | 99% | 观看数 |

### 文章 (articles)

| 字段 | 说明 |
|------|------|
| title | 标题 |
| summary | 摘要 |
| article_type | 类型（hub/blog/anime_hub/anime_blog/novel_hub） |
| tags | 标签 |

## 技术栈

- Python 3.10+
- httpx（HTTP 客户端，支持异步）
- BeautifulSoup4 + lxml（HTML 解析）
- SQLite（数据存储）

## License

Private use only.
