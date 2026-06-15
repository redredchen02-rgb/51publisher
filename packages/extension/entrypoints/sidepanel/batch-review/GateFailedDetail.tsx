import type { BatchItem } from "@51publisher/shared";

// gate-failed 条目的接地拦截详情:拦截原因 + 原稿快照(防幻觉审核入口)+ 重新生成。
// 从 BatchReviewPanel 抽出的内聚子块;行为契约由 BatchReviewPanel.test.tsx 守护。

const retryBtn: React.CSSProperties = {
	padding: "2px 8px",
	fontSize: 11,
	border: "1px solid #ffd591",
	borderRadius: 4,
	cursor: "pointer",
	marginLeft: 6,
	background: "#fff7e6",
	color: "#874d00",
};

export function GateFailedDetail({
	item,
	busy,
	onRetryItem,
}: {
	item: BatchItem;
	busy?: boolean;
	onRetryItem?: (itemId: string) => void;
}) {
	return (
		<div style={{ marginBottom: 6 }}>
			<span
				role="status"
				aria-label="接地拦截原因"
				style={{
					display: "inline-block",
					background: "#fffbe6",
					border: "1px solid #ffe58f",
					color: "#874d00",
					borderRadius: 4,
					padding: "2px 8px",
					fontSize: 11,
					fontWeight: 600,
				}}
			>
				⚠ 接地拦截:{item.gateFailReason ?? "未知原因"}
			</span>
			{/* 展示原稿快照(含【待补】)让操作者知道缺哪些事实 */}
			{item.assembledDraftSnapshot && (
				<div
					style={{
						marginTop: 6,
						padding: "4px 8px",
						background: "#fff8f0",
						border: "1px solid #ffd591",
						borderRadius: 4,
						fontSize: 11,
						color: "#5c3c00",
					}}
				>
					<div style={{ fontWeight: 600, marginBottom: 2 }}>
						原稿(含缺失事实):
					</div>
					<div style={{ wordBreak: "break-all" }}>
						{item.assembledDraftSnapshot.title || "(无标题)"}
					</div>
				</div>
			)}
			{onRetryItem && (
				<button
					type="button"
					onClick={() => onRetryItem(item.id)}
					disabled={busy}
					style={retryBtn}
				>
					重新生成
				</button>
			)}
		</div>
	);
}
