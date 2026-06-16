---
title: "refactor: Remove gossip pipeline, focus on anime workflow"
type: refactor
status: active
date: 2026-06-16
---

# refactor: Remove gossip pipeline, focus on anime workflow

## Overview

删除项目中的「吃瓜/娱乐八卦」内容管线，保留并聚焦动漫（ACG）工作流。gossip 管线与 ACG 核心逻辑完全正交，可干净剔除：删除约 600 行代码 + 对应测试，简化 `pending_topics` 表的 `domain` 枚举约束。

## Problem Frame

51publisher 是动漫站点的发帖助手（目标分类：漫畫文章 / 動漫文章）。但代码库中存在一条独立的八卦/娱乐新闻管线（gossip pipeline），包括：选题存储、LLM 提取器、专用 API 路由、扩展客户端。这条管线：
- 不服务于动漫工作流
- 与 ACG scraper/adapters 完全独立
- 增加代码复杂度和维护负担

## Requirements Trace

- R1. 删除所有 gossip 相关源文件（shared / backend / extension）
- R2. 从 `pending-store` / `pending-routes` / `app.ts` 中移除 `gossip` 分支和联合类型
- R3. 删除 DB migration `008-add-domain.sql`，并新增一个清理 migration 还原 `domain` 列（或直接去掉该列）
- R4. 全部测试继续绿（无遗留 gossip import / 无编译错误）
- R5. 不改动动漫核心路径：`acgs51-adapter`、`fact-extractor`、`web-enricher`、填充逻辑

## Scope Boundaries

- **不做**：重命名 `pending_topics` 表或改动 ACG schema
- **不做**：修改 LLM 提示词（动漫侧）
- **不做**：改动 `TODOS.md` 以外的文档（README/AGENTS.md 若无 gossip 提及则不动）

## Context & Research

### Gossip 管线文件清单（待删除）

**packages/shared/src/**
- `gossip-facts.ts` — `GossipFactsBlock` 类型 + `GOSSIP_FACTS_SCHEMA`
- 从 `index.ts` 中移除对应 export

**packages/backend/src/scraper/**
- `gossip-site-store.ts` + `gossip-site-store.test.ts`
- `gossip-fact-extractor.ts` + `gossip-fact-extractor.test.ts`

**packages/backend/src/routes/**
- `gossip-routes.ts` + `gossip-routes.test.ts`

**packages/extension/lib/**
- `gossip-client.ts` + `gossip-client.test.ts`

### 需要改动（移除 gossip 分支，保留 ACG）

**packages/backend/src/**
- `app.ts` — 删除 `import { registerGossipRoutes }` 及注册调用
- `scraper/pending-store.ts` — `domain` 字段类型从 `"acg" | "gossip"` → 仅 `"acg"`（或直接删掉 domain 字段，因为只有一种）
- `scraper/pending-store.test.ts` — 移除 gossip 相关测试分支
- `routes/pending-routes.ts` — 移除 `domain` 过滤参数中的 `gossip` 选项
- `migrations/008-add-domain.sql` — 此 migration 引入了 gossip domain；需决策：新增 `009-remove-gossip-domain.sql` 清理，或回滚（见 Key Decisions）

**packages/extension/lib/**
- `pending-client.ts` — 移除 `domain?: "acg" | "gossip"` 字段

## Key Technical Decisions

- **Migration 策略**：保留 `008-add-domain.sql`（已在生产 DB 执行），新增 `009-remove-gossip-domain.sql`，将 `domain` CHECK 约束从 `('acg','gossip')` 改为 `('acg')`，并删除所有 `domain='gossip'` 行。理由：向后兼容，不破坏已有 DB 文件；若 domain 列最终无用可在后续 migration 删除整列。
- **`domain` 字段去留**：保留 `domain='acg'` 但简化为隐式默认值（类型层面去掉 `"gossip"` 分支），等价于「只有一种 domain」，后续可在另一次 refactor 完全删除该列。
- **不改 ACG pipeline**：`auto-generate.ts` 中已有 `domain='acg'` 过滤注释（「避免混入 gossip」），删除 gossip 后该过滤器仍可留着（无害），无需修改。

## Open Questions

### Resolved During Planning

- **Q：`migration 008` 已在生产执行，能直接删文件吗？** A：不能删。用 `009` migration 收尾（收紧 CHECK 约束 + 清理 gossip 行）。
- **Q：`pending-store` 的 `domain` 字段是否完全删除？** A：本次只收紧类型（`"acg"` only），不删列——减少 migration 风险，后续可再删。

### Deferred to Implementation

- 若 `domain` 列完全无用时（只剩 `'acg'`），可考虑在下一个 sprint 彻底删列。本计划不做。

## Implementation Units

- [ ] **Unit 1: 删除 shared/gossip-facts.ts 并清理 shared/index.ts**

**Goal:** 从共享包移除 GossipFactsBlock 类型定义，断掉下游 import 链的源头

**Requirements:** R1, R4

**Dependencies:** 无

**Files:**
- Delete: `packages/shared/src/gossip-facts.ts`
- Modify: `packages/shared/src/index.ts`（移除两条 gossip export）

**Approach:**
- 删除文件后 `pnpm --filter @51publisher/shared build` 确认 shared 编译通过
- `index.ts` 中移除第 30-31 行的两条 gossip export

**Test scenarios:**
- Happy path: `pnpm --filter @51publisher/shared build` 无报错，dist 中无 GossipFactsBlock 类型

**Verification:**
- `grep -r "GossipFactsBlock\|GOSSIP_FACTS_SCHEMA" packages/shared/src` 返回空

---

- [ ] **Unit 2: 删除 backend scraper 中的 gossip 文件**

**Goal:** 移除 gossip-site-store 和 gossip-fact-extractor（含测试）

**Requirements:** R1

**Dependencies:** Unit 1（gossip-fact-extractor import 了 shared 的 GossipFactsBlock）

**Files:**
- Delete: `packages/backend/src/scraper/gossip-site-store.ts`
- Delete: `packages/backend/src/scraper/gossip-site-store.test.ts`
- Delete: `packages/backend/src/scraper/gossip-fact-extractor.ts`
- Delete: `packages/backend/src/scraper/gossip-fact-extractor.test.ts`

**Approach:**
- 删除后检查 `packages/backend/src/scraper/index.ts` 有无 re-export gossip 模块，若有则移除

**Test scenarios:**
- Happy path: `pnpm --filter "@51publisher/backend" compile` 无 gossip 相关 import 错误

**Verification:**
- `grep -r "gossip" packages/backend/src/scraper/` 返回空

---

- [ ] **Unit 3: 删除 backend gossip-routes 并从 app.ts 解绑**

**Goal:** 移除 gossip API 路由，`app.ts` 不再注册 gossip 路由

**Requirements:** R1, R2

**Dependencies:** Unit 2

**Files:**
- Delete: `packages/backend/src/routes/gossip-routes.ts`
- Delete: `packages/backend/src/routes/gossip-routes.test.ts`
- Modify: `packages/backend/src/app.ts`（删除 import + `registerGossipRoutes(app)` 调用）

**Approach:**
- `app.ts` 第 13 行 `import { registerGossipRoutes }` 删除
- 找到 `registerGossipRoutes(app)` 调用行删除

**Test scenarios:**
- Happy path: `pnpm --filter "@51publisher/backend" compile` 通过
- Integration: `GET /api/v1/gossip/...` 返回 404（路由不再存在）

**Verification:**
- `grep -n "gossip" packages/backend/src/app.ts` 返回空

---

- [ ] **Unit 4: 清理 pending-store 和 pending-routes 的 gossip 分支**

**Goal:** 简化 `domain` 类型为 `"acg"` only，移除 `GossipFactsBlock` 联合类型

**Requirements:** R2, R4

**Dependencies:** Unit 1

**Files:**
- Modify: `packages/backend/src/scraper/pending-store.ts`
- Modify: `packages/backend/src/scraper/pending-store.test.ts`
- Modify: `packages/backend/src/routes/pending-routes.ts`

**Approach:**
- `PendingTopic.facts`: `FactsBlock | GossipFactsBlock` → `FactsBlock`（删除联合类型）
- `PendingTopic.domain`: `"acg" | "gossip"` → `"acg"`（或改为可选字面量，值固定 `'acg'`）
- `pending-store.ts:84`：`domain === "gossip" ? "gossip" : "acg"` → 直接 `"acg"`
- `pending-store.ts:261`：`domain?: "acg" | "gossip"` → `domain?: "acg"`
- `pending-routes.ts`：删除 `domain=gossip` 的过滤选项

**Test scenarios:**
- Happy path: `pending-store.test.ts` 全绿，无 gossip 相关用例
- Error path: 如有测试传入 `domain: "gossip"` 则删除或修改为 `"acg"`

**Verification:**
- `grep -n "gossip" packages/backend/src/scraper/pending-store.ts` 返回空
- `pnpm --filter "@51publisher/backend" test` 全绿

---

- [ ] **Unit 5: 删除 extension 的 gossip-client，清理 pending-client**

**Goal:** 移除扩展侧的 gossip API 客户端，从 pending-client 移除 gossip domain 字段

**Requirements:** R1, R2

**Dependencies:** Unit 4

**Files:**
- Delete: `packages/extension/lib/gossip-client.ts`
- Delete: `packages/extension/lib/gossip-client.test.ts`
- Modify: `packages/extension/lib/pending-client.ts`（移除 `domain?: "acg" | "gossip"` 字段）

**Approach:**
- `pending-client.ts` 第 25 行和第 34 行的 `domain?: "acg" | "gossip"` 改为 `domain?: "acg"` 或直接删除（若调用方从不传）
- 检查 `__test-utils__/mock-fetch.ts` 中的 gossip 引用，清理

**Test scenarios:**
- Happy path: `pnpm --filter "@51publisher/extension" test` 全绿
- Verify: gossip-client 相关 import 在扩展中不存在

**Verification:**
- `grep -rn "gossip" packages/extension/lib/` 返回空

---

- [ ] **Unit 6: 新增 migration 009 清理 gossip domain 数据**

**Goal:** 生产 DB 中收紧 `domain` 列约束，清除已有 gossip 行

**Requirements:** R3

**Dependencies:** Unit 4（逻辑层先清干净，再做 DB migration）

**Files:**
- Create: `packages/backend/src/migrations/009-remove-gossip-domain.sql`
- Verify: `packages/backend/src/migrations/runner.ts`（确认自动跑新 migration）

**Approach:**
```sql
-- 删除所有 gossip domain 选题
DELETE FROM pending_topics WHERE domain = 'gossip';
-- SQLite 不支持 ALTER COLUMN，用重建表方式收紧 CHECK 约束（可选）
-- 若成本过高，本 migration 只做 DELETE，CHECK 约束变更留后续
```
- 评估 SQLite 是否支持直接修改 CHECK 约束（通常需重建表）；若成本高，本次只做 `DELETE`，CHECK 约束重建留 010

**Test scenarios:**
- Happy path: 执行 migration 后 `SELECT COUNT(*) FROM pending_topics WHERE domain='gossip'` = 0
- Edge case: 空 DB 时 migration 无报错

**Verification:**
- `runner.ts` 在启动时自动执行 009，日志显示 migration applied

---

- [ ] **Unit 7: 全量验证 + 清理文档引用**

**Goal:** 确认整个 monorepo 编译/测试全绿，清理文档中的 gossip 提及

**Requirements:** R4, R5

**Dependencies:** Unit 1–6

**Files:**
- Verify: `packages/shared/`, `packages/backend/`, `packages/extension/`（全量 compile + test）
- Modify: `docs/` 文档中如有 gossip 提及则移除（TODOS.md、README.md 等）
- Modify: `CLAUDE.md` 如有 gossip 提及则移除

**Test scenarios:**
- Happy path: `bash scripts/check-all.sh` 全绿
- Happy path: `grep -r "gossip" packages/` 返回空（dist/ 除外）

**Verification:**
- CI 绿（lint + compile + test + build）

## System-Wide Impact

- **Unchanged invariants:** ACG scraper pipeline（`acgs51-adapter`、`fact-extractor`、`web-enricher`）完全不动；`pending_topics` 表结构保留（只是收紧 CHECK 约束）
- **API surface:** `/api/v1/gossip/*` 路由全删，其余路由不变
- **DB:** `pending_topics.domain` 列保留，值域收紧为 `('acg')`

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| SQLite 不支持 ALTER COLUMN 修改 CHECK 约束 | Unit 6 降级为只 DELETE gossip 行，重建表留后续 migration |
| 遗漏某处 gossip import 导致编译失败 | Unit 7 用 `grep -r "gossip" packages/` 做全量扫描 |
| `auto-generate.ts` 中 `domain='acg'` 过滤注释变孤儿 | 该过滤器无害，可在后续 cleanup 删注释 |

## Sources & References

- `packages/backend/src/migrations/008-add-domain.sql`
- `packages/backend/src/scraper/gossip-site-store.ts`
- `packages/backend/src/scraper/gossip-fact-extractor.ts`
- `packages/backend/src/routes/gossip-routes.ts`
- `packages/extension/lib/gossip-client.ts`
