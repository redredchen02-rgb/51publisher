import { useEffect, useRef, useState } from "react";
import type { BatchItem } from "../../lib/batch";
import {
	approveSingleItem,
	getBatchState,
	resolveAdminTabId,
	retryBatchItemMsg,
	runBatch,
} from "../../lib/messaging";
import { fetchPendingTopics } from "../../lib/pending-client";
import { getReadItems, markItemRead } from "../../lib/read-tracker";
import { getSettings } from "../../lib/storage";

const STATUS_LABEL: Record<string, string> = {
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

const STATUS_COLOR: Record<string, string> = {
	queued: "var(--color-text-disabled)",
	generating: "var(--color-info)",
	filled: "var(--color-success)",
	"gate-failed": "var(--color-error)",
	"awaiting-approval": "var(--color-warning)",
	"publish-dispatched": "var(--color-info)",
	"publish-confirmed": "var(--color-success)",
	"needs-human-verification": "var(--color-error)",
	aborted: "var(--color-text-disabled)",
	error: "var(--color-error)",
};

const TERMINAL_STATUSES = new Set([
	"publish-confirmed",
	"gate-failed",
	"error",
	"aborted",
	"needs-human-verification",
]);

function isAllTerminal(items: BatchItem[]): boolean {
	return (
		items.length > 0 && items.every((it) => TERMINAL_STATUSES.has(it.status))
	);
}

export function TodayBatchView({ onBack }: { onBack: () => void }) {
	const [dailyBatchSize, setDailyBatchSize] = useState(5);
	const [adminTabId, setAdminTabId] = useState<number | null | undefined>(
		undefined,
	);
	const [tabError, setTabError] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");

	const [stage, setStage] = useState<"idle" | "generating" | "review">("idle");
	const [items, setItems] = useState<BatchItem[]>([]);
	const [readItems, setReadItems] = useState<Set<string>>(new Set());
	const [publishingItems, setPublishingItems] = useState<Set<string>>(
		new Set(),
	);
	const [expandedBodies, setExpandedBodies] = useState<Set<string>>(new Set());

	const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const progressPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

	// 卸载时清掉批量启动期间的进度轮询:progressPoll 在 runBatch 期间存活,
	// 若用户在批量未结束时切走页面,需保证 interval 被回收、不再对已卸载组件 setState。
	useEffect(() => {
		return () => {
			if (progressPollRef.current) {
				clearInterval(progressPollRef.current);
				progressPollRef.current = null;
			}
		};
	}, []);

	useEffect(() => {
		void (async () => {
			const [settings, tabId, activeBatch, reads] = await Promise.all([
				getSettings(),
				resolveAdminTabId(),
				getBatchState(),
				getReadItems(),
			]);
			setDailyBatchSize(settings.dailyBatchSize ?? 5);
			setAdminTabId(tabId);
			setReadItems(reads);
			if (activeBatch?.items.length) {
				setItems(activeBatch.items);
				setStage("review");
			}
			if (tabId == null) {
				setTabError("未找到后台发帖页——请先打开后台发帖页标签。");
			}
		})();
	}, []);

	useEffect(() => {
		if (stage !== "review") {
			if (pollRef.current) {
				clearInterval(pollRef.current);
				pollRef.current = null;
			}
			return;
		}
		if (isAllTerminal(items)) return;

		pollRef.current = setInterval(() => {
			void getBatchState().then((batch) => {
				if (!batch) return;
				setItems(batch.items);
				if (isAllTerminal(batch.items)) {
					if (pollRef.current) {
						clearInterval(pollRef.current);
						pollRef.current = null;
					}
				}
			});
		}, 1500);

		return () => {
			if (pollRef.current) {
				clearInterval(pollRef.current);
				pollRef.current = null;
			}
		};
	}, [stage, items]);

	async function handleDailyBatch() {
		if (adminTabId == null) {
			setTabError("未找到后台发帖页——请先打开后台发帖页标签。");
			return;
		}
		setBusy(true);
		setError("");
		setPublishingItems(new Set());
		setExpandedBodies(new Set());
		setStage("generating");

		try {
			const pendingTopics = await fetchPendingTopics({
				status: "pending",
				sort_by: "score",
			});
			const topN = pendingTopics.slice(0, dailyBatchSize);
			if (topN.length === 0) {
				setError("暂无待处理选题,请先到「待审」页面抓取或添加选题。");
				setStage("idle");
				return;
			}

			const topics = topN.map((t) => t.title);
			const factsList = topN.map((t) => t.facts ?? {});
			const topicIds = topN.map((t) => t.id);
			const enrichments = topN.map((t) => t.enrichmentText);

			progressPollRef.current = setInterval(() => {
				void getBatchState().then((batch) => {
					if (batch) setItems(batch.items);
				});
			}, 2000);

			const batch = await runBatch(
				topics,
				adminTabId,
				factsList,
				undefined,
				undefined,
				topicIds,
				enrichments,
			);

			if (progressPollRef.current) {
				clearInterval(progressPollRef.current);
				progressPollRef.current = null;
			}

			const finalItems =
				batch?.items ??
				topN.map((t) => ({
					id: t.id ?? t.title,
					topic: t.title,
					facts: t.facts ?? {},
					status: "queued" as const,
					pendingTopicId: t.id,
				}));
			setItems(finalItems);

			const reads = await getReadItems();
			setReadItems(reads);
			setStage("review");
		} catch {
			if (progressPollRef.current) {
				clearInterval(progressPollRef.current);
				progressPollRef.current = null;
			}
			setError("启动批量失败,请重试。");
			setStage("idle");
		} finally {
			setBusy(false);
		}
	}

	async function handlePublish(item: BatchItem) {
		if (adminTabId == null) return;
		setPublishingItems((prev) => new Set([...prev, item.id]));
		try {
			const batch = await approveSingleItem(adminTabId, item.id);
			if (batch) setItems(batch.items);
		} finally {
			setPublishingItems((prev) => {
				const next = new Set(prev);
				next.delete(item.id);
				return next;
			});
		}
	}

	async function handleRetry(itemId: string) {
		const batch = await retryBatchItemMsg(itemId);
		if (batch) setItems(batch.items);
	}

	function handleToggleRead(itemId: string) {
		void markItemRead(itemId).then(() => {
			setReadItems((prev) => new Set([...prev, itemId]));
		});
	}

	function toggleBodyExpand(itemId: string) {
		setExpandedBodies((prev) => {
			const next = new Set(prev);
			if (next.has(itemId)) next.delete(itemId);
			else next.add(itemId);
			return next;
		});
	}

	const reviewableItems = items.filter(
		(it) => it.status === "filled" || it.status === "awaiting-approval",
	);
	const gateFailedItems = items.filter((it) => it.status === "gate-failed");
	const confirmedItems = items.filter(
		(it) => it.status === "publish-confirmed",
	);
	const terminalOtherItems = items.filter(
		(it) => it.status === "error" || it.status === "aborted",
	);

	const generatingCount = items.filter(
		(it) => it.status === "generating" || it.status === "queued",
	).length;
	const totalCount = items.length;
	const producedCount = items.filter(
		(it) =>
			it.status === "filled" ||
			it.status === "awaiting-approval" ||
			it.status === "publish-dispatched" ||
			it.status === "publish-confirmed",
	).length;
	const needsVerificationItems = items.filter(
		(it) => it.status === "needs-human-verification",
	);
	const blockedCount =
		gateFailedItems.length +
		terminalOtherItems.length +
		needsVerificationItems.length;
	const completedCount = confirmedItems.length;
	const progressValue =
		totalCount === 0 ? 0 : Math.round((producedCount / totalCount) * 100);
	const readReviewCount = reviewableItems.filter((it) =>
		readItems.has(it.id),
	).length;
	const currentStep =
		totalCount === 0
			? "选题"
			: generatingCount > 0
				? "生成"
				: reviewableItems.length > 0
					? "审读"
					: "发布";

	return (
		<main
			className="fade-in"
			style={{
				fontFamily: "system-ui, sans-serif",
				padding: "var(--space-lg)",
				fontSize: "var(--font-md)",
			}}
		>
			<nav className="flex-between mb-md">
				<h1 style={{ fontSize: "var(--font-xl)", margin: 0 }}>今日备稿</h1>
				<button type="button" onClick={onBack} className="btn btn-plain btn-sm">
					← 返回
				</button>
			</nav>

			{tabError && (
				<p role="alert" className="text-error">
					{tabError}
				</p>
			)}

			{error && (
				<p role="alert" className="text-error">
					{error}
				</p>
			)}

			<section className="pipeline-strip" aria-label="今日流水线进度">
				<div
					className={`pipeline-step ${currentStep === "选题" ? "active" : totalCount > 0 ? "done" : ""}`}
				>
					<span className="pipeline-step-label">选题</span>
					<span className="pipeline-step-value">{dailyBatchSize}</span>
				</div>
				<div
					className={`pipeline-step ${currentStep === "生成" ? "active" : producedCount > 0 ? "done" : ""}`}
				>
					<span className="pipeline-step-label">生成</span>
					<span className="pipeline-step-value">
						{producedCount}/{totalCount || dailyBatchSize}
					</span>
				</div>
				<div
					className={`pipeline-step ${currentStep === "审读" ? "active" : completedCount > 0 ? "done" : ""}`}
				>
					<span className="pipeline-step-label">审读</span>
					<span className="pipeline-step-value">
						{readReviewCount}/{reviewableItems.length}
					</span>
				</div>
				<div
					className={`pipeline-step ${currentStep === "发布" ? "active" : completedCount > 0 ? "done" : ""}`}
				>
					<span className="pipeline-step-label">发布</span>
					<span className="pipeline-step-value">{completedCount}</span>
				</div>
			</section>

			{stage !== "review" && (
				<>
					<p
						className="text-secondary"
						style={{ margin: "0 0 var(--space-xl)" }}
					>
						自动从高分待审选题中取前 <strong>{dailyBatchSize}</strong>{" "}
						条，一键触发批量生成。
					</p>
					<button
						type="button"
						onClick={() => void handleDailyBatch()}
						disabled={busy || adminTabId == null}
						className="btn btn-primary"
						style={{
							width: "100%",
							marginBottom: "var(--space-xl)",
							fontSize: "var(--font-md)",
							padding: "var(--space-md) var(--space-lg)",
						}}
					>
						{busy
							? `生成中 ${items.length - generatingCount}/${items.length}…`
							: "一键备稿"}
					</button>
					{busy && items.length > 0 && (
						<ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
							{items.map((item) => (
								<li
									key={item.id}
									style={{
										display: "flex",
										justifyContent: "space-between",
										padding: "5px 0",
										borderBottom: "1px solid var(--color-border-lighter)",
										fontSize: "var(--font-sm)",
									}}
								>
									<span
										style={{
											overflow: "hidden",
											textOverflow: "ellipsis",
											whiteSpace: "nowrap",
											flex: 1,
										}}
									>
										{item.topic}
									</span>
									<span
										style={{
											marginLeft: "var(--space-md)",
											color:
												STATUS_COLOR[item.status] ??
												"var(--color-text-disabled)",
											flexShrink: 0,
										}}
									>
										{STATUS_LABEL[item.status] ?? item.status}
									</span>
								</li>
							))}
						</ul>
					)}
				</>
			)}

			{stage === "review" && (
				<>
					<section className="stats-grid" aria-label="批次摘要">
						<div className="stat-tile">
							<span className="stat-value">{progressValue}%</span>
							<span className="stat-label">生成进度</span>
						</div>
						<div className="stat-tile">
							<span className="stat-value">{reviewableItems.length}</span>
							<span className="stat-label">待审发布</span>
						</div>
						<div className="stat-tile">
							<span className="stat-value">{blockedCount}</span>
							<span className="stat-label">需处理</span>
						</div>
						<div className="stat-tile">
							<span className="stat-value">{completedCount}</span>
							<span className="stat-label">已发布</span>
						</div>
					</section>

					<div
						className="flex-between"
						style={{ marginBottom: "var(--space-lg)" }}
					>
						<span className="text-secondary">
							当前批次 · {currentStep}中 · 共 {items.length} 条
						</span>
						<button
							type="button"
							onClick={() => {
								setStage("idle");
								setItems([]);
								setError("");
							}}
							className="btn btn-plain btn-sm"
						>
							新批次
						</button>
					</div>

					{isAllTerminal(items) && (
						<p
							className="text-success"
							style={{ marginBottom: "var(--space-lg)" }}
						>
							✓ 批次已完成
						</p>
					)}

					{reviewableItems.length > 0 && (
						<section style={{ marginBottom: "var(--space-xl)" }}>
							<p
								className="text-muted"
								style={{ margin: "0 0 var(--space-lg)" }}
							>
								待发布
							</p>
							{reviewableItems.map((item) => {
								const isRead = readItems.has(item.id);
								const isPublishing =
									publishingItems.has(item.id) ||
									item.status === "publish-dispatched";
								const bodyText = item.draft?.body
									? item.draft.body.replace(/<[^>]+>/g, "")
									: "";
								const isBodyExpanded = expandedBodies.has(item.id);
								const bodyPreview = bodyText.slice(0, 200);
								const hasMore = bodyText.length > 200;

								return (
									<div
										key={item.id}
										className="card"
										style={{ overflow: "hidden" }}
									>
										<details
											onToggle={() => handleToggleRead(item.id)}
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
												onClick={() => void handlePublish(item)}
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
					)}

					{gateFailedItems.length > 0 && (
						<section style={{ marginBottom: "var(--space-xl)" }}>
							<p
								className="text-muted"
								style={{ margin: "0 0 var(--space-lg)" }}
							>
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
											onClick={() => void handleRetry(item.id)}
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
							<p
								className="text-muted"
								style={{ margin: "0 0 var(--space-lg)" }}
							>
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
							<p
								className="text-muted"
								style={{ margin: "0 0 var(--space-lg)" }}
							>
								已发布
							</p>
							{confirmedItems.map((item) => (
								<div
									key={item.id}
									style={{
										padding: "var(--space-lg) var(--space-xl)",
										borderBottom: "1px solid var(--color-border-lighter)",
										display: "flex",
										justifyContent: "space-between",
									}}
								>
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
							))}
						</section>
					)}

					{terminalOtherItems.length > 0 && (
						<section style={{ marginBottom: "var(--space-xl)" }}>
							<p
								className="text-muted"
								style={{ margin: "0 0 var(--space-lg)" }}
							>
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

					{reviewableItems.length === 0 &&
						gateFailedItems.length === 0 &&
						needsVerificationItems.length === 0 &&
						terminalOtherItems.length === 0 &&
						confirmedItems.length === 0 && (
							<div className="banner-info">
								当前批次还没有可审读内容，生成进度会自动刷新。
							</div>
						)}
				</>
			)}
		</main>
	);
}
