import type { ContentDraft } from "@51publisher/shared";
import { logger } from "../logger";
import type { GateDecision } from "../publish-orchestrator";

/** 传给互锁守卫的一笔意图身份(host 由 evaluateGate 给出)。 */
export interface FirstFlightDispatch {
	itemId: string;
	tabId: number;
	host: string;
	draft: ContentDraft;
}

/**
 * 首飞互锁守卫(Unit 5):省略=不启用(无标记场景零行为变更)。
 * 在 fill 决策点 AND grant 前各求值一次(每次重读标记 close TOCTOU)。
 * allowed=false → 跳过本条(既不 fill 也不 grant),无 fill 副作用、无 grant 泄漏。
 */
export type FirstFlightGuard = (
	ctx: FirstFlightDispatch,
) => Promise<{ allowed: boolean }>;

export function defaultSnapshotDropped(itemId: string): void {
	logger.warn("batch-orchestrator", "轨迹快照含机密被丢弃", { itemId });
}

/**
 * 构造 preGrantGuard callback,在 grant 前重读标记 + 重解析 host(close TOCTOU)。
 * 返回符合 orchestratePublish preGrantGuard 签名的函数。
 */
export function createPreGrantGuard(
	firstFlightGuard: FirstFlightGuard,
	evaluateGate: () => Promise<GateDecision>,
	batchTabId: number,
): () => Promise<{ allowed: boolean }> {
	return async () => {
		const g = await evaluateGate();
		if (g.mode !== "authorized") return { allowed: false };
		if (g.host == null) return { allowed: false };
		return firstFlightGuard({
			itemId: "", // 由调用方重写填充
			tabId: batchTabId,
			host: g.host,
			draft: {} as ContentDraft, // 由调用方重写填充
		});
	};
}
