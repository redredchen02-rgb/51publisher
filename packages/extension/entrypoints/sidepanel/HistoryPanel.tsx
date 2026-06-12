import { useEffect, useState } from "react";
import { getTrajectory } from "../../lib/storage";
import type { TrajectoryRecord } from "../../lib/trajectory";
import { rollbackTargets, verifyTrajectory } from "../../lib/trajectory";

const PAGE_SIZE = 20;

export function HistoryPanel() {
	const [records, setRecords] = useState<TrajectoryRecord[]>([]);
	const [page, setPage] = useState(1);

	useEffect(() => {
		getTrajectory().then((r) => setRecords([...r].reverse())); // newest-first
	}, []);

	if (records.length === 0) {
		return (
			<section style={{ paddingTop: 10, fontSize: 13 }}>
				<p style={{ color: "#888", margin: 0 }}>暂无发布记录。</p>
			</section>
		);
	}

	const intact = verifyTrajectory([...records].reverse()); // verifyTrajectory expects oldest-first
	const rollbackSet = new Set(
		rollbackTargets([...records].reverse()).map((r) => r.id),
	);
	const visible = records.slice(0, page * PAGE_SIZE);
	const hasMore = records.length > page * PAGE_SIZE;

	return (
		<section style={{ paddingTop: 10 }}>
			<div
				style={{
					fontSize: 12,
					marginBottom: 6,
					color: intact ? "#389e0d" : "#cf1322",
				}}
			>
				{intact ? "✓ 链完整" : "⚠ 链异常(疑被篡改)"}
				<span style={{ color: "#888", marginLeft: 8 }}>
					共 {records.length} 条
				</span>
			</div>
			<ul style={{ listStyle: "none", padding: 0, margin: 0, fontSize: 12 }}>
				{visible.map((r) => (
					<li
						key={r.id}
						style={{
							marginBottom: 6,
							padding: "5px 8px",
							background: "#fafafa",
							borderRadius: 4,
						}}
					>
						<div
							style={{
								display: "flex",
								justifyContent: "space-between",
								alignItems: "center",
							}}
						>
							<span
								style={{
									fontWeight: 600,
									overflow: "hidden",
									textOverflow: "ellipsis",
									whiteSpace: "nowrap",
									maxWidth: "60%",
								}}
							>
								「{r.topic}」
							</span>
							<span style={{ fontSize: 11, color: "#888" }}>
								{new Date(r.ts).toLocaleString()}
							</span>
						</div>
						<div
							style={{
								marginTop: 2,
								display: "flex",
								alignItems: "center",
								gap: 6,
								flexWrap: "wrap",
							}}
						>
							<StatusBadge status={r.status} />
							{r.publishUrl ? (
								<a
									href={r.publishUrl}
									target="_blank"
									rel="noopener noreferrer"
									style={{ color: "#1677ff", fontSize: 11 }}
								>
									查看帖子
								</a>
							) : null}
							{rollbackSet.has(r.id) && (
								<span style={{ fontSize: 11, color: "#888" }}>可撤下</span>
							)}
						</div>
						{r.fields?.some((f) => f.status === "degraded") && (
							<div style={{ fontSize: 11, color: "#d46b08", marginTop: 2 }}>
								⚠ {r.fields.filter((f) => f.status === "degraded").length}{" "}
								个字段降级
							</div>
						)}
					</li>
				))}
			</ul>
			{hasMore && (
				<button
					onClick={() => setPage((p) => p + 1)}
					style={{
						marginTop: 6,
						fontSize: 12,
						padding: "3px 10px",
						border: "1px solid #d9d9d9",
						borderRadius: 4,
						cursor: "pointer",
						background: "#fff",
					}}
				>
					加载更多
				</button>
			)}
		</section>
	);
}

function StatusBadge({ status }: { status: string }) {
	const colors: Record<string, string> = {
		"publish-confirmed": "#389e0d",
		"needs-human-verification": "#cf1322",
		error: "#d46b08",
		aborted: "#888",
	};
	const color = colors[status] ?? "#555";
	return <span style={{ fontSize: 11, color, fontWeight: 600 }}>{status}</span>;
}
