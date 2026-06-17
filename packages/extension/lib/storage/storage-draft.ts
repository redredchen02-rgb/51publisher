import type { ContentDraft } from "@51guapi/shared";
import { storage } from "#imports";
import type { TrajectoryInput, TrajectoryRecord } from "../safety/trajectory";
import { appendRecord } from "../safety/trajectory";

const CURRENT_DRAFT_KEY = "local:currentDraft";
const TRAJECTORY_KEY = "local:trajectory";
const DRY_RUN_REPORT_KEY = "local:dryRunReport";

// 当前在编草稿的崩溃恢复(≠ 草稿库):side panel 重开/SW 回收/目标页刷新都可能丢失,
// 故每次草稿变更写一份;"下一条"或发布完成时清除。
export async function getCurrentDraft(): Promise<ContentDraft | null> {
	return (await storage.getItem<ContentDraft>(CURRENT_DRAFT_KEY)) ?? null;
}

export async function saveCurrentDraft(draft: ContentDraft): Promise<void> {
	await storage.setItem(CURRENT_DRAFT_KEY, draft);
}

export async function clearCurrentDraft(): Promise<void> {
	await storage.removeItem(CURRENT_DRAFT_KEY);
}

// ---- 轨迹存档(追加式 + 运行时脱敏闸门)----

export async function getTrajectory(): Promise<TrajectoryRecord[]> {
	const stored = await storage.getItem<TrajectoryRecord[]>(TRAJECTORY_KEY);
	return Array.isArray(stored) ? stored : [];
}

/**
 * 追加一条轨迹。脱敏闸门(scrubSnapshot)在 appendRecord 内部跑:
 * rawSnapshot 清洗失败 → 不存快照(snapshotDropped=true),record 仍落。
 * 返回 snapshotDropped 供调用方报警。
 */
export async function appendTrajectory(
	input: TrajectoryInput,
): Promise<{ snapshotDropped: boolean }> {
	const current = await getTrajectory();
	const { list, snapshotDropped } = appendRecord(current, input);
	await storage.setItem(TRAJECTORY_KEY, list);
	return { snapshotDropped };
}

export async function clearTrajectory(): Promise<void> {
	await storage.removeItem(TRAJECTORY_KEY);
}

// ---- Dry-run 填充报告 ----
// 每次 dry-run 批准后写入;下次覆盖;side panel 读出展示。fail-closed:非法值 → null。

export async function saveDryRunReport(
	report: import("@51guapi/shared").DryRunReport,
): Promise<void> {
	await storage.setItem(DRY_RUN_REPORT_KEY, report);
}

export async function getDryRunReport(): Promise<
	import("@51guapi/shared").DryRunReport | null
> {
	const v = await storage.getItem<unknown>(DRY_RUN_REPORT_KEY);
	if (
		v &&
		typeof v === "object" &&
		"batchId" in v &&
		"items" in v &&
		Array.isArray((v as Record<string, unknown>).items)
	) {
		return v as import("@51guapi/shared").DryRunReport;
	}
	return null;
}

export async function clearDryRunReport(): Promise<void> {
	await storage.removeItem(DRY_RUN_REPORT_KEY);
}
