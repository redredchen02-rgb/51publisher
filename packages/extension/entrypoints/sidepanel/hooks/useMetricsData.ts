import { useEffect, useState } from "react";
import type { TrajectoryRecord } from "../../../lib/safety/trajectory";
import {
	getBackendToken,
	getSettings,
	getTrajectory,
} from "../../../lib/storage";

// ---- 统计计算（纯函数，可独立测试）----

export interface ComputedMetrics {
	/** Token 用量 */
	totalPromptTokens: number;
	totalCompletionTokens: number;
	avgCompletionTokens: number;
	tokenRecordCount: number;
	/** 编辑率 */
	editedCount: number;
	withDiffCount: number;
	editRate: number;
	/** 直发率 */
	directPublishRate: number | null;
	/** AI 评审触发率 */
	reviewRate: number | null;
	/** 平均生成时长 */
	avgDurationSec: string | null;
	durationRecordCount: number;
}

export function computeMetrics(
	trajectory: TrajectoryRecord[],
): ComputedMetrics {
	// Token 用量
	const withTokens = trajectory.filter((r) => r.llmCostTokens);
	const totalPromptTokens = withTokens.reduce(
		(s, r) => s + (r.llmCostTokens?.prompt ?? 0),
		0,
	);
	const totalCompletionTokens = withTokens.reduce(
		(s, r) => s + (r.llmCostTokens?.completion ?? 0),
		0,
	);
	const avgCompletionTokens =
		withTokens.length > 0
			? Math.round(totalCompletionTokens / withTokens.length)
			: 0;

	// 编辑率 (slot-diff)
	const withDiff = trajectory.filter((r) => r.slotDiff && !r.slotDiff.unknown);
	const editedCount = withDiff.filter(
		(r) => (r.slotDiff?.changedSlots?.length ?? 0) > 0,
	).length;
	const editRate =
		withDiff.length > 0 ? Math.round((editedCount / withDiff.length) * 100) : 0;

	// 直发率 (无手动改稿)
	const withEditFlag = trajectory.filter((r) => r.hasManualEdit !== undefined);
	const directPublishRate =
		withEditFlag.length > 0
			? Math.round(
					(withEditFlag.filter((r) => !r.hasManualEdit).length /
						withEditFlag.length) *
						100,
				)
			: null;

	// 平均生成时长
	const withDuration = trajectory.filter((r) => r.generationDurationMs != null);
	const avgDurationSec =
		withDuration.length > 0
			? (
					withDuration.reduce((s, r) => s + (r.generationDurationMs ?? 0), 0) /
					withDuration.length /
					1000
				).toFixed(1)
			: null;

	// AI 评审触发率
	const withReview = trajectory.filter(
		(r) => r.aiReviewTriggered !== undefined,
	);
	const reviewRate =
		withReview.length > 0
			? Math.round(
					(withReview.filter((r) => r.aiReviewTriggered).length /
						withReview.length) *
						100,
				)
			: null;

	return {
		totalPromptTokens,
		totalCompletionTokens,
		avgCompletionTokens,
		tokenRecordCount: withTokens.length,
		editedCount,
		withDiffCount: withDiff.length,
		editRate,
		directPublishRate,
		reviewRate,
		avgDurationSec,
		durationRecordCount: withDuration.length,
	};
}

// ---- 后端已发布计数 ----

async function fetchPublishedCount(): Promise<number> {
	const [settings, token] = await Promise.all([
		getSettings(),
		getBackendToken(),
	]);
	if (!settings.backendUrl || !token) return 0;
	if (
		!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(
			settings.backendUrl,
		)
	)
		return 0;
	try {
		const res = await fetch(
			`${settings.backendUrl}/api/v1/published-posts?limit=1`,
			{
				headers: { Authorization: `Bearer ${token}` },
			},
		);
		if (!res.ok) return 0;
		const data = (await res.json()) as { total?: number };
		return data.total ?? 0;
	} catch {
		return 0;
	}
}

// ---- Hook ----

export interface MetricsData {
	trajectory: TrajectoryRecord[];
	metrics: ComputedMetrics;
	publishedCount: { total: number; loaded: boolean };
}

export function useMetricsData(): {
	loading: boolean;
	data: MetricsData | null;
} {
	const [data, setData] = useState<MetricsData | null>(null);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		void (async () => {
			const [trajectory, total] = await Promise.all([
				getTrajectory(),
				fetchPublishedCount(),
			]);
			setData({
				trajectory,
				metrics: computeMetrics(trajectory),
				publishedCount: { total, loaded: true },
			});
			setLoading(false);
		})();
	}, []);

	return { loading, data };
}
