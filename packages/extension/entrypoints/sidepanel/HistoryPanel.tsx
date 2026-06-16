import { useEffect, useMemo, useState } from "react";
import {
	type FeedbackRating,
	getFeedback,
	saveFeedback,
} from "../../lib/publish-feedback";
import { getTrajectory } from "../../lib/storage";
import type { TrajectoryRecord } from "../../lib/trajectory";
import { rollbackTargets, verifyTrajectory } from "../../lib/trajectory";
import { Loading } from "./Loading";

const PAGE_SIZE = 20;

const RATING_LABELS: Record<FeedbackRating, string> = {
	good: "👍",
	ok: "😐",
	bad: "👎",
};
const RATINGS: FeedbackRating[] = ["good", "ok", "bad"];

export function HistoryPanel() {
	const [records, setRecords] = useState<TrajectoryRecord[]>([]);
	const [loading, setLoading] = useState(true);
	const [page, setPage] = useState(1);
	const [feedbackMap, setFeedbackMap] = useState<Map<string, FeedbackRating>>(
		new Map(),
	);

	useEffect(() => {
		setLoading(true);
		void Promise.all([getTrajectory(), getFeedback()])
			.then(([trajectory, feedbacks]) => {
				setRecords([...trajectory].reverse());
				setFeedbackMap(new Map(feedbacks.map((f) => [f.itemId, f.rating])));
			})
			.finally(() => setLoading(false));
	}, []);

	function handleRate(r: TrajectoryRecord, rating: FeedbackRating) {
		const prev = feedbackMap.get(r.id);
		setFeedbackMap((m) => new Map(m).set(r.id, rating));
		saveFeedback({
			itemId: r.id,
			topic: r.topic,
			rating,
			ts: new Date().toISOString(),
		}).catch(() => {
			setFeedbackMap((m) => {
				const next = new Map(m);
				if (prev === undefined) next.delete(r.id);
				else next.set(r.id, prev);
				return next;
			});
		});
	}

	const oldestFirst = useMemo(() => [...records].reverse(), [records]);
	const intact = useMemo(() => verifyTrajectory(oldestFirst), [oldestFirst]);
	const rollbackSet = useMemo(
		() => new Set(rollbackTargets(oldestFirst).map((r) => r.id)),
		[oldestFirst],
	);

	if (loading) {
		return (
			<section style={{ paddingTop: "var(--space-lg)" }}>
				<Loading />
			</section>
		);
	}

	if (records.length === 0) {
		return (
			<section style={{ paddingTop: "var(--space-lg)" }}>
				<p className="text-muted" style={{ margin: 0 }}>
					暂无发布记录。
				</p>
			</section>
		);
	}

	const visible = records.slice(0, page * PAGE_SIZE);
	const hasMore = records.length > page * PAGE_SIZE;

	return (
		<section style={{ paddingTop: "var(--space-lg)" }}>
			<div
				className={intact ? "text-success" : "text-error"}
				style={{ fontSize: "var(--font-sm)", marginBottom: "var(--space-lg)" }}
			>
				{intact ? "✓ 链完整" : "⚠ 链异常(疑被篡改)"}
				<span className="text-muted" style={{ marginLeft: "var(--space-md)" }}>
					共 {records.length} 条
				</span>
			</div>
			<ul
				style={{
					listStyle: "none",
					padding: 0,
					margin: 0,
					fontSize: "var(--font-sm)",
				}}
			>
				{visible.map((r) => (
					<li
						key={r.id}
						className="surface-elevated"
						style={{
							marginBottom: "var(--space-lg)",
							padding: "5px var(--space-md)",
						}}
					>
						<div className="flex-between">
							<span
								className="font-semibold"
								style={{
									overflow: "hidden",
									textOverflow: "ellipsis",
									whiteSpace: "nowrap",
									maxWidth: "60%",
								}}
							>
								「{r.topic}」
							</span>
							<span className="text-xs text-muted">
								{new Date(r.ts).toLocaleString()}
							</span>
						</div>
						<div
							style={{
								marginTop: "var(--space-xs)",
								display: "flex",
								alignItems: "center",
								gap: "var(--space-lg)",
								flexWrap: "wrap",
							}}
						>
							<StatusBadge status={r.status} />
							{r.publishUrl ? (
								<a
									href={r.publishUrl}
									target="_blank"
									rel="noopener noreferrer"
									className="text-info"
									style={{ fontSize: "var(--font-xs)" }}
								>
									查看帖子
								</a>
							) : null}
							{rollbackSet.has(r.id) && (
								<span className="text-xs text-muted">可撤下</span>
							)}
						</div>
						{r.fields?.some((f) => f.status === "degraded") && (
							<div
								className="text-xs text-warning"
								style={{ marginTop: "var(--space-xs)" }}
							>
								⚠ {r.fields.filter((f) => f.status === "degraded").length}{" "}
								个字段降级
							</div>
						)}
						{r.status === "publish-confirmed" && (
							<div
								style={{
									marginTop: "var(--space-xs)",
									display: "flex",
									gap: "var(--space-md)",
								}}
							>
								{RATINGS.map((rating) => {
									const selected = feedbackMap.get(r.id) === rating;
									return (
										<button
											key={rating}
											type="button"
											className="btn btn-plain btn-sm"
											aria-label={rating}
											onClick={() => handleRate(r, rating)}
											style={{
												color: selected
													? "var(--color-primary)"
													: "var(--color-text-disabled)",
												fontWeight: selected ? 700 : 400,
												padding: "0 4px",
											}}
										>
											{RATING_LABELS[rating]}
										</button>
									);
								})}
							</div>
						)}
					</li>
				))}
			</ul>
			{hasMore && (
				<button
					type="button"
					onClick={() => setPage((p) => p + 1)}
					className="btn btn-plain btn-sm"
					style={{ marginTop: "var(--space-lg)" }}
				>
					加载更多
				</button>
			)}
		</section>
	);
}

function StatusBadge({ status }: { status: string }) {
	const colorMap: Record<string, string> = {
		"publish-confirmed": "var(--color-success)",
		"needs-human-verification": "var(--color-error)",
		error: "var(--color-warning)",
		aborted: "var(--color-text-muted)",
	};
	const color = colorMap[status] ?? "var(--color-text-secondary)";
	return (
		<span className="text-xs font-semibold" style={{ color }}>
			{status}
		</span>
	);
}
