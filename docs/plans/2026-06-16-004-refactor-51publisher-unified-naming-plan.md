---
title: "refactor: Unify package naming to @51guapi/* scope + upgrade extension deps"
type: refactor
status: active
date: 2026-06-16
deepened: 2026-06-16
superseded_by: docs/plans/2026-06-17-002-feat-51guapi-comprehensive-upgrade-plan.md
---

# refactor: 统一 @51guapi/* 命名 + 升级扩展依赖

## Overview

将三个命名风格不一的包（`publisher-monorepo`、`publisher-fill-assistant`、`publisher-backend`）统一到 `@51guapi/*` scope，与 `@51guapi/shared` 保持一致；同时重刷 lockfile（可选随附 vitest patch 升级）。

## Problem Frame

当前状态：
- `@51guapi/shared` — 已有 scope，格式正确
- `publisher-monorepo`（根）、`publisher-fill-assistant`（扩展）、`publisher-backend`（后端）— 无 scope，命名不一致
- 根 `package.json` scripts（`dev:extension`/`dev:backend`/`build:extension`/`build:backend`）、脚本、CI 均通过旧名硬引用，重命名后必须同步

依赖现状（全包）：
- vitest 三包均为 `^4.1.8`，最新 `4.1.9` — 可选随 lockfile 刷新一并升
- wxt `^0.20.26`，react `^19.2.7`，typescript `^6.0.3` — 均与 npm latest 一致

## Scope Boundaries

- **不改** manifest `name`（「51publisher 发帖填充助手」用户可见，已正确）
- **不改** `wxt.config.ts` 业务逻辑
- **不升** 带破坏性变更的 major 版本
- **不动** `@51guapi/shared` 的名称（已正确）
- docs/plans/archive 里的旧计划文件**不修改**（历史记录）

## Requirements Trace

- R1. 四个包名称全部使用 `@51guapi/*` scope
- R2. 所有引用旧包名的脚本、CI workflow、非归档文档同步更新（archive 除外）
- R3. `pnpm --filter` 过滤器均更新为新名（含根 package.json scripts）
- R4. `pnpm install` 后全包构建测试通过（`bash scripts/check-all.sh`）
- R5. pnpm-lock.yaml 与 package.json 保持一致并随同提交

## Key Technical Decisions

- **根包名**：`publisher-monorepo` → `@51guapi/monorepo`。根包是 private workspace root，改名原因是统一全仓库命名风格（虽然根包很少被 `--filter` 引用，但一致性减少未来困惑）。
- **扩展包名**：`publisher-fill-assistant` → `@51guapi/extension`。这是 `--filter` 引用最多的包，改名后需全局替换。
- **后端包名**：`publisher-backend` → `@51guapi/backend`。同上。
- **不引入 pnpm catalog**：当前依赖管理够简单，引入 catalog 属过早优化。
- **vitest patch 升级**：vitest 4.1.8→4.1.9 是独立关切，与命名无关；将其归入 Unit 5 的理由是无论如何都要跑 `pnpm install`，顺带更新 range 减少后续单独 PR；若你希望保持职责分离，可将 range 变更单独提交，Unit 5 只跑 `pnpm install`。
- **wxt zip 产物名**：wxt 将 `@` 和 `/` 替换为 `-`，`@51guapi/extension` 的 zip 产物名为 `51publisher-extension-<version>.zip`（leading `@` 被移除）。**在 Unit 3 执行前须本地 `pnpm zip` 确认**，再更新 release.yml glob。

## Implementation Units

- [ ] **Unit 1: 重命名三个包的 package.json name 字段 + 根 scripts**

**Goal:** 把 `publisher-monorepo`、`publisher-fill-assistant`、`publisher-backend` 统一改为 `@51guapi/*`；同时更新根 package.json 的 scripts 区段

**Requirements:** R1, R3

**Dependencies:** 无（先做，后续单元以此为前提）

**Files:**
- Modify: `package.json`（根）— `name` → `@51guapi/monorepo`；`scripts` 中四条 filter 引用：`publisher-fill-assistant` → `@51guapi/extension`，`publisher-backend` → `@51guapi/backend`
- Modify: `packages/extension/package.json`（name → `@51guapi/extension`）
- Modify: `packages/backend/package.json`（name → `@51guapi/backend`）

**Approach:**
- 根 package.json 需改两处：`"name"` 字段 + `scripts.dev:extension`、`scripts.dev:backend`、`scripts.build:extension`、`scripts.build:backend` 四条命令
- `@51guapi/shared` 已正确，不动

**Test scenarios:**
- Happy path: `cat package.json | grep '"name"'` 输出 `@51guapi/monorepo`
- Happy path: `cat packages/extension/package.json | grep '"name"'` 输出 `@51guapi/extension`
- Happy path: `cat packages/backend/package.json | grep '"name"'` 输出 `@51guapi/backend`
- Happy path: `pnpm --filter "@51guapi/extension" build` 执行成功（验证 scoped filter 语法可用）
- Happy path: `pnpm dev:extension`（或 `pnpm build:extension`）不再输出 "No packages were matched"

**Verification:** `grep -E '"name"|filter' package.json` 显示新名称；根 scripts 不含旧包名

---

- [ ] **Unit 2: 更新 scripts/*.sh 和 scripts/*.mjs 中的 --filter 引用**

**Goal:** 让所有 `scripts/` 脚本的 `pnpm --filter` 引用匹配新包名

**Requirements:** R2, R3

**Dependencies:** Unit 1

**Files:**
- Modify: `scripts/check-all.sh`
- Modify: `scripts/setup.sh`
- Modify: `scripts/start-backend.sh`
- Modify: `scripts/setup.mjs`（第 248 行：`pnpm --filter publisher-backend build`）
- Modify: `scripts/deploy.sh`（如存在）

**Approach:**
- 全局替换：`publisher-fill-assistant` → `@51guapi/extension`，`publisher-backend` → `@51guapi/backend`
- shell 中含 `@` 的 filter 需加引号：`pnpm --filter "@51guapi/extension" build`
- YAML 中也需要引号：`run: pnpm --filter "@51guapi/extension" test`

**Test scenarios:**
- Happy path: `grep -r "publisher-fill-assistant\|publisher-backend" scripts/` 无输出
- Happy path: `bash scripts/check-all.sh` 全绿

**Verification:** `grep -r "publisher-fill-assistant\|publisher-backend" scripts/` 无输出

---

- [ ] **Unit 3: 更新 CI workflow 中的包名引用**

**Goal:** `.github/workflows/` 中所有 `--filter` 和文件名 glob 匹配新名称

**Requirements:** R2, R3

**Dependencies:** Unit 1

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/release.yml`

**Approach:**
- ci.yml 需更新三处（全部 `--filter publisher-*`）：
  1. Build backend：`--filter publisher-backend` → `--filter "@51guapi/backend"`
  2. Build extension：`--filter publisher-fill-assistant` → `--filter "@51guapi/extension"`
  3. E2E 步骤：`--filter publisher-fill-assistant test:e2e` → `--filter "@51guapi/extension" test:e2e`
- release.yml 需更新两处：
  1. Zip 命令：`--filter publisher-fill-assistant zip` → `--filter "@51guapi/extension" zip`
  2. Artifact cp glob：`publisher-fill-assistant-*.zip` → `51publisher-extension-*.zip`（wxt 将 `@` 去掉，`/` 换 `-`）
- **执行前必须**：在本地运行 `pnpm --filter "@51guapi/extension" zip` 确认实际产物文件名，再更新 glob

**Test scenarios:**
- Pre-flight: 本地 `pnpm --filter "@51guapi/extension" zip` 成功，确认产物名为 `51publisher-extension-<version>.zip`
- Happy path: `grep -r "publisher-fill-assistant\|publisher-backend" .github/workflows/` 无输出
- Integration: CI push 后 build + e2e jobs 通过

**Verification:** `grep -r "publisher-fill-assistant\|publisher-backend" .github/workflows/` 无输出；release.yml glob 与实际产物名一致

---

- [ ] **Unit 4: 更新文档和 CLAUDE.md 中的引用**

**Goal:** 将活跃文档（非归档）中的旧包名替换，避免混淆

**Requirements:** R2

**Dependencies:** Unit 1

**Files:**（以下文件均已确认存在）
- Modify: `CLAUDE.md`（含 `--filter publisher-*` 命令示例）
- Modify: `docs/install-and-usage.md`
- Modify: `docs/run-sheet-首飞与基线.md`
- Modify: `README.md`
- Modify: `TODOS.md`
- Modify: `docs/plans/` 下**活跃**计划（非 archive，仅替换 filter 示例）

**Approach:**
- 只更新 `--filter publisher-fill-assistant` / `--filter publisher-backend` 这类命令示例
- archive 下的历史计划**不改**
- `pnpm -r` / `pnpm --filter @51guapi/shared` 等已正确的不动

**Test scenarios:**
- Happy path: `grep -r "publisher-fill-assistant\|publisher-backend" docs/ --include="*.md" | grep -v archive` 无输出
- Happy path: `grep "publisher-fill-assistant\|publisher-backend" CLAUDE.md README.md TODOS.md` 无输出

**Verification:** 活跃文档中旧包名引用归零

---

- [ ] **Unit 5: 重跑 pnpm install + 可选 vitest patch 升级**

**Goal:** 重刷 lockfile，使其与重命名后的 package.json 一致；可选随附 vitest 4.1.8→4.1.9

**Requirements:** R4, R5

**Dependencies:** Unit 1（包名稳定后再装依赖，避免 lockfile 混乱）

**Files:**
- Modify（可选）: `packages/extension/package.json`、`packages/backend/package.json`、`packages/shared/package.json` — vitest range `^4.1.8` → `^4.1.9`（三包当前均为 4.1.8）
- Auto-modified: `pnpm-lock.yaml`（**必须随同提交**，CI 用 `--frozen-lockfile`）

**Approach:**
- 若同步升 vitest：先改三包 range，再 `pnpm install`
- 若只刷 lockfile：直接 `pnpm install`
- `pnpm-lock.yaml` 变化必须包含在同一提交里，否则 CI `--frozen-lockfile` 报错

**Test scenarios:**
- Happy path: `pnpm install` 无报错，`pnpm-lock.yaml` 有变化
- Happy path: `pnpm test`（全包）全绿
- Happy path: `pnpm compile` 无类型错误

**Verification:** `bash scripts/check-all.sh` 全绿；`pnpm-lock.yaml` 已在暂存区

## Implementation Order

```
Unit 1 (package.json + root scripts rename)
    ↓
Unit 2 (scripts)  ←→  Unit 3 (CI workflows)  ←→  Unit 4 (docs)
    ↓
Unit 5 (pnpm install + lockfile commit)
    ↓
bash scripts/check-all.sh (验收)
```

Unit 2/3/4 可并行执行，但都依赖 Unit 1 先完成。

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| release.yml zip glob 不匹配新产物名 | Unit 3 执行前本地 `pnpm zip` 确认实际产物名再更新 glob |
| `@` 在 shell --filter 中被 glob 展开 | 所有 shell/YAML filter 参数加引号：`"@51guapi/extension"` |
| pnpm-lock.yaml 未提交导致 CI frozen-lockfile 失败 | Unit 5 明确要求 lockfile 随 package.json 一起提交 |
| 活跃文档中遗漏引用 | Unit 4 完成后 `grep -r` 全局扫描确认 |
| ci.yml E2E 静默跳过（filter no-op） | Unit 3 明确列出 E2E 步骤的 filter 更新 |

## Sources & References

- 现有正确示范：`packages/shared/package.json` → `"name": "@51guapi/shared"`
- `scripts/check-all.sh` — 验收命令基准
- `.github/workflows/release.yml:42,45` — zip filter + 产物名 glob（两处均需同步）
- `.github/workflows/ci.yml:54,63,64` — E2E + build filter（三处均需同步）
