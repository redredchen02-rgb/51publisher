import { useEffect, useState } from "react";
import type { BatchItem } from "../../lib/batch";
import { resolveAdminTabId, runBatch } from "../../lib/messaging";
import { fetchPendingTopics } from "../../lib/pending-client";
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
	"gate-failed": "接地失败",
	"awaiting-approval": "待审批",
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

/** Phase 5 一键日常备稿视图:自动从 pending 高分选题拉取 N 条并触发批量生成。 */
export function TodayBatchView({ onBack }: { onBack: () => void }) {
	const [dailyBatchSize, setDailyBatchSize] = useState(5);
	const [adminTabId, setAdminTabId] = useState<number | null | undefined>(
		undefined,
	);
	const [tabError, setTabError] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [items, setItems] = useState<BatchItem[]>([]);
	const [done, setDone] = useState(false);

	// 挂载:并行加载设置 + 解析后台 tab(早期警告,不阻塞渲染)。
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

	async function handleDailyBatch() {
		if (adminTabId == null) {
			setTabError("未找到后台发帖页——请先打开后台发帖页标签。");
			return;
		}
		setBusy(true);
		setError("");
		setDone(false);
		try {
			// 拉取高分待审选题,截取前 N 条。
			const pendingTopics = await fetchPendingTopics({
				status: "pending",
				sort_by: "score",
			});
			const topN = pendingTopics.slice(0, dailyBatchSize);
			if (topN.length === 0) {
				setError("暂无待处理选题,请先到「待审」页面抓取或添加选题。");
				return;
			}

			const topics = topN.map((t) => t.title);
			const factsList = topN.map((t) => t.facts ?? {});
			const topicIds = topN.map((t) => t.id);
			const enrichments = topN.map((t) => t.enrichmentText);

			// 传 topicIds 使 handleRunBatch 能写 item.pendingTopicId。
			await runBatch(
				topics,
				adminTabId,
				factsList,
				undefined,
				undefined,
				topicIds,
				enrichments,
			);

			// 构造轻量展示列表(真实批次状态由 BatchView 展示,此处仅给用户即时反馈)。
			const preview: BatchItem[] = topN.map((t) => ({
				id: t.id ?? t.title,
				topic: t.title,
				facts: t.facts ?? {},
				status: "queued",
				pendingTopicId: t.id,
			}));
			setItems(preview);
			setDone(true);
		} catch {
			setError("启动批量失败,请重试。");
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

			<p style={{ fontSize: 12, color: "#555", margin: "0 0 12px" }}>
				自动从高分待审选题中取前 <strong>{dailyBatchSize}</strong>{" "}
				条，一键触发批量生成。
			</p>

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
				{busy ? "生成中…" : "一键备稿"}
			</button>

			{done && items.length > 0 && (
				<>
					<div style={{ fontSize: 12, color: "#389e0d", marginBottom: 8 }}>
						✓ 已触发 {items.length} 条生成，请切换到「批量」视图查看进度。
					</div>
					<ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
						{items.map((item) => (
							<li
								key={item.id}
								style={{
									display: "flex",
									justifyContent: "space-between",
									alignItems: "center",
									padding: "6px 0",
									borderBottom: "1px solid #f0f0f0",
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
									{item.topic}
								</span>
								<span
									style={{
										marginLeft: 8,
										fontSize: 11,
										color: STATUS_COLOR[item.status] ?? "#8c8c8c",
										flexShrink: 0,
									}}
								>
									{STATUS_LABEL[item.status] ?? item.status}
								</span>
							</li>
						))}
					</ul>
				</>
			)}
		</main>
	);
}
