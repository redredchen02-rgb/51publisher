---
title: "refactor: Fix aiDraft SlotDiff Gap + App.tsx Component Extraction"
type: refactor
status: completed
date: 2026-06-16
---

# Refactor: Fix aiDraft SlotDiff Gap + App.tsx Component Extraction

## Overview

兩個獨立但配套的重構：

1. **修復 aiDraft 比較源錯誤**：`batch-orchestrator.ts:557` 用 `publishedDraft`（從未賦值，恆為 undefined）當比較基準，導致 `computeSlotDiff` 永遠回傳 `{ unknown: true }`。正確來源是 `assembledDraftSnapshot`（已在 `markFilled` 填入）。再在 `batch-review/ItemCard.tsx` 加上草稿對比徽章，讓操作者在審批時看到「AI 原稿 vs 目前版本」的差異欄位數。

2. **App.tsx 元件萃取**：App.tsx（648L）集路由、鑑權、單篇生成流程、錯誤日誌於一身。將三段自包含邏輯抽出，降至 ~200L。

## Problem Frame

- `computeSlotDiff` 的基礎設施（`draft-diff.ts`）與 `assembledDraftSnapshot` 欄位均已就位，但 `approveBatch`（行 557）傳入的是 `cur.publishedDraft`——這個欄位在整個 batch-orchestrator 中從未被賦值，等於 `undefined`——使 SlotDiff 功能形同虛設。
- App.tsx 有 15 個 hooks + 複雜 JSX，每次修改單篇生成路徑或錯誤日誌都需在 648L 上下文中定位，維護成本高。前一輪計劃（`2026-06-16-001`）已拆完其他 god-component，App.tsx 是最後一個留存的高行數元件。

## Requirements Trace

- R1. `approveBatch` 中 `computeSlotDiff` 的比較基準從 `cur.publishedDraft` 改為 `cur.assembledDraftSnapshot`，使 SlotDiff 回傳有意義的結果。
- R2. `batch-review/ItemCard.tsx` 在 `assembledDraftSnapshot` 存在時顯示「已修改 N 個欄位」徽章（unknown 時顯示「首飛前無基準」）。
- R3. `useMainDraftFlow` hook 從 App.tsx 抽出，封裝單篇生成流程（mode/draft/results/topic/confirmNext + handleGenerate/Fill/Next/cancel/copy）。
- R4. `<ErrorLogPanel>` 元件從 App.tsx 抽出（67L，自包含）。
- R5. `<WorkflowNav>` 元件從 App.tsx 抽出（60L，6 張工作流卡片）。
- R6. App.tsx 重構後降至 ≤ 280L，`pnpm test` 全綠、行為不變。（Unit 3 同步萃取 `<SingleDraftView>` render block，否則數學上不可達）

## Scope Boundaries

- `publishedDraft` 欄位保留（dead field，暫不刪除以保持型別相容），本輪不賦值。
- 不新增產品功能（SlotDiff 顯示是既有基礎設施，只是啟用）。
- `batch-orchestrator.ts` 的匯出 API（`runBatch` / `approveBatch` / `discardBatchItem` / `retryItem`）介面不變。
- `background.ts`（1172L）、`llm.ts`（643L）本輪不動。

## Context & Research

### Relevant Code and Patterns

**assembledDraftSnapshot 填入位置**（`batch-orchestrator.ts:293–304`）
- `markFilled(item, draft, …, assembledDraft, …)` 在 AI 重寫管線後凍結 `assembledDraftSnapshot`
- 此欄位 = AI 最終輸出（重寫後）、人工編輯前的快照，是 SlotDiff 的正確 before 端

**computeSlotDiff（`draft-diff.ts:33`）**
- 簽名：`computeSlotDiff(aiDraft: ContentDraft | undefined, finalDraft: ContentDraft): SlotDiff`
- `aiDraft=undefined` 時回傳 `{ unknown: true, changedSlots: [], totalSlots: 0 }`，已向下相容

**ItemCard 整合點**（`batch-review/ItemCard.tsx`）
- 已接收完整 `item: BatchItem` 物件
- 不需更改 `BatchReviewPanel.tsx` props，直接在 ItemCard 內呼叫 computeSlotDiff

**Domain hook 模式**（`hooks/useTodayBatchDomain.ts`、`hooks/useSettingsForm.ts`）
- 封裝整個 view 的狀態 + handler，回傳 flat 物件（`TodayBatchDomain`）
- `useMainDraftFlow` 應遵循此模式

**ErrorLogPanel 自包含範圍**（`App.tsx:421–488`）
- 依賴：`logs / showLogs / retrieveLogs / clearLogs / exportLogs`——全部來自 `useErrorLogger()` hook
- 可隨 hook 一起傳給元件

**WorkflowNav 自包含範圍**（`App.tsx:336–396`）
- 依賴：`setView` + `launchFirstFlight`——兩個 callback
- 6 張工作流卡片，無內部狀態

### Institutional Learnings

- **fakeBrowser 測試模式**（`extension-http-client-testability-injection-seam-2026-06-15.md`）：`useMainDraftFlow` 的測試用 `fakeBrowser.reset()` + `vi.mock` 隔離 messaging 層；避免 `_fetchFn` 底線陷阱；測試結尾加 `expect(mock).toHaveBeenCalledOnce()` 防假綠。
- **批量狀態原子折疊**（`incremental-pr-adversarial-verification-2026-06-15.md`）：`approveBatch` 一次性更新，不引入中間狀態——修 aiDraft gap 的 one-liner 符合此原則。

## Key Technical Decisions

- **用 `assembledDraftSnapshot` 而非新增 `aiDraft` 欄位**：研究發現 `assembledDraftSnapshot` 語義完全吻合（AI 重寫後、人工編輯前），不需改 shared/src/batch.ts 類型，範圍最小。替代方案——新增 `aiDraft?: ContentDraft` 欄位——只會是 `assembledDraftSnapshot` 的同義欄位，增加混淆；`publishedDraft`（原設計 before 端）從未被賦值，確認是 dead field，本輪不刪（保留型別相容），不賦值。
- **SlotDiff 顯示在 ItemCard，非 BatchReviewPanel**：ItemCard 已有 `item` prop，在元件內部 derive，零 prop drilling。顯示為只讀摘要（「已修改 3 個欄位：title, tags, body」），非互動元素。
- **useMainDraftFlow 依賴注入模式**：hook 接收 `{ handleError, logError, recordOperation, loadingState, saveDraft }` 作為 deps 物件，與 `useTodayBatchDomain` 接收 deps 的模式一致，便於測試時 mock。
- **ErrorLogPanel 與 WorkflowNav 先拆，再拆 hook**：兩個元件拆分不影響 App 邏輯，風險低；`useMainDraftFlow` 涉及 App 核心狀態，依賴穩定後再萃取。

## Open Questions

### Resolved During Planning

- **`publishedDraft` 語義？**：在整個 batch-orchestrator 中從未賦值，可能是早期留的 placeholder；語義應為「已送出發布的那個版本」。本輪不賦值，只修正 SlotDiff 比較源，待首飛後再評估是否補填。
- **`useMainDraftFlow` 是否需要 `useReducer`？**：狀態間有依賴（mode ↔ draft），但轉換路徑明確、不複雜，`useState` + 明確 state machine 即可，不引入 useReducer。
- **`promptTemplateRef` 歸屬？**：保留在 App.tsx（init useEffect 與鑑權耦合），透過 deps 物件的 `promptTemplate: string` 傳入 hook，避免雙重 fetch。

### Deferred to Implementation

- `WorkflowNav` 的 CSS module 依賴：若現有樣式是 App.tsx 局部的，需在拆分時確認是否移至全局或新的 `WorkflowNav.module.css`。
- `useMainDraftFlow` test 中 `requestGenerate` / `requestFill` 的 mock 策略：確認走 `vi.mock("../../lib/messaging")` 還是注入參數。

## Implementation Units

- [ ] **Unit 1: 修復 aiDraft SlotDiff 比較源**

**Goal:** 讓 `computeSlotDiff` 在每次 `approveBatch` 時產生有意義的結果，並在 ItemCard 顯示差異摘要。

**Requirements:** R1, R2

**Dependencies:** 無（獨立修正）

**Files:**
- Modify: `packages/extension/lib/batch-orchestrator.ts`（行 557）
- Modify: `packages/extension/entrypoints/sidepanel/batch-review/ItemCard.tsx`
- Test: `packages/extension/lib/batch-orchestrator.test.ts`（加 SlotDiff 相關 case）
- Test: `packages/extension/lib/draft-diff.test.ts`（確認覆蓋 unknown 路徑）

**Approach:**
- 行 557 修改：需保留原有 guard pattern——`cur?.assembledDraftSnapshot && cur?.draft ? computeSlotDiff(cur.assembledDraftSnapshot, cur.draft) : undefined`（`cur.draft` 和 `cur.assembledDraftSnapshot` 均為 optional；既有 guard 是 load-bearing，不可直接替換為 one-liner）
- ItemCard：用 `useMemo(() => computeSlotDiff(item.assembledDraftSnapshot, item.draft), [item.assembledDraftSnapshot, item.draft])` 計算 `SlotDiff`（批次列表多條 item 每次 re-render 均會計算，memoize 是必要的）；若 `unknown` 顯示灰色「無原稿基準」；若有 diff，顯示「已修改 N 個欄位：…」，顏色依 changedSlots.length > 0 有色/無色；badge 說明標注「含 AI 自動重寫」
- 顯示位置：ItemCard 標題下方，緊接 `status` badge

**Patterns to follow:**
- `draft-diff.ts` 的 `SlotDiff` 類型與 `unknown` 處理
- `batch-review/ItemCard.tsx` 現有標題 + badge 結構

**Test scenarios:**
- Happy path：`assembledDraftSnapshot` 存在、title 被改 → `changedSlots: ["title"]`，ItemCard 顯示「已修改 1 個欄位：title」
- No diff：snapshot 與 draft 相同 → `changedSlots: []`，顯示「未修改」
- Unknown：`assembledDraftSnapshot` 為 undefined → `{ unknown: true }`，顯示「無原稿基準」
- Integration：`approveBatch` 後 trajectory 中的 SlotDiff 與 computeSlotDiff 直呼結果一致

**Verification:**
- `pnpm test` 全綠
- batch-orchestrator.test.ts 中有測試覆蓋 assembledDraftSnapshot vs draft diff 場景
- 既有 draft-diff.test.ts 全部通過（行為不變）

---

- [ ] **Unit 2: 萃取 `<ErrorLogPanel>` 與 `<WorkflowNav>`**

**Goal:** 先把兩個結構簡單、自包含的 JSX 塊移出 App.tsx，為 Unit 3 的 hook 萃取留出乾淨空間。

**Requirements:** R4, R5

**Dependencies:** 無（與 Unit 1 平行可執行；各自 Verification 步驟跑 `pnpm test` 確認基線）

**Files:**
- Create: `packages/extension/entrypoints/sidepanel/ErrorLogPanel.tsx`
- Create: `packages/extension/entrypoints/sidepanel/WorkflowNav.tsx`
- Modify: `packages/extension/entrypoints/sidepanel/App.tsx`（移除兩段 JSX，改 import）
- Test: `packages/extension/entrypoints/sidepanel/App.test.tsx`（確認 snapshot 不被破壞）

**Approach:**
- `ErrorLogPanel` props：`{ logs, showLogs, onToggleLogs, onRetrieve, onClear, onExport }`；原 `showLogs / setShowLogs` 保留在 App，透過 props 傳入
- `WorkflowNav` props：`{ onSetView, onFirstFlight }`；6 張卡片 JSX 原樣移入
- 不新增業務邏輯，純搬移

**Patterns to follow:**
- `batch-review/ApprovalBar.tsx`（callback props 命名慣例）
- 現有元件的 CSS module 引用方式

**Test scenarios:**
- App.test.tsx 現有測試全部通過（無 breaking change）
- `WorkflowNav` render test：傳入 mock callbacks，6 張卡片都 render
- `ErrorLogPanel` render test：`showLogs=false` 不渲染日誌清單

**Verification:**
- App.tsx 行數降至 ≤ 520L（兩個元件拆出後估計 520L，再由 Unit 3 繼續降）
- `pnpm test` 全綠

---

- [ ] **Unit 3: 萃取 `useMainDraftFlow` hook**

**Goal:** 將 App.tsx 中單篇生成流程的狀態與 handler 萃取為 domain hook，App.tsx 降至 ≤ 220L。

**Requirements:** R3, R6

**Dependencies:** Unit 2 完成（App.tsx 行數已降，結構清晰）

**Files:**
- Create: `packages/extension/entrypoints/sidepanel/hooks/useMainDraftFlow.ts`
- Create: `packages/extension/entrypoints/sidepanel/hooks/useMainDraftFlow.test.ts`
- Create: `packages/extension/entrypoints/sidepanel/SingleDraftView.tsx`
- Modify: `packages/extension/entrypoints/sidepanel/App.tsx`
- Update: `packages/extension/entrypoints/sidepanel/App.test.tsx`

**Approach:**
- Hook 管理：`mode / topic / draft / results / confirmNext / genTokenRef`
- **`promptTemplateRef` 保留在 App.tsx**：它在 init useEffect 中與鑑權、saved draft 在同一 `Promise.all` 載入，無法單獨移出；hook 透過 deps 物件接收 `promptTemplate: string`（App 在 init effect 完成後傳入），避免 hook 自己呼叫 getSettings() 造成雙重 fetch
- Hook 回傳：`{ mode, topic, setTopic, draft, updateDraft, results, confirmNext, handleGenerate, handleFill, handleNext, cancelGenerate, copyBody }`
- Hook 接收 deps 物件：`{ promptTemplate, handleError, logError, recordOperation, loadingState, saveDraft }`（`loadingState` 由 App.tsx 的 `useLoadingState()` 建立後傳入，不在 hook 內部建立，確保生命週期單一）
- App.tsx 保留：`view / authenticated / authChecking / promptTemplateRef / error / loadingState / toast / logs / showLogs` 等跨 view 狀態 + init useEffect + keyboard shortcuts 接線
- **Unit 3 同步萃取 `<SingleDraftView>`**：App.tsx 行 490–634 的條件式 JSX（ProgressBar / DraftPreview / FillResultPanel / action buttons）約 145L 移入此元件，接收 `useMainDraftFlow` 的回傳值作 props；這是 R6 ≤280L 目標的必要步驟

**Patterns to follow:**
- `hooks/useTodayBatchDomain.ts`（domain hook with deps object pattern）
- `hooks/useSettingsForm.ts`（返回 flat 物件）

**Test scenarios:**
- Happy path：generate 成功 → mode 從 `generating` 變 `draft`，draft 被設定
- Cancel：`cancelGenerate()` → genToken 遞增，mode 回到前一狀態
- Fill success：fill 成功無問題 → mode `filled`，toast success
- Fill partial：有欄位失敗 → mode `partial`
- Fill error：fill 失敗 → mode 回 `draft`，handleError 被呼叫
- handleNext with confirmNext：`mode=partial`，第一次 handleNext 設 confirmNext=true；第二次清空 draft/topic/mode
- copyBody：`navigator.clipboard.writeText` 被呼叫
- Error path：generate 失敗 `res.ok=false` → handleError 被呼叫，logError 被呼叫，recordOperation 被呼叫

**Verification:**
- App.tsx ≤ 280L
- `pnpm test` 全綠（1447 條基線，不降）
- `pnpm compile` exit 0

## System-Wide Impact

- **交互圖**：`batch-orchestrator.ts:557` 修改只影響 `approveBatch` 的 trajectory log；不改變 batch 狀態機或外部 API
- **不變量**：`BatchItem.assembledDraftSnapshot` 的賦值位置（`markFilled`）不動；`computeSlotDiff` 簽名不動；`BatchReviewPanel` props 不動
- **集成覆蓋**：Unit 1 的 batch-orchestrator.test.ts 新增 case 覆蓋 SlotDiff 路徑；Unit 3 的 hook test 用 vi.mock 隔離 messaging 層

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| `WorkflowNav` 的 CSS 樣式被 App.tsx 的 scoped 類名鎖定 | 實作時讀 App.module.css，必要時建 WorkflowNav.module.css 或移至 global |
| `useMainDraftFlow` 中 `genTokenRef` 是 cancel 的關鍵；萃取後 ref 需在 hook 內管理 | hook 自持 `genTokenRef = useRef(0)`，App 只呼叫 `cancelGenerate()` |
| App.test.tsx 有 snapshot 或結構依賴，萃取後可能需要更新 | Unit 2 後即跑測試驗證，分批確認，不等到 Unit 3 |

## Sources & References

- Related code: `packages/extension/lib/batch-orchestrator.ts`（行 557）
- Related code: `packages/extension/lib/draft-diff.ts`（computeSlotDiff）
- Related code: `packages/extension/entrypoints/sidepanel/batch-review/ItemCard.tsx`
- Related code: `packages/extension/entrypoints/sidepanel/hooks/useTodayBatchDomain.ts`
- Institutional learning: `docs/solutions/developer-experience/extension-http-client-testability-injection-seam-2026-06-15.md`
- Prior plan: `docs/plans/2026-06-16-001-refactor-maintainability-test-refactor-plan.md`
