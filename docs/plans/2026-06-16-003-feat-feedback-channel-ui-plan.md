---
title: "feat: 发布反馈通道 UI — HistoryPanel 评分 + MetricsPanel 满意度统计"
type: feat
status: active
date: 2026-06-16
origin: docs/brainstorms/2026-06-16-feedback-channel-ui-requirements.md
---

# 发布反馈通道 UI

## Overview

`publish-feedback.ts` 底层（`saveFeedback` / `getFeedbackForItem` / `getFeedback`）已就绪但无 UI 入口。本计划在 HistoryPanel 每条 `publish-confirmed` 记录上加 good/ok/bad 评分按钮，并在 MetricsPanel 新增满意度统计 section，打通学习闭环。

## Problem Frame

运营者发布后无法对内容评分，导致度量面板缺少满意度维度，无法从数据中识别哪类生成质量好、哪类需要改进 prompt。`publish-feedback.ts` 已有完整的存储层，唯缺 UI。

## Requirements Trace

- R1. HistoryPanel 每条记录右侧显示 👍 好 / 😐 一般 / 👎 差 三态按钮
- R2. 已评分条目显示当前评分高亮；未评分显示淡色待选
- R3. 点击调用 `saveFeedback`（同一 itemId 覆写），无需确认弹窗
- R4. 乐观更新；`saveFeedback` 抛错则回滚 UI 到未评分状态
- R5. 仅对 `status === "publish-confirmed"` 的条目显示评分（非发布条目不显示）
- R6. MetricsPanel 新增「用户反馈」section：已评分条数 / 好评率 / 差评率
- R7. 仅有 ≥1 条评分时显示该 section

## Scope Boundaries

- 不做评分备注/文字输入（`note` 字段留待后续）
- 不同步评分到后端（纯本地 chrome.storage）
- 不改动 `publish-feedback.ts` 底层接口

## Context & Research

### Relevant Code and Patterns

- `packages/extension/lib/publish-feedback.ts` — `saveFeedback` / `getFeedbackForItem` / `getFeedback`；upsert 语义，同 itemId 覆写
- `packages/extension/entrypoints/sidepanel/HistoryPanel.tsx` — `<li>` 用 `r.id` 为 key；当前列表项无 action button；第二行 `display:flex, gap:var(--space-lg)` 可直接追加评分行
- `packages/extension/lib/trajectory.ts` — `TrajectoryRecord.status` 已知值：`"publish-confirmed"` / `"needs-human-verification"` / `"error"` / `"aborted"`
- `packages/extension/entrypoints/sidepanel/MetricsPanel.tsx` — section 模式：`<section>` + `<h2>` + `<StatCard>` + `display:flex wrap`；按钮 class `btn btn-plain btn-sm`
- Storage 模式：WXT `storage`（`#imports`），`useEffect` 内 `void (async () => { ... })()`

### Institutional Learnings

- 无相关 `docs/solutions/` 记录（此为新功能）

## Key Technical Decisions

- **乐观更新 + `.catch` 回滚**：评分点击后立即更新本地 `Map<itemId, rating>` 状态；`saveFeedback` 若 reject 则 `.catch` 回滚到原值（或 `undefined`），避免 UI 与存储不同步
- **批量预读 vs. 按需读**：mount 时一次性调 `getFeedback()` 取全量，建成 `Map<itemId, FeedbackRating>` 供列表渲染使用，避免每条 item 独立发起存储请求
- **不抽 HistoryItem 子组件**：当前 `visible.map()` 内联渲染，评分状态只需一个 map state 即可驱动全列表，无需拆子组件
- **`status === "publish-confirmed"` 过滤**：研究确认此为真实发布状态值（非 `"published"`）；`needs-human-verification` / `error` / `aborted` 条目不显示评分

## Open Questions

### Resolved During Planning

- **TrajectoryRecord.status 字段存在吗？** 已确认，类型为 `string`，真实发布值为 `"publish-confirmed"`（见 `lib/trajectory.ts:10-43`）
- **是否需要抽 HistoryItem 子组件？** 否，map state 驱动足够；过度抽取无收益

### Deferred to Implementation

- **按钮样式细节**：是否用 emoji 还是文字 label（👍/😐/👎 vs. 好/一般/差），实现时根据 UI 效果决定

## Implementation Units

- [ ] **Unit 1: HistoryPanel — 评分按钮 + 乐观更新**

**Goal:** 在 HistoryPanel 每条 `publish-confirmed` 记录下方加评分行，支持点击、高亮、乐观更新、失败回滚

**Requirements:** R1, R2, R3, R4, R5

**Dependencies:** 无（`publish-feedback.ts` 已就绪）

**Files:**
- Modify: `packages/extension/entrypoints/sidepanel/HistoryPanel.tsx`
- Test: `packages/extension/entrypoints/sidepanel/HistoryPanel.test.tsx`（若无则新建）

**Approach:**
- `useEffect` mount 时调 `getFeedback()` 取全量，建成 `useState<Map<string, FeedbackRating>>`（`feedbackMap`）
- 按钮点击：先 optimistic 更新 `feedbackMap`，再 `saveFeedback({ itemId: r.id, topic: r.topic, rating, ts })` → `.catch(err => 回滚到原值)`；`topic` 字段从 `TrajectoryRecord.topic` 取得
- 仅当 `r.status === "publish-confirmed"` 时渲染评分行
- 已选中的 rating 按钮加 `color: var(--color-primary)` 或 `font-weight:700` 区分；未评分按钮用 `color: var(--color-text-disabled)`
- 评分行布局：`display:flex, gap:var(--space-md)` 跟随现有第二行风格；按钮 class `btn btn-plain btn-sm`

**Patterns to follow:**
- `useEffect` + `void (async () => { ... })()` 模式（同 MetricsPanel.tsx / HistoryPanel 现有 effect）
- `btn btn-plain btn-sm` class（同 MetricsPanel 返回按钮）

**Test scenarios:**
- Happy path: `publish-confirmed` 条目渲染三个评分按钮；点击「好」后该按钮变高亮，其余两个不高亮
- Happy path: 已有评分记录时 mount 后对应按钮直接显示高亮
- Edge case: `needs-human-verification` / `error` / `aborted` 条目不渲染评分行
- Edge case: `feedbackMap` 为空 Map 时所有按钮处于淡色待选状态
- Error path: `saveFeedback` 被 mock 为 reject → UI 应回滚至点击前的 rating 值（或 undefined）
- Edge case: 对同一条目二次点击不同 rating → feedbackMap 更新为新值，覆写旧值

**Verification:**
- `pnpm test` 全绿
- 在 `publish-confirmed` 条目上可见三个评分按钮；`error` 条目无按钮
- 点击评分后按钮高亮立即响应（乐观更新）

---

- [ ] **Unit 2: MetricsPanel — 用户反馈 section**

**Goal:** 在 MetricsPanel 新增「用户反馈」section，展示已评分条数、好评率、差评率

**Requirements:** R6, R7

**Dependencies:** Unit 1（`publish-feedback.ts` 已就绪，无强依赖）

**Files:**
- Modify: `packages/extension/entrypoints/sidepanel/MetricsPanel.tsx`
- Test: （MetricsPanel 目前无独立测试文件，在 Unit 2 新建或验证现有 App.test.tsx 覆盖）

**Approach:**
- 在 `useEffect` 里与现有 `getTrajectory()` 并行调 `getFeedback()`，加入 `MetricsData` 接口
- 计算：`goodRate = good条数 / 已评分总数 * 100`，`badRate = bad条数 / 已评分总数 * 100`
- 仅当 `feedbackList.length >= 1` 时渲染该 section（R7）
- 复用 `StatCard` 组件；section 结构与现有 section 完全一致

**Patterns to follow:**
- `MetricsPanel.tsx` 现有 section 模式（`<section>` + `<h2>` + `<div>flex wrap>` + `<StatCard>`）
- `Promise.all` 并行 fetch（MetricsPanel 现有 `useEffect` 模式）

**Test scenarios:**
- Happy path: 有 3 条评分（2 good, 1 bad）→ 显示「已评分 3 条」「好评率 67%」「差评率 33%」
- Edge case: 0 条评分 → 不渲染「用户反馈」section（R7）
- Edge case: 全部为 `ok` 评分 → 好评率 0%、差评率 0%，已评分条数正确

**Verification:**
- `pnpm test` 全绿
- 度量面板「用户反馈」section 在有评分数据时正确显示三张 StatCard

## System-Wide Impact

- **Interaction graph:** 仅影响 HistoryPanel + MetricsPanel 两个组件；`publish-feedback.ts` 底层不变
- **Error propagation:** `saveFeedback` 失败 → `.catch` 回滚本地状态，不向上抛错，不影响列表其他操作
- **State lifecycle risks:** `feedbackMap` 为组件级 state，组件卸载即清空，无持久化风险；`chrome.storage` 容量极少（每条评分 ~100 字节，500 条上限已在 `publish-feedback.ts` 控制）
- **Unchanged invariants:** `HistoryPanel` 的轨迹链完整性检查、回滚目标逻辑、分页逻辑均不受影响

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| `saveFeedback` 存储失败时 UI 状态不同步 | `.catch` 回滚 `feedbackMap` 到原值（R4 明确要求） |
| `TrajectoryRecord.status` 新增未知值导致意外显示 | 用 `=== "publish-confirmed"` 精确匹配而非排除法 |
| `getFeedback()` 在 mount 时与 `getTrajectory()` 竞争 | `Promise.all` 并行，无顺序依赖 |

## Sources & References

- **Origin document:** [docs/brainstorms/2026-06-16-feedback-channel-ui-requirements.md](../brainstorms/2026-06-16-feedback-channel-ui-requirements.md)
- Related code: `packages/extension/lib/publish-feedback.ts`, `packages/extension/lib/trajectory.ts`
- Related code: `packages/extension/entrypoints/sidepanel/HistoryPanel.tsx`, `MetricsPanel.tsx`
