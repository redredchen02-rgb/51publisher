import { ProgressBar } from "./ProgressBar";

interface BatchToolbarProps {
	selectedCount: number;
	totalCount: number;
	isProcessing: boolean;
	progress?: number;
	onSelectAll: () => void;
	onClearSelection: () => void;
	onApprove: () => void;
	onDiscard: () => void;
}

export function BatchToolbar({
	selectedCount,
	totalCount,
	isProcessing,
	progress = 0,
	onSelectAll,
	onClearSelection,
	onApprove,
	onDiscard,
}: BatchToolbarProps) {
	const showProgress = isProcessing || progress > 0;

	return (
		<div
			style={{
				background: "#fafafa",
				border: "1px solid #d9d9d9",
				borderRadius: 6,
				padding: 12,
				marginBottom: 12,
			}}
		>
			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					alignItems: "center",
					marginBottom: 8,
				}}
			>
				<span style={{ fontSize: 13, color: "#666" }}>
					已选择 {selectedCount}/{totalCount} 项
				</span>
				<div style={{ display: "flex", gap: 8 }}>
					<button
						onClick={onSelectAll}
						disabled={isProcessing}
						style={{
							border: "none",
							background: "#f0f0f0",
							color: "#333",
							padding: "4px 12px",
							borderRadius: 4,
							cursor: isProcessing ? "not-allowed" : "pointer",
							fontSize: 12,
						}}
					>
						全选
					</button>
					{selectedCount > 0 && (
						<button
							onClick={onClearSelection}
							disabled={isProcessing}
							style={{
								border: "none",
								background: "#f0f0f0",
								color: "#333",
								padding: "4px 12px",
								borderRadius: 4,
								cursor: isProcessing ? "not-allowed" : "pointer",
								fontSize: 12,
							}}
						>
							取消选择
						</button>
					)}
				</div>
			</div>

			{selectedCount > 0 && (
				<div style={{ display: "flex", gap: 8 }}>
					<button
						onClick={onApprove}
						disabled={isProcessing}
						style={{
							border: "none",
							background: "#1677ff",
							color: "white",
							padding: "6px 16px",
							borderRadius: 4,
							cursor: isProcessing ? "not-allowed" : "pointer",
							fontSize: 13,
						}}
					>
						{isProcessing ? "处理中..." : "批量批准"}
					</button>
					<button
						onClick={onDiscard}
						disabled={isProcessing}
						style={{
							border: "none",
							background: "#ff4d4f",
							color: "white",
							padding: "6px 16px",
							borderRadius: 4,
							cursor: isProcessing ? "not-allowed" : "pointer",
							fontSize: 13,
						}}
					>
						{isProcessing ? "处理中..." : "批量否决"}
					</button>
				</div>
			)}

			{showProgress && (
				<div style={{ marginTop: 8 }}>
					<ProgressBar
						progress={progress}
						label={`处理进度: ${Math.round(progress)}%`}
					/>
				</div>
			)}
		</div>
	);
}
