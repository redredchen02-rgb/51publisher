---
name: 51publisher 项目状态
description: 前端-后端分离进度、架构决策、待办
type: project
updated: 2026-06-10
expires: 2026-07-10
platform: universal
---

# 51publisher 项目状态

## 2026-06-10 止血→安全（计划 docs/plans/2026-06-10-002，分支 feat/batch-reliability-ux）

**已完成并本地提交（未推送，等运营者确认 GitHub 私有后推）：**
- **U1 抢救快照**：本地 commit `1958f08` + 分支 `rescue/wip-2026-06-10` 保全全部成果；`data/` 备份在 `~/51publisher-backups/`
- **U2 回退半成品 SQLite 迁移**：batch/prompt 改回 JSON store（pending/config 仍 SQLite），删 `*-store-sqlite.ts`、`scraper/migrations/db.ts`、迁移脚本；`index.ts` 去 `initAppDb`
- **U4 测试数据隔离**：store/db 读 `PUBLISHER_DATA_DIR`，vitest `src/test-setup.ts` 指向临时目录，测试不再清真实 `data/`
- **U3+U5 仓库卫生**：修扩展 4 个 tsc 错误；shared 加 `compile` 脚本；`*.tsbuildinfo`/coverage/logs 入 gitignore；`.env.example` 补 ACGS51_*；pre-push 密钥扫描 hook；`hash-password.mjs`
- **U6 fresh-clone 修复**：根因=被提交的 `tsconfig.tsbuildinfo` 让 composite 跳过 emit→shared dist 不生成；已修，干净 fresh clone install→build→compile→test 全绿（后端 109 / 扩展 315）。活跃 CI 是 `.github/workflows/ci.yml`（仓库已迁 GitHub，无 `.gitlab-ci.yml`）
- **U10 凭证安全**：scrypt+timingSafeEqual（`JWT_ADMIN_PASSWORD_HASH=salt:key`），启动 fail-closed 校验弱密钥，JWT 24h + HS256 钉死 + clockTolerance（auth-routes + auth-middleware）
- **U11 登录防护**：`/auth/login`+`/auth/status` 路由级限流 10/min；零依赖审计日志 `logs/auth-audit.log`（只记 time/ip/result，含 429 onExceeded）；`/api/v1/models` 移出 PUBLIC_ROUTES
- **U12 出站加固**：`ssrf-guard.ts` 解析后校验公网单播 IP + manual-redirect 逐跳校验，三 adapter 走 `safeFetch`；LLM endpoint 钉死到 env（去 `settings.endpoint` 回退）

**测试基线（2026-06-10）**：后端 109 通过、扩展 315 通过、workspace `pnpm -r compile` 全绿。

**待运营者动作（未做）：** 完整有序清单见 `docs/runbooks/first-flight-runbook.md`（2026-06-15 固化，严格有序：先 revoke 密钥→CORS→dry-run→真发→push）。
- **推送**：先确认 GitHub `redredchen02-rgb/51publisher` 私有 → `git push` feat 分支与 rescue 分支
- **U8/U14 首飞前轮换**：用 `hash-password.mjs` 生成 `JWT_ADMIN_PASSWORD_HASH`、换强 `JWT_SECRET`、轮换 LLM_API_KEY（probe-grounding.mjs 已从工作区消失，疑曾含 key，无条件轮换）；改 `.env` 后启动会 fail-closed 拒绝弱值
- **U9 首飞**：两条路径（手动+待审池）各 ≥1 篇真实发布，前台核验，首飞后再备份 data/
- **U13 CORS 收紧**：故意排在首飞成功后（避免归因困难），收紧需打包扩展真实请求实测

## 项目架构
- **Monorepo** (pnpm workspace): `packages/backend/` (Fastify 5 + TypeScript, port 3001) + `packages/extension/` (WXT + React 19 + MV3)
- 后端无 DB，全部文件 JSON 存在 `data/` 子目录下
- 所有 API 响应统一 `{ ok: true, ... }` / `{ ok: false, error: "..." }` 格式
- 认证: JWT (`jsonwebtoken`)，token 存 `chrome.storage.local` key `local:authToken`
- 失败闭合（fail-closed）：后端不可达时扩展继续使用本地状态

## 已完成（Waves 1-3）
- **Wave 1a** — Settings 清理：去掉 endpoint/model/apiKey UI，只留 promptTemplate/fewShotExamples/fieldMapping
- **Wave 1b** — 后端 JWT：`auth-routes.ts` (POST /api/v1/auth/login + GET /api/v1/auth/status) + `auth-middleware.ts` (requireAuth preHandler + PUBLIC_ROUTES)
- **Wave 1c** — 扩展 JWT：`auth-client.ts` (login/getToken/setToken/clearToken) + AuthView.tsx + 所有 fetch 调用注入 Authorization header
- **Wave 2** — 批次后端持久化：`batch-sync.ts` 双写包装（本地优先 → 后端最佳努力），`background.ts` 接入 withBackendSync(saveBatch)
- **Wave 3a** — 后端 Prompt 控制台：`prompt-store.ts` (data/prompts/ 下 JSON CRUD) + `prompt-routes.ts` (5 个 REST 端点)
- **Wave 3b** — 扩展 Prompt 管理：`prompt-client.ts` (fetchPrompts/createPrompt/updatePrompt) + Settings.tsx UI（加载列表/下拉选择/保存到后端）

## 关键决策
- 登录密码存 env `JWT_ADMIN_PASSWORD`，明文无哈希（MVP 单管理员）
- JWT_SECRET 从 env 自动读取，无 key rotation / refresh token
- 双写模式：本地存储是 PRIMARY（始终发生），后端同步是 SECONDARY（best-effort, fail-closed）
- Prompt ID 前缀: `prompt_` + 时间戳 + 随机后缀

## 验证数据（最后运行）
- Backend tsc: 零错误
- Extension tsc: 零新增错误（仅 4 个既有）
- Backend tests: 84/84 ✅
- Extension tests: 282/282 ✅
- Curl QA (prompt endpoints C1-C6): 全部通过

## 相关文件
- `packages/backend/src/auth-routes.ts` / `auth-middleware.ts` — JWT 认证
- `packages/backend/src/index.ts` — 所有路由注册
- `packages/backend/.env` — JWT_SECRET + JWT_ADMIN_PASSWORD
- `packages/extension/lib/auth-client.ts` — 认证客户端
- `packages/extension/lib/batch-sync.ts` — 批次双写
- `packages/extension/lib/prompt-client.ts` — Prompt API 客户端
- `packages/backend/src/scraper/prompt-store.ts` / `prompt-routes.ts` — Prompt 后端
- `packages/extension/entrypoints/sidepanel/Settings.tsx` — Prompt 管理 UI
- `packages/extension/entrypoints/sidepanel/App.tsx` / `AuthView.tsx` — 登录 UI
