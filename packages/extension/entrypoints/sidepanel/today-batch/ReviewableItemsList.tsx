import { useEffect, useState } from "react";
import type { BatchItem } from "../../../lib/batch";
import {
	type FeedbackRating,
	type PublishFeedback,
	getFeedbackForItem,
	saveFeedback,
} from "../../../lib/publish-feedback";

const RATING_EMOJI: Record<FeedbackRating, string> = { good: "👍", ok: "🤔", bad: "👎" };
const RATING_LABEL: Record<FeedbackRating, string> = { good: "不错", ok: "一般", bad: "需改进" };

function FeedbackWidget({ itemId, topic }: { itemId: string; topic: string }) {
	const [feedback, setFeedback] = useState<PublishFeedback | null>(null);
	const [editing, setEditing] = useState(false);
	const [note, setNote] = useState("");
	const [pending, setPending] = useState<FeedbackRating | null>(null);

	useEffect(() => {
		void getFeedbackForItem(itemId).then((f) => {
			if (f) setFeedback(f);
		});
	}, [itemId]);

	async function submit(rating: FeedbackRating) {
		const entry: PublishFeedback = {
			itemId,
			topic,
			rating,
			note: note.trim() || undefined,
			ts: new Date().toISOString(),
		};
		await saveFeedback(entry);
		setFeedback(entry);
		setEditing(false);
		setPending(null);
		setNote("");
	}

	if (feedback && !editing) {
		return (
			<div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
				<span style={{ fontSize: 14 }}>{RATING_EMOJI[feedback.rating]}</span>
				<span style={{ fontSize: "var(--font-xs)", color: "var(--color-text-secondary)" }}>
					{RATING_LABEL[feedback.rating]}
					{feedback.note ? `：${feedback.note}` : ""}
				</span>
				<button
					type="button"
					className="btn-icon"
					style={{ fontSize: "var(--font-xs)", color: "var(--color-text-disabled)" }}
					onClick={() => {
						setEditing(true);
						setNote(feedback.note ?? "");
						setPending(feedback.rating);
					}}
				>
					改
				</button>
			</div>
		);
	}

	return (
		<div style={{ marginTop: 6 }}>
			<div style={{ display: "flex", gap: 4, alignItems: "center" }}>
				<span style={{ fontSize: "var(--font-xs)", color: "var(--color-text-secondary)" }}>质量反馈：</span>
				{(["good", "ok", "bad"] as FeedbackRating[]).map((r) => (
					<button
						key={r}
						type="button"
						onClick={() => setPending(r)}
						style={{
							fontSize: 16,
							padding: "2px 4px",
							background: pending === r ? "var(--color-surface-elevated)" : "transparent",
							border: pending === r ? "1px solid var(--color-border)" : "1px solid transparent",
							borderRadius: 4,
							cursor: "pointer",
						}}
						title={RATING_LABEL[r]}
					>
						{RATING_EMOJI[r]}
					</button>
				))}
			</div>
			{pending && (
				<div style={{ marginTop: 4, display: "flex", gap: 4 }}>
					<input
						type="text"
						className="field-input"
						placeholder="备注（可选）"
						value={note}
						onChange={(e) => setNote(e.target.value)}
						style={{ flex: 1, fontSize: "var(--font-xs)", padding: "2px 6px", height: 24 }}
						maxLength={200}
					/>
					<button
						type="button"
						className="btn btn-primary btn-sm"
						style={{ fontSize: "var(--font-xs)", padding: "2px 8px" }}
						onClick={() => void submit(pending)}
					>
						提交
					</button>
				</div>
			)}
		</div>
	);
}

const STATUS_COLOR: Record<string, string> = {
	"gate-failed": "var(--color-error)",
	"awaiting-approval": "var(--color-warning)",
	"publish-dispatched": "var(--color-info)",
	"publish-confirmed": "var(--color-success)",
	"needs-human-verification": "var(--color-error)",
	aborted: "var(--color-text-disabled)",
	error: "var(--color-error)",
};

export const STATUS_LABEL: Record<string, string> = {
	queued: "排队中",
	generating: "生成中",
	filled: "已生成",
	"gate-failed": "内容问题",
	"awaiting-approval": "待发布",
	"publish-dispatched": "发布中",
	"publish-confirmed": "已发布",
	"needs-human-verification": "需人工核实",
	aborted: "已中止",
	error: "出错",
};

interface ReviewableItemsListProps {
	items: BatchItem[];
	readItems: Set<string>;
	publishingItems: Set<string>;
	onToggleRead: (id: string) => void;
	onPublish: (item: BatchItem) => void;
}

export function ReviewableItemsList({
	items,
	readItems,
	publishingItems,
	onToggleRead,
	onPublish,
}: ReviewableItemsListProps) {
	const [expandedBodies, setExpandedBodies] = useState<Set<string>>(new Set());

	function toggleBodyExpand(itemId: string) {
		setExpandedBodies((prev) => {
			const next = new Set(prev);
			if (next.has(itemId)) next.delete(itemId);
			else next.add(itemId);
			return next;
		});
	}

	return (
		<section style={{ marginBottom: "var(--space-xl)" }}>
			<p className="text-muted" style={{ margin: "0 0 var(--space-lg)" }}>
				待发布
			</p>
			{items.map((item) => {
				const isRead = readItems.has(item.id);
				const isPublishing =
					publishingItems.has(item.id) || item.status === "publish-dispatched";
				const bodyText = item.draft?.body
					? item.draft.body.replace(/<[^>]+>/g, "")
					: "";
				const isBodyExpanded = expandedBodies.has(item.id);
				const bodyPreview = bodyText.slice(0, 200);
				const hasMore = bodyText.length > 200;

				return (
					<div key={item.id} className="card" style={{ overflow: "hidden" }}>
						<details
							onToggle={() => onToggleRead(item.id)}
							style={{ padding: 0 }}
						>
							<summary
								style={{
									padding: "var(--space-md) var(--space-lg)",
									cursor: "pointer",
									listStyle: "none",
									display: "flex",
									justifyContent: "space-between",
									alignItems: "center",
									gap: "var(--space-md)",
								}}
							>
								<span
									className="font-medium"
									style={{
										flex: 1,
										overflow: "hidden",
										textOverflow: "ellipsis",
										whiteSpace: "nowrap",
									}}
								>
									{item.draft?.title ?? item.topic}
								</span>
								<span
									className="text-xs"
									style={{
										color: isRead
											? "var(--color-success)"
											: "var(--color-warning)",
										flexShrink: 0,
									}}
								>
									{isRead ? "已读" : "未读"}
								</span>
							</summary>
							<div
								style={{
									padding: "var(--space-md) var(--space-lg)",
									borderTop: "1px solid var(--color-border-lighter)",
									fontSize: "var(--font-sm)",
									color: "var(--color-text-secondary)",
								}}
							>
								{item.draft?.subtitle && (
									<p
										style={{
											margin: "0 0 var(--space-lg)",
											fontStyle: "italic",
										}}
									>
										{item.draft.subtitle}
									</p>
								)}
								<p style={{ margin: 0 }}>
									{isBodyExpanded ? bodyText : bodyPreview}
									{hasMore && !isBodyExpanded && (
										<>
											{"…"}
											<button
												type="button"
												onClick={() => toggleBodyExpand(item.id)}
												className="btn-icon text-info"
												style={{
													fontSize: "var(--font-sm)",
													padding: "0 var(--space-xs)",
												}}
											>
												查看全文
											</button>
										</>
									)}
									{isBodyExpanded && hasMore && (
										<button
											type="button"
											onClick={() => toggleBodyExpand(item.id)}
											className="btn-icon text-muted"
											style={{
												fontSize: "var(--font-sm)",
												padding: "0 var(--space-xs)",
											}}
										>
											收起
										</button>
									)}
								</p>
							</div>
						</details>
						<div
							style={{
								padding: "var(--space-lg) var(--space-xl)",
								background: "var(--color-bg-surface)",
								display: "flex",
								justifyContent: "flex-end",
								gap: "var(--space-md)",
							}}
						>
							<button
								type="button"
								disabled={!isRead || isPublishing}
								onClick={() => onPublish(item)}
								title={!isRead ? "请先展开预览后才能发布" : ""}
								className="btn btn-sm"
								style={{
									background:
										!isRead || isPublishing
											? "var(--color-border)"
											: "var(--color-success)",
									color:
										!isRead || isPublishing
											? "var(--color-text-disabled)"
											: "#fff",
								}}
							>
								{isPublishing ? "发布中…" : "发布（隐藏）"}
							</button>
						</div>
					</div>
				);
			})}
		</section>
	);
}

interface BatchResultSectionsProps {
	gateFailedItems: BatchItem[];
	needsVerificationItems: BatchItem[];
	confirmedItems: BatchItem[];
	terminalOtherItems: BatchItem[];
	onRetry: (itemId: string) => void;
}

export function BatchResultSections({
	gateFailedItems,
	needsVerificationItems,
	confirmedItems,
	terminalOtherItems,
	onRetry,
}: BatchResultSectionsProps) {
	return (
		<>
			{gateFailedItems.length > 0 && (
				<section style={{ marginBottom: "var(--space-xl)" }}>
					<p className="text-muted" style={{ margin: "0 0 var(--space-lg)" }}>
						内容问题
					</p>
					{gateFailedItems.map((item) => (
						<div
							key={item.id}
							className="banner-error"
							style={{ marginBottom: "var(--space-lg)" }}
						>
							<div
								style={{
									display: "flex",
									justifyContent: "space-between",
									alignItems: "flex-start",
								}}
							>
								<div style={{ flex: 1 }}>
									<p className="font-medium" style={{ margin: 0 }}>
										{item.topic}
									</p>
									{item.gateFailReason && (
										<p
											className="text-error"
											style={{
												margin: "var(--space-sm) 0 0",
												fontSize: "var(--font-xs)",
											}}
										>
											{item.gateFailReason}
										</p>
									)}
								</div>
								<button
									type="button"
									onClick={() => onRetry(item.id)}
									className="btn btn-plain btn-sm text-error"
									style={{
										flexShrink: 0,
										borderColor: "var(--color-error-border)",
									}}
								>
									重新生成
								</button>
							</div>
						</div>
					))}
				</section>
			)}

			{needsVerificationItems.length > 0 && (
				<section style={{ marginBottom: "var(--space-xl)" }}>
					<p className="text-muted" style={{ margin: "0 0 var(--space-lg)" }}>
						需人工核实
					</p>
					{needsVerificationItems.map((item) => (
						<div
							key={item.id}
							className="banner-warning"
							style={{ marginBottom: "var(--space-lg)" }}
						>
							<p className="font-medium" style={{ margin: 0 }}>
								{item.draft?.title ?? item.topic}
							</p>
							<p
								className="text-warning-deep text-sm"
								style={{ margin: "var(--space-sm) 0 0" }}
							>
								发布确认状态不确定，请先到后台核实是否已发出，再回到批量审核处理。
							</p>
						</div>
					))}
				</section>
			)}

			{confirmedItems.length > 0 && (
				<section style={{ marginBottom: "var(--space-xl)" }}>
					<p className="text-muted" style={{ margin: "0 0 var(--space-lg)" }}>
						已发布
					</p>
					{confirmedItems.map((item) => (
						<div
							key={item.id}
							style={{
								padding: "var(--space-lg) var(--space-xl)",
								borderBottom: "1px solid var(--color-border-lighter)",
							}}
						>
							<div style={{ display: "flex", justifyContent: "space-between" }}>
								<span
									style={{
										overflow: "hidden",
										textOverflow: "ellipsis",
										whiteSpace: "nowrap",
										flex: 1,
									}}
								>
									{item.draft?.title ?? item.topic}
								</span>
								<span
									className="text-success"
									style={{ marginLeft: "var(--space-md)", flexShrink: 0 }}
								>
									✓ 已发布
								</span>
							</div>
							<FeedbackWidget itemId={item.id} topic={item.topic} />
						</div>
					))}
				</section>
			)}

			{terminalOtherItems.length > 0 && (
				<section style={{ marginBottom: "var(--space-xl)" }}>
					<p className="text-muted" style={{ margin: "0 0 var(--space-lg)" }}>
						出错/中止
					</p>
					{terminalOtherItems.map((item) => (
						<div
							key={item.id}
							style={{
								padding: "var(--space-lg) var(--space-xl)",
								borderBottom: "1px solid var(--color-border-lighter)",
								fontSize: "var(--font-sm)",
								color: "var(--color-text-muted)",
							}}
						>
							<span>{item.topic}</span>
							{item.error && (
								<span
									style={{
										marginLeft: "var(--space-md)",
										color: STATUS_COLOR[item.status],
									}}
								>
									{item.error}
								</span>
							)}
						</div>
					))}
				</section>
			)}
		</>
	);
}
