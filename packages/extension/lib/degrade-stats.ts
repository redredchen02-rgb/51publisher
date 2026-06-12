import type { BatchItem } from "./batch";

export interface DegradeStats {
	/** 有至少一个字段降级的条目数。 */
	itemsWithAnyDegrade: number;
	/** 有 fillResults 的条目总数(分母)。 */
	totalItemsWithResults: number;
	/** 降级次数最多的字段(最多取前 5)。 */
	topFields: Array<{ field: string; count: number }>;
}

/** 从 BatchItem 数组聚合 degrade 统计。纯函数,无副作用。 */
export function aggregateDegradeStats(items: BatchItem[]): DegradeStats {
	const withResults = items.filter(
		(it) => it.fillResults && it.fillResults.length > 0,
	);
	const itemsWithAnyDegrade = withResults.filter((it) =>
		it.fillResults?.some((r) => r.status === "degraded"),
	).length;

	// 按 field 名聚合降级次数(不解析 note 文本)。
	const fieldCounts = new Map<string, number>();
	for (const item of withResults) {
		for (const r of item.fillResults!) {
			if (r.status === "degraded") {
				fieldCounts.set(r.field, (fieldCounts.get(r.field) ?? 0) + 1);
			}
		}
	}

	const topFields = Array.from(fieldCounts.entries())
		.sort((a, b) => b[1] - a[1])
		.slice(0, 5)
		.map(([field, count]) => ({ field, count }));

	return {
		itemsWithAnyDegrade,
		totalItemsWithResults: withResults.length,
		topFields,
	};
}
