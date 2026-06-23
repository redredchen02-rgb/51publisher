# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

51publisher 发帖填充助手:AI 生成帖子草稿 → 人工预览/编辑 → 一键填入 51publisher 后台发帖表单。pnpm monorepo,三个包:

- `packages/extension/` — Chrome 扩展(WXT + React 19 + Manifest V3),仅支持 Chromium
- `packages/backend/` — Fastify 5 + TypeScript,端口 3001(JWT 鉴权、批次同步、抓取/选题管线)
- `packages/shared/` — 跨端共享类型与纯逻辑(field-mapping、post-assembler、vocab、facts)

仓库 remote 是 **GitHub**(github.com/redredchen02-rgb/51publisher);活跃 CI 是 `.github/workflows/`(`ci.yml` push/PR 真闸、`release.yml` `v*` tag)。根目录无 `.gitlab-ci.yml`。`scripts/check-all.sh` 存在(lint:ci + 测试 + 双端 build + 产物校验)。

会话开始时读 `.ai-memory/*.md` 获取前序会话的项目状态与经验(见 AGENTS.md)。

## 常用命令

```bash
pnpm install                      # 安装依赖
git config core.hooksPath scripts/git-hooks   # 一次性:启用 pre-commit/pre-push hook(clone 后不会自动生效)

pnpm dev:extension                # 扩展开发(热更新);dev:backend 同理
pnpm build:extension              # 产出 packages/extension/.output/chrome-mv3/
pnpm compile                      # 全包 tsc 类型检查(拓扑顺序,shared 先 emit dist)
pnpm test                         # 全包单测(vitest)
pnpm lint                         # biome check --write;CI 用 pnpm lint:ci
bash scripts/check-all.sh         # 测试 + 双端构建 + 产物校验
```

扩展专属(在 `packages/extension/` 下或加 `--filter @51publisher/extension`):

```bash
pnpm test:e2e                     # e2e:本地 fixture + 真 Quill 2.0.2(独立 vitest.e2e.config.ts)
pnpm check:fixtures               # 脱敏闸门:扫 fixture 是否夹带机密(pre-commit 自动跑)
npx vitest run lib/fillers.test.ts            # 跑单个测试文件
npx vitest run -t "测试名"                     # 按名称过滤
```

**构建顺序**:`@51publisher/shared` 必须先 build 出 `dist/` 才能对 backend/extension 做类型检查。`pnpm -r compile` / `pnpm -r test` 已按拓扑序处理;单独操作某包前若报 shared 类型缺失,先 `pnpm --filter @51publisher/shared build`。

后端环境:复制 `packages/backend/.env.example` → `.env`。后端 **fail-closed**:`CORS_ORIGIN` 缺失或为 `*`、`JWT_SECRET`/`JWT_ADMIN_PASSWORD_HASH` 弱值/占位值时拒绝启动。生成强值的命令见 AGENTS.md 或 `.env.example` 注释。

## 架构

### 扩展:三世界模型(核心)

填充目标页的 `window.Quill` 只在页面主世界可见,扩展逻辑因此拆成三个执行环境,通过消息桥接:

- `entrypoints/background.ts` — service worker,调度中心 + **发布闸门**。路由 `GENERATE_DRAFT`(调 LLM,API key 只在此处,绝不进 content)和 `PUBLISH_PAGE`(闸门求值,host 取自 `chrome.tabs.get`,仅授权才发 grant)
- `entrypoints/content.ts` — 隔离世界 content script,接收 `FILL_PAGE` 执行填充;**绝不自我授权**,无 background 的一次性 `PUBLISH_GRANT` 即从不提交
- `entrypoints/quill-bridge.content.ts` — 主世界 content script,唯一能访问 `window.Quill` 的地方;逻辑在 `lib/body-responder.ts`(供 e2e 复用),经 `lib/body-bridge.ts` 与隔离世界通信
- `entrypoints/sidepanel/` — React UI(单条/批量视图、设置、历史)

⚠️ **注入面 = 闸门面,三处必须同步改**:`content.ts` 的 matches、`quill-bridge.content.ts` 的 matches、`wxt.config.ts` 的 `host_permissions`(当前均为 `https://dx-999-adm.ympxbys.xyz/*`)。

改 content script 后须在 `chrome://extensions` 重载扩展 **并刷新目标页**,否则旧脚本仍驻留。

### 安全闸门链(改动前必读)

- **零提交硬约束(第三方平台)**:插件只填充,绝不自动提交/点发布/派发回车。由 `lib/fillers.ts` 的零提交测试守护(填充后 `<form>` submit 计数必须为 0)。自家授权站点已定向解除(见下)
- **发布档位**(`lib/safety-gate.ts`):`off`(只填充)/ `dry-run`(预演,出 DryRunReport)/ `authorized`(真发布,需 `publish` 手势确认 + host 在授权清单)
- **防幻觉(程序化结构化生成)**:模型只写口吻散文槽位;作品名/集数/链接由 `shared/post-assembler.ts` 从操作者事实 verbatim 注入,模型碰不到。`lib/grounding-gate.ts` 是 authorized 发布前的硬闸(残留【待补】或无来源链接即拦)
- **XSS 消毒**:正文 HTML 来自 LLM(最不可信输入),写入 Quill 前在隔离世界经 `lib/sanitize.ts` 白名单消毒
- **发布编排**:`lib/publish-orchestrator.ts`(单条闸门求值)、`lib/batch-orchestrator.ts`(批量生成+填充+审批+重试+隔离区)

### 后端

- 路由按模块分文件 `src/routes/*-routes.ts`,在 `index.ts` 统一 `register*Routes(server)`;JWT 鉴权 preHandler,`PUBLIC_ROUTES` 白名单放行
- 存储双轨:batch/prompt 用 JSON 文件存储,pending/config 用 SQLite(better-sqlite3)。均读 `PUBLISHER_DATA_DIR`;vitest 经 `src/test-setup.ts` 指向临时目录,测试不碰真实 `data/`
- `src/scraper/` — 选题抓取管线:站点 adapter(`adapters/`)、SSRF 守卫(`ssrf-guard.ts`,allowlist fail-closed)、cron 调度器(需 `ACGS51_ENABLED=true` + LLM 配置齐全才启动)
- 扩展对后端的调用统一走 `authHeaders()` + 401 时 `clearToken()` 模式;批次双写用 `withBackendSync(localSave)` 包装

### 字段映射与后台漂移

字段选择器集中在 `shared/src/field-mapping.ts`,现场勘查记录在 `docs/field-mapping-guide.md`(含 Tier 分级:A 只改 config / B 改 fillers / C 改架构)。后台是 layui 弹层表单(动态插入)+ vanilla Quill 2.0.2。**填充是 frame-agnostic**:经 `lib/frame-resolve.ts` 顶层优先、找不到则下钻同源 iframe(2026-06-10 勘查:发帖表单实际在 layuiAdmin 同源子 iframe 内,顶层查询必然落空,详见 `docs/field-mapping-guide.md`);勿再假设「一定在顶层」。

## e2e 与 fixture(改动 fixture 前必读)

详见 `docs/e2e-and-iteration-guide.md`。要点:

- e2e 跑在本地**脱敏 fixture**(`tests/e2e/fixtures/webarticle-add.html`)+ 真 Quill 上,只证明「对快照那一刻的结构」填充正确;后台漂移是**被动发现**(填充失效 → 重抓 → contract 测试红 → 修)
- fixture 的 `submit=0` 只证明填充逻辑本身不提交;真后台动态 handler 只能靠人工冒烟兜底
- **重抓 fixture 是接触真后台登录态的高危操作**:原始 dump 存仓库外 scratch 路径 → 按 allowlist 脱敏(剥 hidden value/token/真实数据)→ `pnpm check:fixtures` 绿 → 才覆盖 fixture → 删 scratch 产物。pre-commit hook 强制把关

## 迭代节奏

```
快循环(平时):改代码 → pnpm test → pnpm test:e2e → pnpm compile → 全绿才提交
慢循环(后台改版):重抓快照(含脱敏)→ 看 contract 哪个选择器红 → 改 field-mapping/fillers → 人工冒烟 → 更新 field-mapping-guide
```

## 仓库约定

- 实施计划放 `docs/plans/`,命名 `YYYY-MM-DD-NNN-<type>-<slug>-plan.md`;已解决问题沉淀到 `docs/solutions/`
- 代码注释与文档用中文,commit message 用英文
- Lint/format 用 biome(tab 缩进、双引号);扩展包内另有 prettier 的 `format` 脚本,以根目录 biome 为准
