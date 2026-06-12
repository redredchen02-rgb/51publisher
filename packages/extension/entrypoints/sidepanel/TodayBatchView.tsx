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

const btn: React.CSSProperties = {
	padding: "6px 12px",
	fontSize: 13,
	border: "none",
	borderRadius: 4,
	cursor: "pointer",
};

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
	queued: "#8c8c8c",
	generating: "#1677ff",
	filled: "#52c41a",
	"gate-failed": "#cf1322",
	"awaiting-approval": "#fa8c16",
	"publish-dispatched": "#1677ff",
	"publish-confirmed": "#52c41a",
	"needs-human-verification": "#cf1322",
	aborted: "#8c8c8c",
	error: "#cf1322",
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

/** Phase 5 一键日常备稿视图:备稿触发 → 生成进度 → 逐篇审读 → 单条发布。 */
export function TodayBatchView({ onBack }: { onBack: () => void }) {
	const [dailyBatchSize, setDailyBatchSize] = useState(5);
	const [adminTabId, setAdminTabId] = useState<number | null | undefined>(
		undefined,
	);
	const [tabError, setTabError] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");

	// stage: "idle" → "generating" → "review"
	const [stage, setStage] = useState<"idle" | "generating" | "review">("idle");
	const [items, setItems] = useState<BatchItem[]>([]);
	// 已读 id 集合(持久化 via chrome.storage.local)
	const [readItems, setReadItems] = useState<Set<string>>(new Set());
	// 乐观锁:点「发布」后立即 disable,防重复触发
	const [publishingItems, setPublishingItems] = useState<Set<string>>(
		new Set(),
	);
	// 展开的正文内容(查看全文)
	const [expandedBodies, setExpandedBodies] = useState<Set<string>>(new Set());

	const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

	// 挂载:并行加载设置 + 解析后台 tab
	useEffect(() => {
		void (async () => {
			const [settings, tabId] = await Promise.all([
				getSettings(),
				resolveAdminTabId(),
			]);
			setDailyBatchSize(settings.dailyBatchSize ?? 5);
			setAdminTabId(tabId);
			if (tabId == null) {
				setTabError("未找到后台发帖页——请先打开后台发帖页标签。");
			}
		})();
	}, []);

	// Phase 2 轮询:stage=review 时启动,所有条目终态后停止
	useEffect(() => {
		if (stage !== "review") {
			if (pollRef.current) {
				clearInterval(pollRef.current);
				pollRef.current = null;
			}
			return;
		}
		// 已全部终态则不需要轮询
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
	}, [stage, items]); // items 变化不重启轮询,只在 stage 切换时重建

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

		let progressPoll: ReturnType<typeof setInterval> | undefined;
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

			progressPoll = setInterval(() => {
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

			clearInterval(progressPoll);

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

			// 加载持久化已读集合
			const reads = await getReadItems();
			setReadItems(reads);
			setStage("review");
		} catch {
			clearInterval(progressPoll);
			setError("启动批量失败,请重试。");
			setStage("idle");
		} finally {
			setBusy(false);
		}
	}

	async function handlePublish(item: BatchItem, postStatus: string) {
		if (adminTabId == null) return;
		setPublishingItems((prev) => new Set([...prev, item.id]));
		try {
			// postStatus 覆盖:用 draftOverrides 在 background 层注入(如不为 "0" 则覆盖)
			// 注:approveSingleItem 目前不传 draftOverrides,postStatus 非"0"时需另行处理
			// 简化实现:直接发 approveSingleItem,postStatus 覆盖由后续迭代处理
			void postStatus; // 计划中的字段,暂时记录但不改变消息
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

	return (
		<main
			style={{ fontFamily: "system-ui, sans-serif", padding: 12, fontSize: 14 }}
		>
			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					alignItems: "center",
					marginBottom: 8,
				}}
			>
				<h1 style={{ fontSize: 16, margin: 0 }}>今日备稿</h1>
				<button
					type="button"
					onClick={onBack}
					style={{
						...btn,
						background: "#f0f0f0",
						color: "#333",
						padding: "4px 10px",
					}}
				>
					← 返回
				</button>
			</div>

			{tabError && (
				<p
					role="alert"
					style={{ color: "#cf1322", fontSize: 13, marginBottom: 8 }}
				>
					{tabError}
				</p>
			)}

			{error && (
				<p
					role="alert"
					style={{ color: "#cf1322", fontSize: 13, marginBottom: 8 }}
				>
					{error}
				</p>
			)}

			{/* Phase 1 / idle */}
			{stage !== "review" && (
				<>
					<p style={{ fontSize: 12, color: "#555", margin: "0 0 12px" }}>
						自动从高分待审选题中取前 <strong>{dailyBatchSize}</strong>{" "}
						条，一键触发批量生成。
					</p>
					<button
						type="button"
						onClick={() => void handleDailyBatch()}
						disabled={busy || adminTabId == null}
						style={{
							...btn,
							background: busy || adminTabId == null ? "#d9d9d9" : "#1677ff",
							color: busy || adminTabId == null ? "#8c8c8c" : "#fff",
							width: "100%",
							marginBottom: 12,
							fontSize: 14,
							padding: "8px 12px",
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
										borderBottom: "1px solid #f0f0f0",
										fontSize: 12,
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
											marginLeft: 8,
											color: STATUS_COLOR[item.status] ?? "#8c8c8c",
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

			{/* Phase 2: 审读队列 */}
			{stage === "review" && (
				<>
					<div
						style={{
							display: "flex",
							justifyContent: "space-between",
							alignItems: "center",
							marginBottom: 10,
						}}
					>
						<span style={{ fontSize: 13, color: "#555" }}>
							审读队列 · 共 {items.length} 条
						</span>
						<button
							type="button"
							onClick={() => {
								setStage("idle");
								setItems([]);
								setError("");
							}}
							style={{
								...btn,
								background: "#f0f0f0",
								color: "#333",
								padding: "3px 8px",
								fontSize: 12,
							}}
						>
							新批次
						</button>
					</div>

					{isAllTerminal(items) && (
						<p style={{ fontSize: 13, color: "#389e0d", marginBottom: 10 }}>
							✓ 批次已完成
						</p>
					)}

					{/* 待发布 */}
					{reviewableItems.length > 0 && (
						<section style={{ marginBottom: 12 }}>
							<p style={{ fontSize: 12, color: "#8c8c8c", margin: "0 0 6px" }}>
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
										style={{
											border: "1px solid #e8e8e8",
											borderRadius: 6,
											marginBottom: 8,
											overflow: "hidden",
										}}
									>
										{/* 折叠头 */}
										<details
											onToggle={() => handleToggleRead(item.id)}
											style={{ padding: 0 }}
										>
											<summary
												style={{
													padding: "8px 10px",
													cursor: "pointer",
													listStyle: "none",
													display: "flex",
													justifyContent: "space-between",
													alignItems: "center",
													gap: 8,
												}}
											>
												<span
													style={{
														flex: 1,
														overflow: "hidden",
														textOverflow: "ellipsis",
														whiteSpace: "nowrap",
														fontSize: 13,
														fontWeight: 500,
													}}
												>
													{item.draft?.title ?? item.topic}
												</span>
												<span
													style={{
														fontSize: 11,
														color: isRead ? "#52c41a" : "#fa8c16",
														flexShrink: 0,
													}}
												>
													{isRead ? "已读" : "未读"}
												</span>
											</summary>
											<div
												style={{
													padding: "8px 10px",
													borderTop: "1px solid #f0f0f0",
													fontSize: 12,
													color: "#555",
												}}
											>
												{item.draft?.subtitle && (
													<p style={{ margin: "0 0 6px", fontStyle: "italic" }}>
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
																style={{
																	background: "none",
																	border: "none",
																	color: "#1677ff",
																	cursor: "pointer",
																	fontSize: 12,
																	padding: "0 2px",
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
															style={{
																background: "none",
																border: "none",
																color: "#8c8c8c",
																cursor: "pointer",
																fontSize: 12,
																padding: "0 2px",
															}}
														>
															收起
														</button>
													)}
												</p>
											</div>
										</details>
										{/* 发布行 */}
										<div
											style={{
												padding: "6px 10px",
												background: "#fafafa",
												display: "flex",
												justifyContent: "flex-end",
												gap: 8,
											}}
										>
											<button
												type="button"
												disabled={!isRead || isPublishing}
												onClick={() => void handlePublish(item, "0")}
												title={!isRead ? "请先展开预览后才能发布" : ""}
												style={{
													...btn,
													background:
														!isRead || isPublishing ? "#d9d9d9" : "#52c41a",
													color: !isRead || isPublishing ? "#8c8c8c" : "#fff",
													padding: "4px 12px",
													fontSize: 12,
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

					{/* 内容问题 */}
					{gateFailedItems.length > 0 && (
						<section style={{ marginBottom: 12 }}>
							<p style={{ fontSize: 12, color: "#8c8c8c", margin: "0 0 6px" }}>
								内容问题
							</p>
							{gateFailedItems.map((item) => (
								<div
									key={item.id}
									style={{
										border: "1px solid #ffccc7",
										borderRadius: 6,
										padding: "8px 10px",
										marginBottom: 6,
										background: "#fff2f0",
									}}
								>
									<div
										style={{
											display: "flex",
											justifyContent: "space-between",
											alignItems: "flex-start",
										}}
									>
										<div style={{ flex: 1 }}>
											<p style={{ margin: 0, fontSize: 13, fontWeight: 500 }}>
												{item.topic}
											</p>
											{item.gateFailReason && (
												<p
													style={{
														margin: "4px 0 0",
														fontSize: 11,
														color: "#cf1322",
													}}
												>
													{item.gateFailReason}
												</p>
											)}
										</div>
										<button
											type="button"
											onClick={() => void handleRetry(item.id)}
											style={{
												...btn,
												background: "#fff1f0",
												color: "#cf1322",
												border: "1px solid #ffccc7",
												padding: "3px 8px",
												fontSize: 12,
												flexShrink: 0,
											}}
										>
											重新生成
										</button>
									</div>
								</div>
							))}
						</section>
					)}

					{/* 已发布 */}
					{confirmedItems.length > 0 && (
						<section style={{ marginBottom: 12 }}>
							<p style={{ fontSize: 12, color: "#8c8c8c", margin: "0 0 6px" }}>
								已发布
							</p>
							{confirmedItems.map((item) => (
								<div
									key={item.id}
									style={{
										padding: "6px 10px",
										borderBottom: "1px solid #f0f0f0",
										display: "flex",
										justifyContent: "space-between",
										fontSize: 13,
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
										style={{ marginLeft: 8, color: "#52c41a", flexShrink: 0 }}
									>
										✓ 已发布
									</span>
								</div>
							))}
						</section>
					)}

					{/* 错误/中止 */}
					{terminalOtherItems.length > 0 && (
						<section style={{ marginBottom: 12 }}>
							<p style={{ fontSize: 12, color: "#8c8c8c", margin: "0 0 6px" }}>
								出错/中止
							</p>
							{terminalOtherItems.map((item) => (
								<div
									key={item.id}
									style={{
										padding: "6px 10px",
										borderBottom: "1px solid #f0f0f0",
										fontSize: 12,
										color: "#8c8c8c",
									}}
								>
									<span>{item.topic}</span>
									{item.error && (
										<span
											style={{
												marginLeft: 8,
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
			)}
		</main>
	);
}
