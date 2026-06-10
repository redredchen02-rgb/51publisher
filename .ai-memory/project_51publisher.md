---
name: 51publisher 项目状态
description: 前端-后端分离进度、架构决策、待办
type: project
updated: 2026-06-08
expires: 2026-07-08
platform: universal
---

# 51publisher 项目状态

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
