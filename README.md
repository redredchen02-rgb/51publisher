# 51publisher 发帖填充助手

> **AI 生成草稿 → 人工审核 → 一键填入后台表单 → 人工决定发布**

Chrome 扩展 + 本地后端服务，辅助 51publisher 内容运营。大模型负责写口吻散文，事实（作品名/集数/连结）由系统从你提供的数据原样注入——模型碰不到事实，从流程上消灭编造。

---

## 核心设计原则

| 原则 | 实现方式 |
| --- | --- |
| **人工最终控制** | 插件只填充表单，绝不自动提交或点发布；发布动作必须由人工完成 |
| **防幻觉** | 模型只写口吻散文；作品名/集数/连结由程序从事实原样注入，模型碰不到 |
| **fail-closed** | 草稿含【待补】标记或连结非来源时，authorized 发布前硬闸拦截 |
| **XSS 防护** | LLM 返回的 HTML 写入编辑器前按白名单消毒 |

---

## 快速开始

**完整步骤见 [安装与使用指南](docs/install-and-usage.md)**，这里给三分钟速览。

### 1. 安装依赖

```bash
git clone <仓库地址> && cd 51publisher
git config core.hooksPath scripts/git-hooks   # 启用脱敏 pre-commit hook
pnpm install
```

### 2. 配置并启动后端

```bash
cp packages/backend/.env.example packages/backend/.env
# 编辑 .env，填入 LLM_API_KEY、JWT_SECRET 等必填项（endpoint 已预设）
pnpm dev:backend
```

> 启动成功验证：`curl http://127.0.0.1:3001/api/v1/healthz` 返回 `{"status":"ok"}`

### 3. 构建并加载扩展

```bash
pnpm build:extension
```

Chrome → `chrome://extensions` → 开启开发者模式 → 「加载已解压的扩展程序」→ 选 `packages/extension/.output/chrome-mv3/`

### 4. 首次配置

侧边栏右上角「⚙ 设置」，填写以下内容后保存：

| 项 | 填写内容 |
| --- | --- |
| **endpoint** | `https://la-sealion.inaiai.com/v1` |
| **模型** | `gemma4-31b-heretic`（或点「↻ 拉取模型列表」选择） |
| **API key** | 你在 la-sealion 平台的 API Key |

能成功拉到模型列表，说明配置正确。

---

## 工作流

```
输入选题(+ 事实)
      ↓
  AI 生成草稿          ← 模型只写口吻散文
      ↓
 系统注入事实          ← 作品名/集数/连结原样填入，模型碰不到
      ↓
  侧边栏审核卡         ← 查看事实注入状态、连结来源标注、硬闸预判
      ↓
  一键填充表单
      ↓
  人工核对 → 手动点发布
```

### 单条流程

1. 在 51publisher 后台打开「添加帖子」表单
2. 侧边栏输入主题 → 「生成草稿」
3. 预览区核对/修改内容；非 AI 字段（状态/发布时间/作品 id）可在折叠区手填
4. 「填充到当前页」→ 填充结果：绿=已填 / 黄=跳过 / 红=需手动粘贴
5. 人工在后台核对 → 手动点发布
6. 「下一条」清空当前草稿，继续

### 批量流程（推荐日常使用）

进入侧边栏 **≣ 批量** 视图：

**输入格式：** `选题 || 字段=值 | 字段=值`

```
住在拔作島上的我該如何是好介紹 || 作品名=住在拔作島上的我該如何是好 | 集数=2期 | 漢化=https://…
精靈寶可夢同人推薦 || 作品名=精靈寶可夢 | 题材=同人本 | 简介=莉莉艾/奇樹
某新番(只写选题，缺的事实标【待补】，AI 不会编造)
```

支持字段：`作品名` `集数` `制作` `漢化` `無修` `题材` `简介`（及别名 `name` `ep` `tags` `desc` 等）

**操作步骤：**

1. 输入选题列表 → 「开始批量（生成+填充）」；或点「今日一键备稿」自动取质量分最高的 top-3 选题
2. 批量视图展示批次状态：待审 / 发布中 / 已发布 / 失败
3. 展开每条草稿查看/编辑；**批准前须逐篇展开阅读**，面板底部显示「已读 N/M 篇」进度
4. 在设置页选择发布档位后批准

**发布档位：**

| 档位 | 行为 |
| --- | --- |
| `off` | 只填充，人工手动发布（默认） |
| `dry-run` | 预演全流程，不真发，输出 DryRunReport |
| `authorized` | 真实发布，需输入 `publish` 手势确认 |

> ⚠️ 强烈建议首次使用先跑 `dry-run` 预演，确认无误再切 `authorized`。**真实发布后无法自动撤回。**

---

## 功能一览

### 基础功能
- AI 生成帖子草稿（标题 + 简介 + 正文 + 标签）
- 批量生成与管理（待审 / 发布中 / 已发布 / 失败）
- 草稿自动恢复（侧边栏关闭/刷新不丢失）
- 历史记录查看（可校验发布链完整性）

### 审核保障
- 事实注入状态面板（每个字段标 ✓已注入 / —未提供）
- 连结来源标注（✓ 程序注入 / ✗ 非来源，异常即红标）
- 发布前硬闸预判（含【待补】或无来源连结则拦截）
- 选择器漂移自检（后台改版会被批准流程挡下）

### 高级功能
- **自动抓取选题**：定时从 51acgs.com 抓取作品，构建待审选题池，支持「今日一键备稿」
- **Web 搜索富化**：抓取后自动搜索补充作品信息，让草稿内容更丰富
- **质量门禁**：五维度评估（正文长度 ≥150 字 / 事实完整性 ≥50% / 标题无占位符 / 口语化口吻 / 标签 2-10 个）
- **Telegram 告警**：抓取连续失败或帖子健康异常时自动推送通知

---

## 安全与边界

- **不自动提交/发布**（硬约束）：除非显式切到 `authorized` 并打字确认；第三方平台一律只填充
- **防幻觉**：AI 只写口吻散文；作品名/集数/连结由程序 verbatim 注入，模型碰不到。`authorized` 发布前有硬闸（残留【待补】或无来源连结即拦截）
- **API key 安全**：明文存本地，只在 background service worker 里使用，绝不进入页面上下文，也不写入错误日志
- **XSS 防护**：LLM 返回的 HTML 写入 Quill 前，在隔离世界按白名单消毒（剥除 `<script>`/事件处理器/`javascript:` 等）

---

## 后端运维

### macOS 开机自动启动

```bash
pnpm build:backend
bash scripts/launchd/install.sh      # 注册 launchd daemon，开机自启
# 卸载：
bash scripts/launchd/uninstall.sh
```

日志：`/tmp/51publisher-backend.log`。健康检查：`GET /api/v1/healthz`（无需鉴权）。

### Telegram 告警

在 `packages/backend/.env` 中配置：

```bash
TG_ENABLED=true
TG_BOT_TOKEN=<@BotFather 生成的 token>
TG_CHAT_ID=<你的 chat id>
```

---

## 项目结构

```
51publisher/
├── packages/
│   ├── extension/          # Chrome 扩展（WXT + React 19 + Manifest V3）
│   │   ├── entrypoints/
│   │   │   ├── background.ts           # Service Worker：调 LLM、发布闸门
│   │   │   ├── content.ts              # 隔离世界：表单填充
│   │   │   ├── quill-bridge.content.ts # 主世界：写入 Quill 编辑器
│   │   │   └── sidepanel/              # React UI：草稿/批量/设置/历史
│   │   └── lib/                        # 核心逻辑（fillers、assembler、gate…）
│   ├── backend/            # Fastify 5 + TypeScript，端口 3001
│   │   └── src/
│   │       ├── *-routes.ts             # 按模块分文件的路由
│   │       └── scraper/                # 选题抓取管线
│   └── shared/             # 跨端共享类型与纯逻辑
└── docs/                   # 详细文档
```

---

## 常用命令

```bash
# 开发
pnpm dev:extension          # 扩展热更新
pnpm dev:backend            # 后端热更新

# 构建
pnpm build:extension        # 产出 packages/extension/.output/chrome-mv3/
pnpm build:backend          # 产出 packages/backend/dist/

# 测试与检查
pnpm test                   # 全包单元测试（vitest）
pnpm compile                # 全包 tsc 类型检查
pnpm lint                   # biome 格式化
bash scripts/check-all.sh   # 测试 + 双端构建 + 产物校验（提交前跑）
```

扩展专属：

```bash
cd packages/extension
pnpm test:e2e               # e2e：本地 fixture + 真实 Quill
pnpm check:fixtures         # 脱敏闸门（pre-commit 自动跑）
```

---

## 已知局限

- 仅适配 51publisher 当前后台（Quill 2.0.2 + layui 弹层表单）；后台大改需改代码，见 [`docs/field-mapping-guide.md`](docs/field-mapping-guide.md) 的 Tier 分级
- 仅支持 Chromium 内核浏览器，Firefox 不支持
- 封面图需人工上传（MVP 不自动填）
- authorized 模式真发后无法自动撤回

---

## 文档索引

| 文档 | 内容 |
| --- | --- |
| [安装与使用指南](docs/install-and-usage.md) | 完整安装、配置、使用流程、常见问题 |
| [批量使用指南](docs/batch-usage-guide.md) | 批量流程详细说明 |
| [Dry-run 策略](docs/dry-run-strategy.md) | 预演模式使用说明 |
| [字段映射指南](docs/field-mapping-guide.md) | 后台改版时如何更新选择器 |
| [自动生成指南](docs/auto-generate-guide.md) | 自动抓取选题与批量生成 |
| [e2e 与 fixture 指南](docs/e2e-and-iteration-guide.md) | 测试架构、后台漂移修复流程 |
