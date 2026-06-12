import type { DryRunReport as DryRunReportType } from "@51publisher/shared";
import { useEffect, useState } from "react";
import { clearDryRunReport, getDryRunReport } from "../../lib/storage";

export function DryRunReport() {
	const [report, setReport] = useState<DryRunReportType | null>(null);

	useEffect(() => {
		getDryRunReport().then(setReport);
	}, []);

	if (!report) return null;

	async function handleClear() {
		await clearDryRunReport();
		setReport(null);
	}

	return (
		<section
			className="banner-info"
			style={{ marginTop: "var(--space-xl)", borderTop: "none" }}
		>
			<div className="flex-between" style={{ marginBottom: "var(--space-lg)" }}>
				<h2
					className="text-info"
					style={{ fontSize: "var(--font-md)", margin: 0 }}
				>
					🧪 预演填充报告（{report.items.length} 条）
				</h2>
				<button
					type="button"
					onClick={() => void handleClear()}
					className="btn btn-plain btn-sm text-info"
					style={{ borderColor: "var(--color-info-border)" }}
				>
					清除报告
				</button>
			</div>
			<ul
				style={{
					listStyle: "none",
					padding: 0,
					margin: 0,
					fontSize: "var(--font-sm)",
				}}
			>
				{report.items.map((item) => {
					const filled = item.fillResults.filter(
						(r) => r.status === "filled",
					).length;
					const skipped = item.fillResults.filter(
						(r) => r.status === "skipped",
					).length;
					const degraded = item.fillResults.filter(
						(r) => r.status === "degraded",
					).length;
					return (
						<li
							key={item.itemId}
							className="banner-info"
							style={{ marginBottom: "var(--space-lg)", borderTop: "none" }}
						>
							<div
								className="font-semibold"
								style={{ marginBottom: "var(--space-xs)" }}
							>
								「{item.topic}」
							</div>
							{item.draftTitle && (
								<div
									className="text-secondary"
									style={{ marginBottom: "var(--space-xs)" }}
								>
									标题: {item.draftTitle}
								</div>
							)}
							<div>
								<span
									className="text-success"
									style={{ marginRight: "var(--space-lg)" }}
								>
									✓已填 {filled}
								</span>
								<span
									className="text-warning"
									style={{ marginRight: "var(--space-lg)" }}
								>
									↷跳过 {skipped}
								</span>
								<span className="text-error">⚠降级 {degraded}</span>
							</div>
						</li>
					);
				})}
			</ul>
		</section>
	);
}
