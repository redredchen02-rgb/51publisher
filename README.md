# 51guapi 吃瓜小幫手

> **AI 生成吃瓜短文 → 人工審核 → 一鍵填入後台表單 → 人工決定發布**

Chrome 擴展 + 本地後端服務。大模型負責寫口吻散文，事實（作品名/集數/連結）由系統從你提供的數據原樣注入——模型碰不到事實，從流程上消滅編造。

---

## 核心設計原則

| 原則 | 實現方式 |
| --- | --- |
| **人工最終控制** | 插件只填充表單，絕不自動提交或點發布；發布動作必須由人工完成 |
| **防幻覺** | 模型只寫口吻散文；作品名/集數/連結由程式從事實原樣注入，模型碰不到 |
| **fail-closed** | 草稿含【待補】標記或連結非來源時，authorized 發布前硬閘攔截 |
| **XSS 防護** | LLM 返回的 HTML 寫入編輯器前按白名單消毒 |

---

## 快速開始

**完整步驟見 [安裝與使用指南](docs/install-and-usage.md)**，這裡給三分鐘速覽。

### 1. 安裝依賴

```bash
git clone <倉庫地址> && cd 51guapi
git config core.hooksPath scripts/git-hooks   # 啟用脫敏 pre-commit hook
pnpm install
```

### 2. 配置並啟動後端

```bash
cp packages/backend/.env.example packages/backend/.env
# 編輯 .env，填入 LLM_API_KEY、JWT_SECRET 等必填項（endpoint 已預設）
pnpm dev:backend
```

> 啟動成功驗證：`curl http://127.0.0.1:3001/api/v1/healthz` 返回 `{"status":"ok"}`

### 3. 構建並加載擴展

```bash
pnpm build:extension
```

Chrome → `chrome://extensions` → 開啟開發者模式 → 「載入已解壓的擴充功能」→ 選 `packages/extension/.output/chrome-mv3/`

### 4. 首次配置

側邊欄右上角「⚙ 設定」，填寫以下內容後儲存：

| 項 | 填寫內容 |
| --- | --- |
| **endpoint** | `https://la-sealion.inaiai.com/v1` |
| **模型** | `gemma4-31b-heretic`（或點「↻ 拉取模型列表」選擇） |
| **API key** | 你在 la-sealion 平台的 API Key |

能成功拉到模型列表，說明配置正確。

---

## 工作流程

```
輸入選題(+ 事實)
      ↓
  AI 生成草稿          ← 模型只寫口吻散文
      ↓
 系統注入事實          ← 作品名/集數/連結原樣填入，模型碰不到
      ↓
  側邊欄審核卡         ← 檢視事實注入狀態、連結來源標註、硬閘預判
      ↓
  一鍵填入表單
      ↓
  人工核對 → 手動點發布
```

### 單條流程

1. 在後台打開「添加帖子」表單
2. 側邊欄輸入主題 → 「生成草稿」
3. 預覽區核對/修改內容；非 AI 欄位可在折疊區手填
4. 「填充到當前頁」→ 填充結果：綠=已填 / 黃=跳過 / 紅=需手動粘貼
5. 人工在後台核對 → 手動點發布
6. 「下一條」清空當前草稿，繼續

### 批量流程（推薦日常使用）

進入側邊欄 **≣ 批量** 檢視：

**輸入格式：** `選題 || 欄位=值 | 欄位=值`

```
住在拔作島上的我該如何是好介紹 || 作品名=住在拔作島上的我該如何是好 | 集數=2期 | 漢化=https://…
精靈寶可夢同人推薦 || 作品名=精靈寶可夢 | 題材=同人本 | 簡介=莉莉艾/奇樹
某新番(只寫選題，缺的事實標【待補】，AI 不會編造)
```

支援欄位：`作品名` `集數` `製作` `漢化` `無修` `題材` `簡介`

**操作步驟：**

1. 輸入選題列表 → 「開始批量（生成+填充）」；或點「今日一鍵備稿」自動取高質量選題
2. 批量檢視展示批次狀態：待審 / 發布中 / 已發布 / 失敗
3. 展開每條草稿檢視/編輯；批准前須逐篇展開閱讀
4. 在設定頁選擇發布檔位後批准

---

## 功能一覽

### 基礎功能
- AI 生成帖子草稿（標題 + 簡介 + 正文 + 標籤）
- 批量生成與管理
- 草稿自動恢復（側邊欄關閉/重新整理不遺失）
- 歷史記錄檢視

### 審核保障
- 事實注入狀態面板（每個欄位標 ✓已注入 / —未提供）
- 連結來源標註（✓ 程式注入 / ✗ 非來源，異常即紅標）
- 發布前硬閘（grounding gate）
- 選擇器漂移自檢

### 進階功能
- **自動抓取選題**：定時抓取作品，構建待審選題池，支援「今日一鍵備稿」
- **Web 搜尋富化**：抓取後自動搜尋補充作品資訊，讓草稿內容更豐富
- **質量門禁**：五維度評估（正文長度、事實完整性、標題品質、口吻、標籤數量）
- **Telegram 告警**：抓取連續失敗或異常時自動推送通知

---

## 安全與邊界

- **不自動提交/發布**（硬約束）：除非顯式切到 `authorized` 並打字確認
- **防幻覺**：AI 只寫口吻散文；作品名/集數/連結由程式 verbatim 注入，模型碰不到。`authorized` 發布前有硬閘
- **API key 安全**：明文存本地，只在 background service worker 裡使用
- **XSS 防護**：LLM 返回的 HTML 寫入前按白名單消毒

---

## 後端運維

### macOS 開機自動啟動

```bash
pnpm build:backend
bash scripts/launchd/install.sh      # 註冊 launchd daemon，開機自啟
bash scripts/launchd/uninstall.sh    # 卸載
```

日誌：`/tmp/51guapi-backend.log`。健康檢查：`GET /api/v1/healthz`（無需鑑權）。

---

## 專案結構

```
51guapi/
├── packages/
│   ├── extension/          # Chrome 擴展（WXT + React 19 + Manifest V3）
│   │   ├── entrypoints/
│   │   │   └── sidepanel/              # React UI
│   │   └── lib/                        # 核心邏輯
│   ├── backend/            # Fastify 5 + TypeScript，埠 3001
│   │   └── src/
│   │       ├── routes/                 # 路由（gossip/pending/scraper/prompt）
│   │       └── scraper/                # 選題抓取管線
│   └── shared/             # 跨端共享型別與純邏輯
└── docs/                   # 詳細文件
```

---

## 常用命令

```bash
# 開發
pnpm dev:extension          # 擴展熱更新
pnpm dev:backend            # 後端熱更新

# 構建
pnpm build:extension        # 產出 packages/extension/.output/chrome-mv3/
pnpm build:backend          # 產出 packages/backend/dist/

# 測試與檢查
pnpm test                   # 全包單元測試（vitest）
pnpm compile                # 全包 tsc 型別檢查
pnpm lint                   # biome 格式化
bash scripts/check-all.sh   # 測試 + 雙端構建 + 產物校驗（提交前跑）
```

---

## 文件索引

| 文件 | 內容 |
| --- | --- |
| [安裝與使用指南](docs/install-and-usage.md) | 完整安裝、配置、使用流程、常見問題 |
| [批量使用指南](docs/batch-usage-guide.md) | 批量流程詳細說明 |
| [Dry-run 策略](docs/dry-run-strategy.md) | 預演模式使用說明 |
| [字段映射指南](docs/field-mapping-guide.md) | 後台改版時如何更新選擇器 |
| [自動生成指南](docs/auto-generate-guide.md) | 自動抓取選題與批量生成 |
