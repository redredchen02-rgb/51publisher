# 51publisher

51acgs.com 漫画爬取 + AI 文章生成工具。包含 Chrome 扩展（前端爬取 + LLM 生成）和 Python 后端（批量爬取 + 数据管理）两部分。

## 架构

```
51publisher/
├── packages/
│   ├── extension/    # Chrome MV3 扩展（爬取 + AI 生成 + 数据浏览）
│   └── backend/      # Python 爬虫后端（批量爬取 + 导出）
├── scripts/          # 构建脚本
├── dist/             # 构建产物（gitignored）
└── docs/             # 计划文档
```

扩展与后端**无进程间通信**，各自独立运行，共享同一目标站 `51acgs.com`。

## 快速开始

### Chrome 扩展

1. 打开 `chrome://extensions/`，开启「开发者模式」
2. 点击「加载已解压的扩展程序」，选择 `packages/extension/`
3. 点击扩展图标 → 「API 设置」→ 填入 LLM API 地址和密钥
4. 侧边栏中点击「全量爬取」开始工作

### Python 后端

```bash
cd packages/backend
./setup.sh                 # 安装依赖 + 初始化数据库
./run.sh stats             # 查看状态
./run.sh scrape --all      # 全量爬取
```

> 可选：`export SCRAPER_BASE_URL=<url>` 覆盖爬取目标站（默认 `51acgs.com`，变量见 `.env.example`）。

## 功能

### 扩展（extension v3.0.0）

| 功能 | 说明 |
|------|------|
| 首页爬取 | 最新漫画列表 |
| 专题爬取 | 6 个子分类（hub/blog/anime_hub/anime_blog/novel_hub） |
| 详情爬取 | 漫画详情页 JSON-LD + HTML 双重解析 |
| 章节爬取 | 章节列表 + 图片 URL |
| AI 文章生成 | 基于漫画数据调用 LLM API 生成推荐文章 |
| 数据浏览 | 侧边栏查看/搜索/筛选/复制漫画、文章、章节数据 |
| 导出 | JSON 一键导出 + 复制全部 |
| 批量生成 | 批量调用 AI 为漫画生成文章 |

### 后端（backend v1.0.0）

| 功能 | 说明 |
|------|------|
| 全量爬取 | `--all` 一键爬取首页 + 专题 + 详情 + 章节 + 图片 URL |
| 增量更新 | `--incremental` 只爬取新条目 |
| 搜索爬取 | `--search "关键词"` 搜索并爬取 |
| 图片下载 | `download` 批量下载图片到本地（异步并发） |
| 导出 | JSON / CSV 格式，支持合并导出 |
| 数据库统计 | `stats` 查看各表数据量 |

## 命令参考

| 命令 | 说明 |
|------|------|
| `scrape --all` | 全量爬取（列表 + 详情 + 章节 + 图片 URL） |
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

## 构建与打包

```bash
npm run build          # 构建扩展 zip + 后端源码包到 dist/
npm run build:extension  # 仅构建扩展
npm run build:backend    # 仅构建后端
npm run clean            # 清理 dist/
npm run test:backend     # 运行后端测试
```

产物输出到 `dist/`（已 gitignored）：
- `extension-{version}.zip` — 可直接上传 Chrome Web Store 或解压加载
- `backend-{version}.tar.gz` — 后端源码包

## 项目结构

```
51publisher/
├── package.json                    # 根项目元数据 + 构建脚本
├── .gitignore
├── scripts/
│   ├── build-extension.sh          # 扩展打包脚本
│   └── build-backend.sh            # 后端打包脚本
├── packages/
│   ├── extension/                  # Chrome MV3 扩展
│   │   ├── manifest.json           # 扩展清单（版本源）
│   │   ├── background/
│   │   │   └── service-worker.js   # 后台爬取逻辑
│   │   ├── lib/
│   │   │   ├── db.js               # IndexedDB 存储层
│   │   │   └── llm.js              # LLM API 调用
│   │   ├── sidepanel/
│   │   │   ├── panel.html          # 侧边栏 UI
│   │   │   ├── panel.js            # 侧边栏逻辑
│   │   │   └── panel.css
│   │   ├── popup/                  # 弹出窗口
│   │   ├── settings/               # API 设置页
│   │   ├── icons/
│   │   └── tests/
│   └── backend/                    # Python 爬虫后端
│       ├── scraper/
│       │   ├── config.py           # 站点配置
│       │   ├── models.py           # SQLite 数据模型
│       │   ├── client.py           # HTTP 客户端（连接池 + 异步）
│       │   ├── exporters.py        # JSON/CSV 导出
│       │   ├── main.py             # CLI 入口
│       │   └── crawlers/           # 各页面解析器
│       │       ├── base.py         # 公共解析函数
│       │       ├── home.py         # 首页列表
│       │       ├── topics.py       # 专题列表 + 详情
│       │       ├── comics.py       # 漫画详情（JSON-LD）
│       │       ├── chapters.py     # 章节列表 + 图片 URL
│       │       └── search.py       # 搜索结果
│       ├── tests/                  # 51 个单元测试
│       ├── pyproject.toml          # 测试配置（pytest 路径）
│       ├── requirements.txt
│       ├── .env.example            # 配置模板（SCRAPER_BASE_URL）
│       ├── setup.sh                # 安装脚本
│       └── run.sh                  # 启动脚本
└── docs/
    └── plans/                      # 重构计划文档
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

| 层 | 技术 |
|----|------|
| 扩展 | Chrome MV3, JavaScript, IndexedDB, DOMParser |
| 后端 | Python 3.10+, httpx (异步 HTTP), BeautifulSoup4 + lxml (HTML 解析), SQLite (WAL 模式) |
| AI | OpenAI 兼容 API（可配置端点和密钥） |

## 开发

### 后端测试

```bash
cd packages/backend
python3 -m pytest -v          # 运行全部 51 个测试
python3 -m pytest -v tests/test_comics.py  # 运行指定测试文件
```

### 扩展开发

1. 修改 `packages/extension/` 中的代码
2. 在 `chrome://extensions/` 点击刷新按钮
3. 测试侧边栏和弹出窗口

### 代码规范

- Python: 遵循现有代码风格，最小化注释
- JavaScript: 使用 `.eslintrc.json` 配置
- Commit: 英文 commit message

## License

Private use only.
