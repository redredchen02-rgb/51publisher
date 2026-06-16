import { useEffect, useState } from "react";
import { aggregateDegradeStats } from "../../lib/degrade-stats";
import { getBackendToken, getSettings, getTrajectory } from "../../lib/storage";
import type { TrajectoryRecord } from "../../lib/trajectory";

interface PublishedCount {
	total: number;
	loaded: boolean;
}

interface MetricsData {
	trajectory: TrajectoryRecord[];
	publishedCount: PublishedCount;
}

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

function StatCard({
	label,
	value,
	sub,
}: {
	label: string;
	value: string | number;
	sub?: string;
}) {
	return (
		<div
			style={{
				background: "var(--color-surface)",
				border: "1px solid var(--color-border)",
				borderRadius: 8,
				padding: "12px 16px",
				flex: "1 1 120px",
				minWidth: 0,
			}}
		>
			<div
				style={{
					fontSize: "var(--font-sm)",
					color: "var(--color-text-secondary)",
				}}
			>
				{label}
			</div>
			<div style={{ fontSize: 22, fontWeight: 700, margin: "4px 0 2px" }}>
				{value}
			</div>
			{sub && (
				<div
					style={{
						fontSize: "var(--font-xs)",
						color: "var(--color-text-disabled)",
					}}
				>
					{sub}
				</div>
			)}
		</div>
	);
}

export function MetricsPanel({ onBack }: { onBack: () => void }) {
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
				publishedCount: { total, loaded: true },
			});
			setLoading(false);
		})();
	}, []);

	if (loading || !data) {
		return (
			<main style={{ padding: "var(--space-xl)" }}>
				<div className="text-secondary">加载中…</div>
			</main>
		);
	}

	const { trajectory, publishedCount } = data;

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

	// 編輯率 (slot-diff)
	const withDiff = trajectory.filter((r) => r.slotDiff && !r.slotDiff.unknown);
	const editedCount = withDiff.filter(
		(r) => (r.slotDiff?.changedSlots?.length ?? 0) > 0,
	).length;
	const editRate =
		withDiff.length > 0 ? Math.round((editedCount / withDiff.length) * 100) : 0;

	// 直發率 (無手動改稿)
	const withEditFlag = trajectory.filter((r) => r.hasManualEdit !== undefined);
	const directPublishRate =
		withEditFlag.length > 0
			? Math.round(
					(withEditFlag.filter((r) => !r.hasManualEdit).length /
						withEditFlag.length) *
						100,
				)
			: null;

	// 平均生成時長
	const withDuration = trajectory.filter((r) => r.generationDurationMs != null);
	const avgDurationSec =
		withDuration.length > 0
			? (
					withDuration.reduce((s, r) => s + (r.generationDurationMs ?? 0), 0) /
					withDuration.length /
					1000
				).toFixed(1)
			: null;

	// AI 評審觸發率
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

	// 降級統計 — 從 trajectory 構造 BatchItem-like 物件
	const batchLike = trajectory.map((r) => ({
		id: r.id,
		topic: r.topic,
		status: r.status as "filled",
		fillResults: r.fields,
	}));
	const degrade = aggregateDegradeStats(batchLike);
	const degradeRate =
		degrade.totalItemsWithResults > 0
			? Math.round(
					(degrade.itemsWithAnyDegrade / degrade.totalItemsWithResults) * 100,
				)
			: 0;

	return (
		<main style={{ padding: "var(--space-xl)" }}>
			<nav className="flex-between mb-md">
				<h1 style={{ fontSize: "var(--font-xl)", margin: 0 }}>度量</h1>
				<button type="button" onClick={onBack} className="btn btn-plain btn-sm">
					← 返回
				</button>
			</nav>

			{trajectory.length === 0 && publishedCount.total === 0 ? (
				<p className="text-secondary">暂无数据。完成首次发布后将显示统计。</p>
			) : (
				<>
					<section style={{ marginBottom: "var(--space-xl)" }}>
						<h2
							style={{
								fontSize: "var(--font-md)",
								fontWeight: 600,
								marginBottom: 10,
							}}
						>
							发布概况
						</h2>
						<div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
							<StatCard
								label="历史轨迹条数"
								value={trajectory.length}
								sub="本地存档"
							/>
							<StatCard
								label="后端发布记录"
								value={publishedCount.loaded ? publishedCount.total : "—"}
								sub={
									publishedCount.loaded ? "published_posts 表" : "未连接后端"
								}
							/>
						</div>
					</section>

					<section style={{ marginBottom: "var(--space-xl)" }}>
						<h2
							style={{
								fontSize: "var(--font-md)",
								fontWeight: 600,
								marginBottom: 10,
							}}
						>
							生成质量
						</h2>
						<div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
							<StatCard
								label="字段降级率"
								value={
									degrade.totalItemsWithResults > 0 ? `${degradeRate}%` : "—"
								}
								sub={`${degrade.itemsWithAnyDegrade}/${degrade.totalItemsWithResults} 条`}
							/>
							{directPublishRate !== null && (
								<StatCard
									label="直发率"
									value={`${directPublishRate}%`}
									sub="无手动改稿直接发布"
								/>
							)}
							{reviewRate !== null && (
								<StatCard
									label="AI 评审触发率"
									value={`${reviewRate}%`}
									sub="重写改善草稿"
								/>
							)}
						</div>
						{degrade.topFields.length > 0 && (
							<div style={{ marginTop: 12 }}>
								<div
									style={{
										fontSize: "var(--font-sm)",
										color: "var(--color-text-secondary)",
										marginBottom: 6,
									}}
								>
									高频降级字段
								</div>
								<div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
									{degrade.topFields.map(({ field, count }) => (
										<span
											key={field}
											style={{
												background: "var(--color-error-light)",
												color: "var(--color-error)",
												padding: "2px 8px",
												borderRadius: 4,
												fontSize: "var(--font-sm)",
											}}
										>
											{field} ×{count}
										</span>
									))}
								</div>
							</div>
						)}
					</section>

					<section style={{ marginBottom: "var(--space-xl)" }}>
						<h2
							style={{
								fontSize: "var(--font-md)",
								fontWeight: 600,
								marginBottom: 10,
							}}
						>
							编辑行为
						</h2>
						<div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
							<StatCard
								label="草稿编辑率"
								value={withDiff.length > 0 ? `${editRate}%` : "—"}
								sub={
									withDiff.length > 0
										? `${editedCount}/${withDiff.length} 条有改动`
										: "暂无 slot-diff 数据"
								}
							/>
						</div>
					</section>

					<section style={{ marginBottom: "var(--space-xl)" }}>
						<h2
							style={{
								fontSize: "var(--font-md)",
								fontWeight: 600,
								marginBottom: 10,
							}}
						>
							LLM 用量
						</h2>
						<div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
							<StatCard
								label="累计 Prompt Token"
								value={
									withTokens.length > 0
										? totalPromptTokens.toLocaleString()
										: "—"
								}
								sub={`${withTokens.length} 条有记录`}
							/>
							<StatCard
								label="累计 Completion Token"
								value={
									withTokens.length > 0
										? totalCompletionTokens.toLocaleString()
										: "—"
								}
								sub={
									avgCompletionTokens > 0
										? `均 ${avgCompletionTokens}/条`
										: undefined
								}
							/>
							{avgDurationSec !== null && (
								<StatCard
									label="均生成耗时"
									value={`${avgDurationSec}s`}
									sub={`${withDuration.length} 条有记录`}
								/>
							)}
						</div>
					</section>
				</>
			)}
		</main>
	);
}
