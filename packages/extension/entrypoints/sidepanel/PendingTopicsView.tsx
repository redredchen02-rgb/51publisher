import React, { useCallback, useEffect, useState } from "react";
import { resolveAdminTabId, runBatch } from "../../lib/messaging";
import {
	fetchAdapters,
	fetchPendingTopics,
	type PendingTopic,
	patchPendingTopic,
	triggerScrape,
	updatePendingStatus,
} from "../../lib/pending-client";

interface QuickDraftConfirm {
	topics: PendingTopic[];
}

interface Props {
	onBack: () => void;
	onBatchStarted: () => void;
	onError: (msg: string) => void;
}

const btn: React.CSSProperties = {
	padding: "6px 12px",
	fontSize: 13,
	border: "none",
	borderRadius: 4,
	cursor: "pointer",
};

// FactsBlock 的固定字段（顺序决定展示顺序）。
const FACTS_KEYS = [
	"作品名",
	"集数",
	"制作",
	"漢化",
	"無修",
	"题材",
	"简介",
] as const;

export function PendingTopicsView({ onBack, onBatchStarted, onError }: Props) {
	const [topics, setTopics] = useState<PendingTopic[]>([]);
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [expanded, setExpanded] = useState<Set<string>>(new Set());
	const [localFacts, setLocalFacts] = useState<
		Record<string, Record<string, string>>
	>({});
	const [adapters, setAdapters] = useState<string[]>([]);
	const [scrapeStatus, setScrapeStatus] = useState("");
	const [busy, setBusy] = useState(false);
	const [loading, setLoading] = useState(true);
	const [quickDraftConfirm, setQuickDraftConfirm] =
		useState<QuickDraftConfirm | null>(null);
	const [quickDraftStatus, setQuickDraftStatus] = useState("");

	const refresh = useCallback(async () => {
		setLoading(true);
		const list = await fetchPendingTopics("pending");
		setTopics(list);
		setLoading(false);
	}, []);

	useEffect(() => {
		void refresh();
		void fetchAdapters().then(setAdapters);
	}, [refresh]);

	function toggleSelect(id: string) {
		setSelected((prev) => {
			const next = new Set(prev);
			next.has(id) ? next.delete(id) : next.add(id);
			return next;
		});
	}

	function initLocalFacts(id: string, facts: Record<string, string>) {
		setLocalFacts((prev) => {
			if (prev[id] !== undefined) return prev; // 已有编辑，不覆盖
			return { ...prev, [id]: { ...facts } };
		});
	}

	function toggleExpand(id: string, facts: Record<string, string>) {
		setExpanded((prev) => {
			const next = new Set(prev);
			next.has(id) ? next.delete(id) : next.add(id);
			return next;
		});
		initLocalFacts(id, facts);
	}

	function setFactField(id: string, key: string, value: string) {
		setLocalFacts((prev) => ({
			...prev,
			[id]: { ...(prev[id] ?? {}), [key]: value },
		}));
	}

	async function handleApproveSelected() {
		if (selected.size === 0) return;
		setBusy(true);
		try {
			const selectedTopics = topics.filter((t) => selected.has(t.id));

			// 1. PATCH any edited facts first, then update status.
			await Promise.all(
				selectedTopics.map(async (t) => {
					const edited = localFacts[t.id];
					if (edited) await patchPendingTopic(t.id, { facts: edited });
					await updatePendingStatus(t.id, "approved");
				}),
			);

			// 2. 定位后台发帖页 tab(按 host 全窗口找,不赌「当前活动标签」——
			//    side panel 自身/DevTools/别的标签抢焦点时,active tab 会钉错 → runBatch 静默流产)
			const adminTabId = await resolveAdminTabId();
			if (adminTabId == null) {
				onError("未找到后台发帖页标签——请先在浏览器打开后台发帖页。");
				setBusy(false);
				return;
			}

			// 3. Start batch with approved topics (use edited facts if available)
			const topicList = selectedTopics.map((t) => t.title || t.sourceUrl);
			const factsList = selectedTopics.map((t) => localFacts[t.id] ?? t.facts);
			const coverUrls = selectedTopics.map((t) => t.coverImageUrl ?? "");
			const hasCoverUrls = coverUrls.some((u) => u !== "");
			await runBatch(
				topicList,
				adminTabId,
				factsList.length > 0 ? factsList : undefined,
				hasCoverUrls ? coverUrls : undefined,
			);

			setSelected(new Set());
			onBatchStarted();
		} catch {
			onError("操作失败,请重试。");
		} finally {
			setBusy(false);
		}
	}

	async function handleRejectSelected() {
		if (selected.size === 0) return;
		setBusy(true);
		try {
			const selectedTopics = topics.filter((t) => selected.has(t.id));
			await Promise.all(
				selectedTopics.map((t) =>
					updatePendingStatus(t.id, "rejected", "manual reject"),
				),
			);
			setSelected(new Set());
			await refresh();
		} catch {
			onError("操作失败,请重试。");
		} finally {
			setBusy(false);
		}
	}

	async function handleQuickDraft() {
		setQuickDraftStatus("备稿中…");
		setQuickDraftConfirm(null);
		try {
			const sorted = await fetchPendingTopics({
				status: "pending",
				sort_by: "score",
			});
			if (sorted.length === 0) {
				setQuickDraftStatus("待审池暂无选题，请先抓取");
				return;
			}
			const top = sorted.slice(0, 3);
			setQuickDraftStatus("");
			setQuickDraftConfirm({ topics: top });
		} catch {
			setQuickDraftStatus("获取选题失败，请重试");
		}
	}

	async function handleQuickDraftConfirm() {
		if (!quickDraftConfirm) return;
		const confirmedTopics = quickDraftConfirm.topics;
		setQuickDraftConfirm(null);
		setQuickDraftStatus("");
		setSelected(new Set(confirmedTopics.map((t) => t.id)));
		setBusy(true);
		try {
			await Promise.all(
				confirmedTopics.map(async (t) => {
					const edited = localFacts[t.id];
					if (edited) await patchPendingTopic(t.id, { facts: edited });
					await updatePendingStatus(t.id, "approved");
				}),
			);
			const adminTabId = await resolveAdminTabId();
			if (adminTabId == null) {
				onError("未找到后台发帖页标签——请先在浏览器打开后台发帖页。");
				setBusy(false);
				return;
			}
			const topicList = confirmedTopics.map((t) => t.title || t.sourceUrl);
			const factsList = confirmedTopics.map((t) => localFacts[t.id] ?? t.facts);
			const coverUrls = confirmedTopics.map((t) => t.coverImageUrl ?? "");
			const hasCoverUrls = coverUrls.some((u) => u !== "");
			await runBatch(
				topicList,
				adminTabId,
				factsList.length > 0 ? factsList : undefined,
				hasCoverUrls ? coverUrls : undefined,
			);
			setSelected(new Set());
			onBatchStarted();
		} catch {
			onError("操作失败，请重试。");
		} finally {
			setBusy(false);
		}
	}

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
				<h1 style={{ fontSize: 16, margin: 0 }}>待审核选题</h1>
				<div style={{ display: "flex", gap: 6, alignItems: "center" }}>
					<button
						disabled={busy || adapters.length === 0}
						onClick={() => void handleQuickDraft()}
						style={{
							...btn,
							background: busy || adapters.length === 0 ? "#f0f0f0" : "#1677ff",
							color: busy || adapters.length === 0 ? "#bbb" : "#fff",
							padding: "4px 10px",
						}}
					>
						{quickDraftStatus === "备稿中…" ? "备稿中…" : "今日一键备稿"}
					</button>
					<button
						disabled={busy || adapters.length === 0}
						onClick={() => {
							void (async () => {
								const site =
									adapters.length === 1
										? adapters[0]!
										: adapters.length > 1
											? window.prompt(
													`选择适配器:\n${adapters.join("\n")}`,
													adapters[0],
												)
											: null;
								if (!site) return;
								setScrapeStatus("抓取中…");
								await triggerScrape(site);
								setTimeout(() => {
									setScrapeStatus("");
									void refresh();
								}, 2000);
							})();
						}}
						style={{
							...btn,
							background: adapters.length > 0 ? "#fa8c16" : "#f0f0f0",
							color: adapters.length > 0 ? "#fff" : "#bbb",
							padding: "4px 10px",
						}}
					>
						⚡ 立即抓取
					</button>
					<button
						onClick={() => void refresh()}
						style={{
							...btn,
							background: "#f0f0f0",
							color: "#333",
							padding: "4px 10px",
						}}
					>
						↻ 刷新
					</button>
					<button
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
			</div>
			{scrapeStatus && (
				<div style={{ fontSize: 12, color: "#fa8c16", marginBottom: 4 }}>
					{scrapeStatus}
				</div>
			)}

			{quickDraftStatus && !quickDraftConfirm && (
				<div
					style={{
						fontSize: 12,
						color: quickDraftStatus.startsWith("待审池") ? "#888" : "#1677ff",
						marginBottom: 4,
					}}
				>
					{quickDraftStatus}
				</div>
			)}

			{quickDraftConfirm && (
				<div
					style={{
						border: "1px solid #1677ff",
						borderRadius: 6,
						padding: "10px 12px",
						marginBottom: 8,
						background: "#f0f7ff",
						fontSize: 13,
					}}
				>
					<div style={{ fontWeight: 600, marginBottom: 6 }}>
						将生成 {quickDraftConfirm.topics.length} 篇草稿：
					</div>
					<ul style={{ margin: "0 0 8px 0", paddingLeft: 16 }}>
						{quickDraftConfirm.topics.map((t) => (
							<li
								key={t.id}
								style={{ marginBottom: 2, fontSize: 12, color: "#333" }}
							>
								{t.title || t.sourceUrl}
							</li>
						))}
					</ul>
					<div style={{ display: "flex", gap: 8 }}>
						<button
							onClick={() => void handleQuickDraftConfirm()}
							disabled={busy}
							style={{
								...btn,
								background: "#1677ff",
								color: "#fff",
								padding: "4px 12px",
							}}
						>
							确认生成
						</button>
						<button
							onClick={() => {
								setQuickDraftConfirm(null);
								setQuickDraftStatus("");
							}}
							disabled={busy}
							style={{
								...btn,
								background: "#f0f0f0",
								color: "#333",
								padding: "4px 12px",
							}}
						>
							取消
						</button>
					</div>
				</div>
			)}

			{loading && <div style={{ color: "#888", fontSize: 13 }}>加载中…</div>}

			{!loading && topics.length === 0 && (
				<div
					style={{
						color: "#888",
						fontSize: 13,
						marginTop: 16,
						textAlign: "center",
					}}
				>
					暂无待审核选题。
					<div style={{ marginTop: 8, fontSize: 12, color: "#aaa" }}>
						可通过后端 POST /api/v1/scraper/trigger 抓取新内容。
					</div>
				</div>
			)}

			{topics.length > 0 && (
				<>
					<div style={{ marginBottom: 8, fontSize: 12, color: "#888" }}>
						{topics.length} 条待审核 · 已选 {selected.size} 条
					</div>

					<ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
						{topics.map((t) => (
							<li
								key={t.id}
								style={{
									border: "1px solid #f0f0f0",
									borderRadius: 4,
									marginBottom: 4,
								}}
							>
								<div
									style={{
										display: "flex",
										alignItems: "center",
										padding: "6px 8px",
									}}
								>
									<input
										type="checkbox"
										checked={selected.has(t.id)}
										onChange={() => toggleSelect(t.id)}
										style={{ marginRight: 8 }}
										disabled={busy}
									/>
									<div style={{ flex: 1, minWidth: 0 }}>
										<div
											style={{
												fontWeight: 600,
												fontSize: 13,
												overflow: "hidden",
												textOverflow: "ellipsis",
												whiteSpace: "nowrap",
											}}
										>
											{t.title || t.sourceUrl}
										</div>
										<div style={{ fontSize: 11, color: "#888", marginTop: 1 }}>
											{t.siteName} · 置信度:{Math.round(t.confidence * 100)}% ·{" "}
											{t.sourceUrl.slice(0, 60)}
										</div>
									</div>
									<button
										onClick={() => toggleExpand(t.id, t.facts)}
										aria-expanded={expanded.has(t.id)}
										style={{
											...btn,
											padding: "2px 8px",
											fontSize: 11,
											background: "#f5f5f5",
											color: "#555",
										}}
									>
										{expanded.has(t.id) ? "收起" : "详情"}
									</button>
								</div>

								{expanded.has(t.id) && (
									<div
										style={{
											padding: "6px 10px",
											fontSize: 12,
											borderTop: "1px solid #f5f5f5",
										}}
									>
										{t.coverImageUrl && (
											<img
												src={t.coverImageUrl}
												alt="封面"
												style={{
													maxHeight: 60,
													marginBottom: 6,
													objectFit: "cover",
													borderRadius: 2,
												}}
											/>
										)}
										<div>
											<strong>事实（可编辑）:</strong>
											<div
												style={{
													marginTop: 4,
													display: "grid",
													gridTemplateColumns: "4em 1fr",
													gap: "3px 6px",
													alignItems: "center",
												}}
											>
												{FACTS_KEYS.map((key) => (
													<React.Fragment key={key}>
														<label
															style={{
																fontSize: 11,
																color: "#888",
																textAlign: "right",
															}}
														>
															{key}
														</label>
														<input
															type="text"
															value={(localFacts[t.id] ?? t.facts)[key] ?? ""}
															onChange={(e) =>
																setFactField(t.id, key, e.target.value)
															}
															disabled={busy}
															style={{
																fontSize: 11,
																padding: "1px 4px",
																border: "1px solid #d9d9d9",
																borderRadius: 2,
																width: "100%",
																boxSizing: "border-box",
															}}
														/>
													</React.Fragment>
												))}
											</div>
										</div>
										{t.rawContent?.body && (
											<div
												style={{
													marginTop: 6,
													maxHeight: 120,
													overflow: "auto",
													color: "#888",
													fontSize: 11,
												}}
											>
												<strong>原始内容(前300字):</strong>
												<div style={{ marginTop: 2 }}>
													{t.rawContent.body.slice(0, 300)}…
												</div>
											</div>
										)}
									</div>
								)}
							</li>
						))}
					</ul>

					<div style={{ display: "flex", gap: 8, marginTop: 12 }}>
						<button
							onClick={() => void handleApproveSelected()}
							disabled={selected.size === 0 || busy}
							style={{
								...btn,
								background: selected.size > 0 && !busy ? "#1677ff" : "#f5f5f5",
								color: selected.size > 0 && !busy ? "#fff" : "#bbb",
							}}
						>
							{busy ? "处理中…" : `批准 (${selected.size}) → 批量`}
						</button>
						<button
							onClick={() => void handleRejectSelected()}
							disabled={selected.size === 0 || busy}
							style={{
								...btn,
								background: selected.size > 0 && !busy ? "#f0f0f0" : "#fafafa",
								color: selected.size > 0 && !busy ? "#cf1322" : "#ccc",
								border: "1px solid #d9d9d9",
							}}
						>
							拒绝
						</button>
					</div>
				</>
			)}
		</main>
	);
}
