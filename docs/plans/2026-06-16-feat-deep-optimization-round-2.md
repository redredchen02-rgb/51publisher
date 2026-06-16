---
title: "refactor: 深度優化第二輪 — App.tsx 萃取 + batch-orchestrator 拆分 + 完善工程健康"
type: refactor
status: completed
date: 2026-06-16
origin: 2026-06-16 路線圖對帳（Phase 1+4 已實質完成）+ batch-orchestrator.ts 677L 重構需求
supersedes:
  - docs/plans/2026-06-16-feat-comprehensive-iteration-roadmap.md
  - docs/plans/2026-06-15-005-refactor-comprehensive-system-optimization.md
---

# 深度優化第二輪 — App.tsx 萃取 + batch-orchestrator 拆分 + 完善工程健康

## Overview

**2026-06-16 路線圖中的 Phase 1（收尾清理）和 Phase 4（運維基礎）已經絕大部分落地**。以下是實際程式碼對帳結果：

| 路線圖項目 | 實際位置 | 狀態 |
|---|---|---|
| Graceful shutdown | `packages/backend/src/index.ts:10-22` | ✅ |
| Request ID | `packages/backend/src/app.ts:46` | ✅ |
| Body limit 1MB | `packages/backend/src/app.ts:47` | ✅ |
| CSP headers | `packages/backend/src/app.ts:111-117` | ✅ |
| CI 依賴漏洞掃描 | `.github/workflows/ci.yml:32-35` | ✅ |
| CI dependency review | `.github/workflows/ci.yml:72-79` | ✅ |
| `.nvmrc` / `.node-version` | 已建立 | ✅ |
| 構建基線 | `docs/baselines/build-baseline.md` | ✅ |
| healthz 依賴檢查 | `packages/backend/src/app.ts:126-174` | ✅ |
| 結構化 logger | `packages/extension/lib/logger.ts` | ✅ |
| CSS modules + Settings hook | commit `c4397107` + #43 | ✅ |
| `fewShotExamples` 清理 | commit `fb8c7588` | ✅ |
| TypeBox schemas 全覆蓋 | `schemas.ts` 26+ schemas | ✅ |
| Route 組織（routes/ 統一） | 已在 `src/routes/` | ✅ |
| 度量面板 + golden-set | commit `aa7a1fe0` #41 | ✅ |
| 選題推薦 + 批量 UX | commit `5986a20d` #42 | ✅ |
| 計劃文件歸檔 | commit `c34dda4e` / `6a7ada24` | ✅ |
| shared/backend 測試擴充 | 最新 commits | ✅ |
| Rate limit 全局 | `app.ts:108` 100/min | ✅ |

**所以這一輪的重點不再是「收尾清理」或「運維加固」，而是真正的深度優化：把剩餘的 2 個大檔案拆開，補上視覺 UX 的小缺口。**

### Current State (2026-06-16 17:00)

| 維度 | 狀態 | 關鍵信號 |
|------|------|----------|
| 類型檢查 + 測試 | ✅ | `pnpm -r compile` + `pnpm test` / e2e 全綠 |
| 安全閘門 | ✅ | SSRF / grounding / XSS / auth / CORS / rate-limit |
| 首飛工具鏈 | ✅ | CLI wizard + runbook 已產出 |
| App.tsx 行數 | 🔴 | **648L**（路由/鑑權/單篇生成/錯誤日誌混雜） |
| batch-orchestrator.ts 行數 | 🔴 | **677L**（runBatch + approveBatch + retryItem 全在一檔） |
| Loading states（BatchView / HistoryPanel） | 🔴 | 無，只有 PendingTopicsView 有基礎 loading |
| Rate limit 加嚴 | 🟡 | 全局 100/min；auth 端點應加嚴到 5/min |
| 真實發布 | 🔴 | **從未執行首飛**（需運營者手動） |

### Success Criteria

- App.tsx ≤ 220L（從 648L 降 65%）
- batch-orchestrator.ts ≤ 300L + 3 個獨立子模組（可各自單測）
- BatchView / HistoryPanel 有 `<Loading>` spinner
- auth 端點 rate limit 加嚴到 5/min
- `pnpm -r compile` + `pnpm test` 全綠，零行為變更

---

## Implementation Units

### Unit 1: aiDraft SlotDiff 比較源修復 + ItemCard 差異徽章（優先執行）

**直接取自 2026-06-16-002 計劃的 Unit 1。**

**Files:**
- Modify: `packages/extension/lib/batch-orchestrator.ts`（行 556-558）
- Modify: `packages/extension/entrypoints/sidepanel/batch-review/ItemCard.tsx`
- Test: `packages/extension/lib/batch-orchestrator.test.ts`
- Test: `packages/extension/lib/draft-diff.test.ts`

**Approach:**
- `computeSlotDiff(cur.publishedDraft, cur.draft)` → `computeSlotDiff(cur.assembledDraftSnapshot, cur.draft)`（行 557）
- `ItemCard`：呼叫 `computeSlotDiff(item.assembledDraftSnapshot, item.draft ?? item.assembledDraftSnapshot)`，展示「已修改 N 個欄位：…」摘要
- unknown 時顯示「無原稿基準」

**Test scenarios:**
- Happy path：`assembledDraftSnapshot` 存在、title 被改 → `changedSlots: ["title"]`
- No diff：snapshot 與 draft 相同 → `changedSlots: []`
- Unknown：`assembledDraftSnapshot` 為 undefined → `{ unknown: true }`
- Integration：`approveBatch` 後 trajectory 中的 SlotDiff 與 computeSlotDiff 直呼結果一致

**Verification:** `pnpm test` 全綠；ItemCard 在人工編輯後顯示差異徽章

---

### Unit 2: App.tsx 元件萃取

**直接取自 2026-06-16-002 計劃的 Unit 2 + Unit 3。**

#### U2.1: 萃取 `<ErrorLogPanel>` 與 `<WorkflowNav>`

先拆兩個自包含元件（67L + 60L），App.tsx 降到 ~520L。

**Files:**
- Create: `packages/extension/entrypoints/sidepanel/ErrorLogPanel.tsx`
- Create: `packages/extension/entrypoints/sidepanel/WorkflowNav.tsx`
- Modify: `packages/extension/entrypoints/sidepanel/App.tsx`
- Test: `packages/extension/entrypoints/sidepanel/App.test.tsx`

**Approach:**
- `ErrorLogPanel` props：`{ logs, showLogs, onToggleLogs, onRetrieve, onClear, onExport }`
- `WorkflowNav` props：`{ onSetView, onFirstFlight }`
- 純搬移，不新增業務邏輯

#### U2.2: 萃取 `useMainDraftFlow` hook

把單篇生成流程（mode → generate → fill → next → cancel → copy）封裝為 domain hook，App.tsx ≤ 220L。

**Files:**
- Create: `packages/extension/entrypoints/sidepanel/hooks/useMainDraftFlow.ts`
- Create: `packages/extension/entrypoints/sidepanel/hooks/useMainDraftFlow.test.ts`
- Modify: `packages/extension/entrypoints/sidepanel/App.tsx`
- Update: `packages/extension/entrypoints/sidepanel/App.test.tsx`

**Pattern to follow:** `hooks/useTodayBatchDomain.ts`（domain hook with deps object pattern）

**Hook API:**
```typescript
interface UseMainDraftFlowDeps {
  handleError: (msg: string, kind?: string) => void;
  logError: (msg: string, ctx?: Record<string, unknown>) => void;
  recordOperation: (op: string, ok: boolean, detail?: string) => void;
  loadingState: UseLoadingStateReturn;
  saveDraft: (draft: ContentDraft) => Promise<void>;
}

interface UseMainDraftFlowReturn {
  mode: 'idle' | 'generating' | 'draft' | 'filled' | 'partial' | 'filledIdle';
  topic: string;
  setTopic: (t: string) => void;
  draft: ContentDraft | null;
  updateDraft: (patch: Partial<ContentDraft>) => void;
  results: FieldFillResult[] | null;
  confirmNext: boolean;
  handleGenerate: () => Promise<void>;
  handleFill: () => Promise<void>;
  handleNext: () => void;
  cancelGenerate: () => void;
  copyBody: () => Promise<void>;
}
```

**App.tsx 保留（~200L）：** `view / authenticated / authChecking / error / loadingState / toast / logs / showLogs` 等跨 view 狀態 + 鑑權 useEffect + keyboard shortcuts 接線

---

### Unit 3: batch-orchestrator.ts 拆分

677L 檔案按職責拆為 1 個主入口 + 3 個子模組。

#### 拆分方案

| 新檔案 | 內容 | 原始行數 | 預計行數 |
|--------|------|----------|----------|
