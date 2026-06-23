import type { Batch } from "./batch";
import { logger } from "./logger";
import {
	clearAllFillTombstones,
	clearFillTombstone,
	getBatch as getBatchRaw,
	getFillTombstones,
	saveBatch,
	setPendingQuarantineAlert,
} from "./storage";

/**
 * SW 启动恢复:将上次 SW 被杀时卡在 generating 状态的条目标记为 error,
 * 让操作者可以重试。gate-failed 类终态不受影响。
 * 失败时只 warn,绝不阻断 SW 启动。
 */
export async function runStartupGeneratingRecovery(
	deps: {
		getBatch: () => Promise<Batch | null>;
		saveBatch: (b: Batch) => Promise<void>;
	} = { getBatch: getBatchRaw, saveBatch },
): Promise<void> {
	try {
		const batch = await deps.getBatch();
		if (!batch) return;
		let changed = false;
		for (const item of batch.items) {
			if (item.status === "generating") {
				item.status = "error";
				item.error = "SW restarted during generation";
				changed = true;
			}
		}
		if (changed) await deps.saveBatch(batch);
	} catch (e) {
		logger.warn("bg", "generating recovery scan 失败", {
			err: e instanceof Error ? e.message : String(e),
		});
	}
}

export async function runStartupTombstoneScan(): Promise<void> {
	try {
		const [batch, tombstones] = await Promise.all([
			getBatchRaw(),
			getFillTombstones(),
		]);
		const tombstoneIds = Object.keys(tombstones);
		if (tombstoneIds.length === 0) return;

		// 清理无对应 batch 条目的残留 tombstone(重置/新批次后的孤儿)。
		if (batch) {
			const batchItemIds = new Set(batch.items.map((it) => it.id));
			const stale = tombstoneIds.filter((id) => !batchItemIds.has(id));
			for (const id of stale) {
				await clearFillTombstone(id).catch(() => {});
			}
		} else {
			await clearAllFillTombstones().catch(() => {});
		}

		// 统计 needs-human-verification 条目;有则设通知计数。
		const nhvCount = batch
			? batch.items.filter((it) => it.status === "needs-human-verification")
					.length
			: 0;
		if (nhvCount > 0) {
			await setPendingQuarantineAlert(nhvCount);
		}
	} catch (e) {
		logger.warn("bg", "tombstone startup scan 失败", {
			err: e instanceof Error ? e.message : String(e),
		});
	}
}
