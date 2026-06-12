interface BatchResult {
	id: string;
	success: boolean;
	error?: string;
}

interface BatchResultSummaryProps {
	results: BatchResult[];
}

export function BatchResultSummary({ results }: BatchResultSummaryProps) {
	if (results.length === 0) {
		return (
			<div
				style={{
					background: "#fafafa",
					border: "1px solid #d9d9d9",
					borderRadius: 6,
					padding: 12,
					marginBottom: 12,
					textAlign: "center",
					color: "#8c8c8c",
				}}
			>
				暂无操作结果
			</div>
		);
	}

	const successCount = results.filter((r) => r.success).length;
	const failureCount = results.filter((r) => !r.success).length;
	const totalCount = results.length;
	const successRate =
		totalCount > 0 ? Math.round((successCount / totalCount) * 100) : 0;

	return (
		<div
			style={{
				background: "#fafafa",
				border: "1px solid #d9d9d9",
				borderRadius: 6,
				padding: 12,
				marginBottom: 12,
			}}
		>
			<div style={{ fontWeight: 600, marginBottom: 8 }}>操作结果汇总</div>

			<div style={{ display: "flex", gap: 16, marginBottom: 8 }}>
				<div style={{ display: "flex", alignItems: "center", gap: 4 }}>
					<span style={{ color: "#389e0d" }}>●</span>
					<span>成功: {successCount}</span>
				</div>
				<div style={{ display: "flex", alignItems: "center", gap: 4 }}>
					<span style={{ color: "#cf1322" }}>●</span>
					<span>失败: {failureCount}</span>
				</div>
				<div style={{ display: "flex", alignItems: "center", gap: 4 }}>
					<span style={{ color: "#1677ff" }}>●</span>
					<span>总计: {totalCount}</span>
				</div>
			</div>

			<div style={{ fontSize: 12, color: "#666" }}>成功率: {successRate}%</div>

			{failureCount > 0 && (
				<div style={{ marginTop: 8, fontSize: 12 }}>
					<div style={{ fontWeight: 500, marginBottom: 4 }}>失败详情:</div>
					{results
						.filter((r) => !r.success)
						.map((r) => (
							<div key={r.id} style={{ color: "#cf1322", marginBottom: 2 }}>
								• {r.error || "未知错误"}
							</div>
						))}
				</div>
			)}
		</div>
	);
}
