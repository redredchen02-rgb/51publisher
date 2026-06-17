import { StatCard } from "./components/StatCard";
import { useMetricsData } from "./hooks/useMetricsData";

export function MetricsPanel({ onBack }: { onBack: () => void }) {
	const { loading, data } = useMetricsData();

	if (loading || !data) {
		return (
			<main style={{ padding: "var(--space-xl)" }}>
				<div className="text-secondary">加载中…</div>
			</main>
		);
	}

	const { trajectory, metrics, publishedCount } = data;

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
					{/* 发布概况 */}
					<Section title="发布概况">
						<StatCard
							label="历史轨迹条数"
							value={trajectory.length}
							sub="本地存档"
						/>
						<StatCard
							label="后端发布记录"
							value={publishedCount.loaded ? publishedCount.total : "—"}
							sub={publishedCount.loaded ? "published_posts 表" : "未连接后端"}
						/>
					</Section>

					{/* 生成质量 */}
					<Section title="生成质量">
						{metrics.directPublishRate !== null && (
							<StatCard
								label="直发率"
								value={`${metrics.directPublishRate}%`}
								sub="无手动改稿直接发布"
							/>
						)}
						{metrics.reviewRate !== null && (
							<StatCard
								label="AI 评审触发率"
								value={`${metrics.reviewRate}%`}
								sub="重写改善草稿"
							/>
						)}
					</Section>

					{/* 编辑行为 */}
					<Section title="编辑行为">
						<StatCard
							label="草稿编辑率"
							value={metrics.withDiffCount > 0 ? `${metrics.editRate}%` : "—"}
							sub={
								metrics.withDiffCount > 0
									? `${metrics.editedCount}/${metrics.withDiffCount} 条有改动`
									: "暂无 slot-diff 数据"
							}
						/>
					</Section>

					{/* LLM 用量 */}
					<Section title="LLM 用量">
						<StatCard
							label="累计 Prompt Token"
							value={
								metrics.tokenRecordCount > 0
									? metrics.totalPromptTokens.toLocaleString()
									: "—"
							}
							sub={`${metrics.tokenRecordCount} 条有记录`}
						/>
						<StatCard
							label="累计 Completion Token"
							value={
								metrics.tokenRecordCount > 0
									? metrics.totalCompletionTokens.toLocaleString()
									: "—"
							}
							sub={
								metrics.avgCompletionTokens > 0
									? `均 ${metrics.avgCompletionTokens}/条`
									: undefined
							}
						/>
						{metrics.avgDurationSec !== null && (
							<StatCard
								label="均生成耗时"
								value={`${metrics.avgDurationSec}s`}
								sub={`${metrics.durationRecordCount} 条有记录`}
							/>
						)}
					</Section>
				</>
			)}
		</main>
	);
}

/** 度量区段容器（标题 + flex 卡片行）。 */
function Section({
	title,
	children,
}: {
	title: string;
	children: React.ReactNode;
}) {
	return (
		<section style={{ marginBottom: "var(--space-xl)" }}>
			<h2
				style={{
					fontSize: "var(--font-md)",
					fontWeight: 600,
					marginBottom: 10,
				}}
			>
				{title}
			</h2>
			<div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
				{children}
			</div>
		</section>
	);
}
