---
title: "全面迭代優化計畫 — 收尾階段清理與長期健康"
type: plan
status: active
date: 2026-06-17
origin: Track 2 of 全面迭代優化（TODOS 修復 + 優化計畫 + 清理歸檔）
supersedes: []
---

# 全面迭代優化計畫 — 收尾階段清理與長期健康

## Overview

延續 2026-06-16 全面迭代路線圖與 2026-06-15 全面系統優化計畫的完成狀態，本計畫對當前程式碼庫進行**靜態健康掃描**，找出所有非功能性缺口，按影響力排定整頓順序。

### 狀態基線（2026-06-17）

| 維度 | 狀態 |
|---|---|
| 編譯 | 3 packages 全部通過 |
| 測試 | 116 + 423 + 925 = 1464 tests all pass |
| Lint | Biome 零警告/錯誤 |
| 型別 | strict mode 零 `any` / `@ts-expect-error` |
| CI | GitHub Actions passing |
| 安全閘門 | pre-commit compile + pre-push gitleaks |
| Production console.log | 零 |
| TODOS.md | 零 open items |

## Wave 1 — 文件清理（立即、低風險）

### 1.1 漂移腦暴文件歸檔

**29/30 個 `docs/brainstorms/` 文件對應已合併功能**，應遷移至 `docs/brainstorms/archive/`。

| 保留 | 原因 |
|---|---|
| `2026-06-16-guapi-v0.1-rebrand-requirements.md` | 尚未實作，品牌重塑 roadmap 參考 |

**例外判斷**：存放於日期序號的功能腦暴文（`2026-06-03` 至 `2026-06-16`）除了 guapi rebrand 均已透過對應 feature branch 合併至 main。

### 1.2 已完成計畫歸檔

4 個 `docs/plans/` 文件標記為 `status: completed`，應遷移至 `docs/plans/archive/`：

- `2026-06-15-005-refactor-comprehensive-system-optimization.md`
- `2026-06-16-001-refactor-maintainability-test-refactor-plan.md`
- `2026-06-16-002-refactor-fewshot-dedup-plan.md`
- `2026-06-16-feat-comprehensive-iteration-roadmap.md`

**保留 2 個 active**：
- `2026-06-16-001-refactor-settings-hook-split-plan.md`（active，但實質已完成，可標記成 completed 後歸檔）
- `2026-06-17-001-feat-grounding-phase2-full-field-protection-plan.md`（active，當前分支計畫）

### 1.3 舊版構想歸檔

3 個 `docs/ideation/` 文件（2026-06-04 至 06-15）為早期開放式構想記錄，對應功能均已實作，應遷移至 `docs/ideation/archive/`。

### 1.4 Compose 計畫目錄檢查

`docs/compose/` 僅含 `plans/` 和 `specs/` 兩個子目錄，無需清理。

## Wave 2 — 程式碼品質（中優先級）

### 2.1 大檔案模組化

以下檔案 >400 行（非測試），在未來重構中可考慮拆分：

| 檔案 | 行數 | 建議 |
|---|---|---|
| `background.ts` | 1172 | 可拆 background 入口 + message router + handler modules |
| `batch-orchestrator.ts` | 681 | 已多次重構；可拆 policy 層與 execution 層 |
| `App.tsx` | 628 | 可依路由拆分 sidebar panel views |
| `PendingTopicsView.tsx` | 620 | 可抽 list/review/actions 子元件 |
| `storage.ts` | 566 | 可拆 adapter 層與 storage operation 層 |
| `ReviewableItemsList.tsx` | 548 | 可抽 item renderers / sort filter |
| `FirstFlightWizard.tsx` | 492 | modal 狀態機可抽至 hook |
| `ItemCard.tsx` | 476 | 可抽 sub-components |
| `batch.ts` | 420 | 業務邏輯密度適中，可暫緩 |
| `app.ts` | 409 | 路由註冊可拆 route modules |

**優先級**：均為 P3（不影響功能正確性），建議在觸及這些檔案的下次重構時順手拆分。

**Effort**: M-L per file | **Impact**: maintainability | **Priority**: P3

### 2.2 測試檔案肥大

- `batch-orchestrator.test.ts`：1608 行 — 可依測試類別拆成多個 describe blocks 或多個 test files
- `background.test.ts`：1520 行 — 同上

**Effort**: M | **Impact**: medium (test readability) | **Priority**: P3

## Wave 3 — 效能（低優先級）

### 3.1 渲染效能

✅ **已修復**：TodayBatchView 8+ 獨立 filter/every 呼叫合併為單一 useMemo（current branch）。

### 3.2 Bundle Size

WXT 使用 dynamic imports + Chrome MV3 原生 code splitting。目前無顯著 bundle 問題。建議在加入重大第三方套件時以 `wxt analyze` 驗證。

**Effort**: S (monitoring only) | **Impact**: low | **Priority**: P3

## Wave 4 — 基礎設施（低優先級）

### 4.1 Worktree 清理

**16 條 worktree branches 中多數對應已合併功能**：

```
feat/batch-reliability-ux
feat/batch-scoped-item-ids-slotdiff
feat/feedback-rating-ui
feat/grounding-phase2
feat/harden-safety-net
feat/llm-retry-backoff
feat/merge-approve-handlers
feat/phase-2-on-p1
feat/phase-3-quality-engine
feat/phase4-topic-intelligence
feat/phase5-daily-batch
feat/prompt-assembly-helper
feat/refactor-settings-hook
feat/release-readiness-ops
feat/safety-net-review-residuals
feat/settings-test-connection
fix/grounding-gate-publish-basis
fix/lint-sweep-jun2026
```

建議：用 `git branch --merged main` 找出可安全刪除的分支。刪除前先確認 `git branch -d` 安全（不會遺失 commits）。

**Effort**: S | **Impact**: low (developer hygiene) | **Priority**: P3

### 4.2 相依性

- 無過大或過時的依賴
- pnpm workspace 拓撲正確（shared → backend/extension）
- 建議：定期執行 `pnpm outdated` 檢查

### 4.3 CI/CD

- CI 現狀良好（biome check + tsc + vitest）
- 可選增強：在 pre-commit hook 中加入 lint（目前僅 compile）

## Wave 5 — 測試

### 5.1 Flakiness

✅ 目前無已知 flaky tests。1464 tests 全部穩定通過。

### 5.2 整合測試缺口

- E2E 測試尚未覆蓋，建議在 browser testing setup 完成後補上
- 目前依靠 unit + component tests 覆蓋

**Effort**: XL | **Impact**: high (defense) | **Priority**: P2

## 執行摘要

### 立即執行（Wave 1 — 檔案清理）

| 動作 | Effort | Owner |
|---|---|---|
| 歸檔 29 腦暴文件 | S | current |
| 歸檔 4 已完成計畫 | S | current |
| 歸檔 3 舊構想文件 | S | current |
| settings-hook-split-plan 標記 completed | S | current |

### 後續追蹤（Wave 2-5 — 可延後）

| 動作 | Effort | Impact | Priority |
|---|---|---|---|
| 大檔案模組化 | M-L | maintainability | P3 |
| 測試檔案拆分 | M | readability | P3 |
| Worktree 清理 | S | hygiene | P3 |
| E2E 測試 | XL | production safety | P2 |
| Bundle monitoring | S | performance | P3 |
