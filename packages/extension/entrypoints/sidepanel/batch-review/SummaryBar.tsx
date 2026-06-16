import type { BatchPhase, BatchSummary } from "../../../lib/batch";
import type { DegradeStats } from "../../../lib/degrade-stats";
import { box } from "./constants";

interface Props {
	phase: BatchPhase;
	summary: BatchSummary;
	aiOptimizedCount: number;
	ds: DegradeStats;
}

export function SummaryBar({ phase, summary, aiOptimizedCount, ds }: Props) {
	return (
		<>
			<div
				style={{
					...box,
					background: "var(--color-bg-surface)",
					border: "1px solid var(--color-border-light)",
					color: "var(--color-text)",
				}}
			>
				共 {summary.total} 条 · 待审 {summary.awaitingApproval} · 已发{" "}
				{summary.confirmed} · 失败 {summary.errored}
				{summary.quarantined > 0 && (
					<strong className="text-error">
						{" "}
						· 待人工核 {summary.quarantined}
					</strong>
				)}
				{summary.aborted > 0 && <span> · 已停 {summary.aborted}</span>}
				{aiOptimizedCount > 0 && (
					<span className="text-muted">
						{" "}
						· ✦ {aiOptimizedCount} 条自评已优化
					</span>
				)}
				{phase === "done" && ds.itemsWithAnyDegrade > 0 && (
					<span
						className="font-semibold"
						style={{
							marginLeft: 6,
							background: "var(--color-warning)",
							color: "#fff",
							borderRadius: 10,
							padding: "1px 7px",
							fontSize: 11,
						}}
					>
						{ds.itemsWithAnyDegrade} 条降级
					</span>
				)}
			</div>

			{phase === "done" &&
				ds.totalItemsWithResults > 0 &&
				(ds.itemsWithAnyDegrade === 0 ? (
					<div
						style={{
							...box,
							background: "var(--color-success-light)",
							border: "1px solid var(--color-success-border)",
							color: "var(--color-success)",
							fontSize: 12,
						}}
					>
						✅ 本批次所有字段填充成功
					</div>
				) : (
					<div
						style={{
							...box,
							background: "var(--color-warning-light)",
							border: "1px solid var(--color-warning-border)",
							color: "var(--color-warning-deep)",
							fontSize: 12,
						}}
					>
						⚠️ 本批次 {ds.itemsWithAnyDegrade}/{ds.totalItemsWithResults}{" "}
						条目有字段降级
						{ds.topFields.length > 0 && (
							<span>
								{" "}
								| 高频：
								{ds.topFields
									.map((f) => `${f.field}（${f.count}x）`)
									.join("，")}
							</span>
						)}
					</div>
				))}
		</>
	);
}
