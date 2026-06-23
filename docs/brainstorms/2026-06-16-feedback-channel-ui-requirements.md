---
date: 2026-06-16
topic: feedback-channel-ui
---

# 发布反馈通道 UI

## Problem Frame

`publish-feedback.ts` 已有完整底层（`saveFeedback` / `getFeedback` / `getFeedbackForItem`），但没有任何 UI 入口调用它。运营者发布后无法对内容评分，度量面板缺少满意度维度，导致学习闭环断路——无法知道哪类生成质量好、哪类需要改进 prompt。

## Requirements

**HistoryPanel 评分入口**
- R1. 历史记录列表的每条 `TrajectoryRecord` 右侧显示评分按钮组：👍 好 / 😐 一般 / 👎 差（三态）
- R2. 已评分的条目显示当前评分高亮状态；未评分显示为淡色待选状态
- R3. 点击按钮调用 `saveFeedback`（同一 `itemId` 覆写），无需确认弹窗
- R4. 评分操作本地即时更新（乐观更新）；若 `saveFeedback` 抛错则回滚 UI 到未评分状态
- R5. 评分仅对 `status === "published"` 的条目显示；草稿/失败条目不显示（前提：`TrajectoryRecord.status` 字段存在）

**MetricsPanel 满意度统计**
- R6. 度量面板新增「用户反馈」section，展示：已评分条数 / 好评率 / 差评率
- R7. 仅在有 ≥1 条评分时显示该 section（零数据不占位）

## Success Criteria

- 运营者完成首飞后，可在 HistoryPanel 对每条发布内容评分
- MetricsPanel 的「用户反馈」section 正确显示评分聚合
- `pnpm test` 全绿（新增 `HistoryPanel` 评分按钮的单测）

## Scope Boundaries

- 不做评分备注/文字输入（`note` 字段留待后续）
- 不同步评分到后端（纯本地 chrome.storage）
- 不改动 `publish-feedback.ts` 底层接口

## Key Decisions

- 入口位置选 HistoryPanel：不打断发布流程，允许事后评分
- 乐观更新：评分响应要即时，不等 storage.setItem 回调

## Outstanding Questions

### Deferred to Planning
- [Affects R1][Technical] HistoryPanel 当前每条记录用 `map` 渲染，是否需要抽 `HistoryItem` 子组件来容纳评分状态？

## Next Steps
→ `/ce:plan` 实施规划
