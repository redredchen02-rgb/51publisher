# Build Performance Baseline

紀錄日期: 2026-06-16
Node: v22.22.3（開發機）/ 20.x（CI）
pnpm: 10.33.0

## 測量結果（開發機，單次冷快取）

| 構建目標 | 指令 | 實測時間 |
|----------|------|---------|
| `@51guapi/shared` | `pnpm --filter @51guapi/shared build` | **0.66s** |
| `@51guapi/backend` | `pnpm --filter "@51guapi/backend" build` | **3.58s** |
| `@51guapi/extension` | `pnpm build:extension` | **2.30s** |

> 建議用 `hyperfine --warmup 1` 在同一台機器上跑三次取中位數作為更可靠基線。
> CI 環境數據應從 GitHub Actions log 讀取後更新至下方歷史表。

## 目標閾值

| 構建目標 | 開發機基線 | CI 目標 | 優化觸發線 |
|----------|-----------|---------|-----------|
| `@51guapi/shared` | 0.66s | < 5s | > 10s |
| `@51guapi/backend` | 3.58s | < 15s | > 30s |
| `@51guapi/extension` | 2.30s | < 30s | > 60s |

## CI 構建時間歷史

| Commit | 日期 | Backend | Extension | Shared | 總和 |
|--------|------|---------|-----------|--------|------|
| 8f343417 | 2026-06-16 | — | — | — | — |

## 優化歷史

| 日期 | 變更 | 效果 |
|------|------|------|
| 2026-06-16 | 初次基線建立 | — |
