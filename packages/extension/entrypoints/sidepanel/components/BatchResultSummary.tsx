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
		return <div className="card text-center text-muted">暂无操作结果</div>;
	}

	const successCount = results.filter((r) => r.success).length;
	const failureCount = results.filter((r) => !r.success).length;
	const totalCount = results.length;
	const successRate =
		totalCount > 0 ? Math.round((successCount / totalCount) * 100) : 0;

	return (
		<div className="card">
			<div
				className="font-semibold"
				style={{ marginBottom: "var(--space-md)" }}
			>
				操作结果汇总
			</div>

			<div
				style={{
					display: "flex",
					gap: "var(--space-xl)",
					marginBottom: "var(--space-md)",
				}}
			>
				<div
					style={{
						display: "flex",
						alignItems: "center",
						gap: "var(--space-sm)",
					}}
				>
					<span className="text-success">●</span>
					<span>成功: {successCount}</span>
				</div>
				<div
					style={{
						display: "flex",
						alignItems: "center",
						gap: "var(--space-sm)",
					}}
				>
					<span className="text-error">●</span>
					<span>失败: {failureCount}</span>
				</div>
				<div
					style={{
						display: "flex",
						alignItems: "center",
						gap: "var(--space-sm)",
					}}
				>
					<span className="text-info">●</span>
					<span>总计: {totalCount}</span>
				</div>
			</div>

			<div className="text-sm text-secondary">成功率: {successRate}%</div>

			{failureCount > 0 && (
				<div
					style={{ marginTop: "var(--space-md)", fontSize: "var(--font-sm)" }}
				>
					<div
						className="font-medium"
						style={{ marginBottom: "var(--space-sm)" }}
					>
						失败详情:
					</div>
					{results
						.filter((r) => !r.success)
						.map((r) => (
							<div
								key={r.id}
								className="text-error"
								style={{ marginBottom: "var(--space-xs)" }}
							>
								• {r.error || "未知错误"}
							</div>
						))}
				</div>
			)}
		</div>
	);
}
