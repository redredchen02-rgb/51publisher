---
date: 2026-06-17
topic: comprehensive-scan-upgrade
---

# 51publisher 全面掃描與升級計畫

## Summary

一份跨六個維度（功能迭代、程式碼品質、效能、安全/基礎設施、測試、文件/DX）的完整現狀掃描與升級路線圖。以產品轉型（51publisher → 吃瓜小幫手）為北極星，按風險回報比排序為 7 個 Waves，每個 Wave 包含具體行動、受影響檔案及 effort estimate。

---

## Problem Frame

### 專案現狀

51publisher 經過 3 個月密集開發（300+ commits、~30 條 feature branches），已到達一個關鍵轉折點：

- **產品方向已變**：從「AI 生成草稿 → 填入後台發帖」轉為「爬取目標站資源 → AI 提煉成吃瓜草稿」。但 `README`、品牌名、entrypoints、核心 lib 仍殘留舊身份。
- **技術體質良好**：CI pipeline 完整（secret scan → audit → compile → lint → test → coverage → e2e → artifact verify + gitleaks）、80%+ 覆蓋率閘門、strict TypeScript、Biome 零錯誤──但仍有明顯的技術債積累。
- **從未真正上線**：首飛計畫存在但尚未執行。Docker 化就緒但無 production deployment。
- **大量腦暴/計畫文件已過時**：29/30 brainstorms 對應已合併功能，5/7 plans 標記 completed 但未歸檔。

### 驅動力

| 痛點 | 影響 |
|------|------|
| 產品身份裂痕（51publisher → 吃瓜小幫手） | 使用者困惑、品牌不一致、dead code 增加維護成本 |
| 核心檔案積累 >500 行 | 維護性下降、合併衝突風險上升、新功能開發變慢 |
| 無 production deployment | 功能僅能本地開發，無法提供服務 |
| E2E 測試覆蓋不足 | 最大防禦缺口，重構風險高 |
| 文件/計畫漂移 | 新貢獻者 onboarding 困難、歷史決策難以追溯 |

---

## Actors

- A1. **產品維運者（運營）**：使用工具生成吃瓜內容、管理爬取渠道、匯出草稿。關注功能完整性與使用流暢度。
- A2. **開發者（你）**：維護與迭代程式碼。關注程式碼健康度、測試覆蓋、開發體驗。
- A3. **部署維運者**：負責後端服務上線、監控、告警。關注部署流程、安全性、observability。
- A4. **程式碼審查者 / CI**：自動化檢查 pipeline。關注閘門完整性、測試可靠性。

---

## Key Flows

- F1. **吃瓜草稿產生流**
  - **Trigger:** 操作者鎖定目標 URL → 選擇渠道
  - **Actors:** A1
  - **Steps:** 鎖定 URL → SSRF allowlist 檢查 → 後端爬取 → LLM 提煉 → 側邊欄預覽 + 編輯 → 匯出 JSON/Markdown
  - **Outcome:** 結構化吃瓜草稿產出，可離線使用
  - **Covered by:** Wave 0 (R1-R5)

- F2. **開發迭代流**
  - **Trigger:** 開發者 checkout 新分支 → 修改程式碼
  - **Actors:** A2, A4
  - **Steps:** 修改 → pre-commit compile → commit → push → CI (secret scan + audit + compile + lint + test + coverage + e2e + artifact verify + gitleaks) → PR review → merge
  - **Outcome:** 安全合併至 main，所有閘門通過
  - **Covered by:** Wave 2 (R10-R13), Wave 4 (R15-R18)

- F3. **部署與維運流**
  - **Trigger:** 新版本 tag → release workflow
  - **Actors:** A3
  - **Steps:** Build Docker image → 產出 extension zip → GitHub Release → 部署至 production 主機 → healthcheck 驗證 → monitoring 啟動
  - **Outcome:** 服務上線，可對外提供 API
  - **Covered by:** Wave 2 (R10-R13)

- F4. **產品身份轉換流**
  - **Trigger:** 執行 rebrand
  - **Actors:** A2
  - **Steps:** 重新命名所有品牌字串 → 移除 publishing pipeline → 移除 comic source → 更新文件 → 推至新 repo
  - **Outcome:** 代碼庫與產品新身份一致
  - **Covered by:** Wave 0 (R1-R5)

---

## Requirements

### Wave 0 — 產品身份重鑄（最高優先級）

**品牌重命名**
- R1. 所有面向用戶字串（manifest、UI 文案、README）改為「吃瓜小幫手」，移除「51publisher / 發帖填充助手 / 發帖」字樣。
- R2. npm 套件 scope `@51guapi/*` → `@51guapi/*`（4 個 package.json + 所有 import path + pnpm --filter 引用）。
- R3. 三包版本統一設為 `0.1.0`（新產品身份的首個正式版）。
- R4. 代碼註釋與文件中的品牌詞替換（archive 歷史文件可保留原樣）。

**移除發布/填充機器**
- R5. 整條「填入目標後台」鏈路：`content.ts`、`quill-bridge.content.ts`、`lib/fillers.ts`、`lib/safety-gate.ts`、`lib/grounding-gate.ts`、`lib/publish-orchestrator.ts`、`lib/batch-orchestrator.ts`、Quill 橋接相關 entrypoints 與設定。
- R6. 移除對應測試（零提交測試、e2e fixture 中針對 webarticle-add 的填充驗證）與 fixture。
- R7. 清理因 R5/R6 變成無人引用的型別、訊息橋接、設定項，保持 `pnpm compile` 全綠。

**移除漫畫來源**
- R8. 刪除 `acgs51-adapter.ts`（含 test）。
- R9. 移除 `ACGS51_*` 環境變數及其在 `env-check.ts`、`index.ts`、scheduler、`.env.example` 的條件分支。
- R10. 從 SSRF allowlist 與文檔中移除 `51acgs.com` 硬編碼。

**強化爬取 + 提煉**
- R11. 多渠道 URL 管理：操作者可持續新增爬取目標（每個域名一條渠道），新增即進入 SSRF allowlist（fail-closed）。
- R12. 鎖定渠道後可爬取 → `gossip-fact-extractor` LLM 提煉 → 側邊欄可預覽編輯。
- R13. 匯出能力：提煉後的吃瓜草稿匯出為 JSON 與 Markdown。

**新 repo**
- R14. 新 repo `redredchen02-rgb/51guapi` 已建立（空倉），改造完成後推首版代碼。

### Wave 1 — 程式碼健康度整頓（高優先級）

- R15. **大型檔案拆分** — 以下檔案 (非測試) >500 行需規劃拆分方向：

| 檔案 | 行數 | 建議拆分 |
|------|------|---------|
| `entrypoints/background.ts` | 1172 | 入口 + message router + handler modules |
| `entrypoints/sidepanel/App.tsx` | 628 | 依路由拆分 sidebar panel views |
| `entrypoints/sidepanel/PendingTopicsView.tsx` | 620 | 抽 list/review/actions 子元件 |
| `entrypoints/sidepanel/TodayBatchView.tsx` | ~500 | 抽 sub-views (已有部分拆分) |
| `lib/bg-handlers.ts` | 1025 | 依 domain 拆分 handler files |
| `lib/storage.ts` | 566 | 拆 adapter 層與 operation 層 |
| `app.ts` (backend) | 409 | 路由註冊可拆 route modules |

- R16. **測試檔案拆分**：

| 檔案 | 行數 | 建議 |
|------|------|------|
| `batch-orchestrator.test.ts` | 1608 | 依測試類別拆多檔 |
| `background.test.ts` | 1520 | 依 handler 類型拆多檔 |

- R17. **Biome/工具更新**：Biome schema `2.4.16` → 最新穩定版；CI 中 Node 版本改為 22（與本地一致）。

- R18. **Branches 清理**：`git branch --merged main` 篩選可安全刪除的本地分支（16+ 條），確認 `git branch -d` 安全後清理。

- R19. **TypeScript 強化**：將 `noExplicitAny` 從 `warn` 升級為 `error`，逐步消除現有 `as any`/`@ts-expect-error`。

### Wave 2 — 基礎設施與部署（高優先級）

- R20. **Production Docker Compose**：補齊 docker-compose.yml，加入 reverse proxy（Caddy/nginx）、auto SSL、healthcheck 消費者。
- R21. **systemd / launchd 修正**：目前 `scripts/launchd/` 僅支援 macOS；提供 Linux systemd unit 或通用 Docker 部署腳本。
- R22. **環境變數文件更新**：`.env.example` 補齊所有必要欄位（CORS、SSRF allowlist、TG 告警等），移除 `change-this` 佔位值。
- R23. **CI release 修正**：`release.yml` 仍用 Node 20 → 改為 22；`docker save` 若無 Docker 不應失敗（conditional step）。

### Wave 3 — 測試補強（中優先級）

- R24. **E2E 測試框架**：使用 WXT + Playwright 建立真實瀏覽器 E2E 測試，覆蓋以下場景：
  - 側邊欄 UI 互動（settings 修改、草稿生成、批量審核檢視）
  - 後端 API 整合（auth login + pending CRUD + batch operations）
  - SSRF allowlist 阻擋與放行
- R25. **Integration tests**：補上 extension lib 與 backend 整合的測試（api-fetch 真實 HTTP 調用 mock 以外的路徑）。
- R26. **Flaky test 檢測**：在 CI 中加入 `--retry=2` 或 flaky test detector。

### Wave 4 — 效能優化（中優先級）

- R27. **Bundle size 監控**：在 CI + 或 pre-commit 中加入 `wxt analyze` 或 `size-limit`，防止 bundle 回歸。
- R28. **Lazy loading 盤點**：確認所有 sidepanel views 已動態 import（PR 記錄曾達成 374→244 kB 減量，需確認無回歸）。
- R29. **後端回應優化**：評估 caching layer（如 LRU cache for config/prompt 讀取）、LLM 串流回應改善 UX。

### Wave 5 — Observability（中優先級）

- R30. **Structured logging 統一**：後端已用 `pino`，確保所有 route 與 service 有一致的 requestId + 操作名 + 耗時 log。
- R31. **Healthz 強化**：目前 healthz 僅回 `{status: "ok"}`，建議加入 `llm/storage/publishFailAlert` dependency checks (已有部分實作)。
- R32. **Metrics dashboard**：考慮 Prometheus + Grafana 或輕量方案（如 `tinybird` / `uptrace`）來視覺化 metrics（llm latency、publish rate、error rate）。
- R33. **Telegram 告警強化**：目前 TG 告警僅在 scraper 連續失敗時觸發；擴展至 metrics threshold 告警。

### Wave 6 — 文件與開發體驗（低優先級）

- R34. **腦暴文件歸檔**：29/30 個 `docs/brainstorms/` 遷移至 `archive/`（保留 guapi rebrand 與 feedback-channel-ui）。
- R35. **計畫文件歸檔**：4 個已完成 `docs/plans/` 遷移至 `archive/`。
- R36. **舊版構想歸檔**：3 個 `docs/ideation/` 遷移至 `archive/`。
- R37. **API 文件**：後端 API routes 可自動生成 OpenAPI spec（`@fastify/swagger`），產出靜態文件。
- R38. **Architecture.md**：寫一份簡潔的架構文件，紀錄三世界模型、storage 雙軌、SSRF guard 等關鍵設計決策。
- R39. **Pre-commit 加入 lint**：目前 pre-commit 僅跑 compile；加入 `biome check --write` 進一步預防。

---

## Acceptance Examples

- AE1. **Covers R1-R4, R14.** 在 guapi repo clone、`pnpm install && pnpm compile && pnpm test` 全綠，搜索無「51publisher」字樣。
- AE2. **Covers R5-R7.** 在移除 publishing pipeline 後，`pnpm compile` 無 dangling reference，search `fillers` `safety-gate` `grounding-gate` `publish-orchestrator` 無殘留。
- AE3. **Covers R8-R10.** `ACGS51_` env var 不存在於 `.env.example`、`env-check.ts`、`index.ts`、scheduler；`51acgs.com` 不存在於 SSRF allowlist。
- AE4. **Covers R11-R13.** 在 sidepanel 「+ 新增渠道」輸入 `https://51cg1.com/` → 該域名加入 SSRF allowlist → 可對該域名發起爬取並看到吃瓜草稿 → 匯出按鈕產出有效 JSON 與 MD。
- AE5. **Covers R15-R16.** 所有 >500 lines 的 source file 拆分後無行為變化，現有測試全綠。
- AE6. **Covers R20-R21.** `docker-compose up -d` → `curl http://127.0.0.1:3001/api/v1/healthz` 回 `{"status":"ok"}`。
- AE7. **Covers R24.** E2E test: 啟動 browser → 載入 extension sidepanel → 開啟 settings page → 修改 endpoint → 儲存 → 讀取確認值匹配。

---

## Success Criteria

- **產品身份一致**：代碼庫（面向用戶處 + 套件名）搜不到「51publisher / 發帖」字樣；顯示名為「吃瓜小幫手」。
- **可部署上線**：`docker-compose up` 一條命令啟動所有服務，`healthz` endpoint 正常回應，支援 auto SSL。
- **開發者 onboarding < 30 min**：新貢獻者按 README 可順利啟動 dev server。
- **CI 維持綠色**：所有 Waves 改造後 `pnpm -r compile && pnpm -r test && pnpm lint:ci` 全綠。
- **E2E 覆蓋關鍵路徑**：最少 3 條 E2E 測試路徑（settings + batch + auth）在 CI 中穩定通過。

---

## Scope Boundaries

### Deferred for later

- **Firefox 支援**：目前僅 Chromium；待吃瓜產品站穩 v0.1 後再評估。
- **CI 中補上自動化 screenshot diff**：需 VS 或 Playwright visual regression 基礎設施，評估後納入。
- **Migration 至 tRPC / GraphQL**：當前 REST + fetch 模式健康，無改動必要。
- **多語系（i18n）**：產品以中文為唯一語言，暫無 i18n 需求。

### Outside this product's identity

- **做發布/填充第三方後台**：已確認不是吃瓜小幫手的核心，不保留「以後可能要發帖」的開關。
- **做通用爬取平台**：專注於吃瓜場景的爬取 + 提煉；不做通用內容聚合平台。
- **做 UX/UI 框架重寫**：當前 CSS modules + plain React 足夠；不引入 Tailwind / shadcn 等地層框架。

---

## Key Decisions

| 決策 | 理由 |
|------|------|
| **Wave 0 作為第一優先** | 產品身份是其他所有決策的前提；先 rebrand 再重構比反過來少一半衝突 |
| **Wave 1 緊隨其後** | 大型檔案是 daily development 的 friction point；越晚拆分成本越高 |
| **Wave 2 （部署）與 Wave 0 可並行** | Docker 化與 rebrand 零檔案重疊，可平行進行 |
| **E2E 放到 Wave 3** | 部署上線後才有真實目標可測；目前 unit + component tests 撐得住 |
| **Observability 放 Wave 5** | production 上線前不需要；上線後立即需要 |
| **文件清理放最後** | 產品轉型會使大量文件過時；等 Waves 0-2 完成後再清理最有效率 |
| **guapi rebrand 幅度大 → 獨立 PR** | 避免與其他 Wave 衝突；建議開 `feat/guapi-rebrand` branch |

---

## Dependencies / Assumptions

- **假設 guapi rebrand 是確認的產品方向**：若產品方向反轉（不做吃瓜），Wave 0 的大部分工作即取消。
- **假設新 repo 權限已就緒**：操作者需要 GitHub push 權限至 `redredchen02-rgb/51guapi`。
- **假設第三方後台的 Quill 填充邏輯不再需要**：若仍須填充原 51publisher 後台，R5-R7 的移除範圍需重新評估。
- **假設 acgs51.com 爬取來源已無商業價值**：若仍須維護，R8-R10 的移除範圍需重新評估。

---

## Outstanding Questions

### Resolve Before Planning

- (none — 掃描階段已完成，方向已確認)

### Deferred to Planning

- [Affects R11][Technical] 渠道清單的儲存形式（SQLite vs JSON）與 SSRF allowlist 即時同步機制。
- [Affects R13][Technical] 匯出格式除 JSON / Markdown 外是否要 CSV？欄位與吃瓜事實結構對應。
- [Affects R5][Technical] 移除發布鏈路後，background service worker 訊息路由與 sidepanel 狀態機需重新梳理。
- [Affects R12][Needs research] 現有 `gossip-fact-extractor` 是否耦合了 acgs51 來源格式。
- [Affects R15][Technical] 大型檔案拆分的 PR 順序與互斥策略。
- [Affects R20][Technical] Production Docker compose 的 reverse proxy 選擇（Caddy vs nginx vs Traefik）。
- [Affects R24][Needs research] Playwright 在 WXT MV3 環境下的 authentiation 與 extension loading 方式。
