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
		<div className="card">
			<div className="flex-between" style={{ marginBottom: "var(--space-md)" }}>
				<span className="text-secondary">
					已选择 {selectedCount}/{totalCount} 项
				</span>
				<div style={{ display: "flex", gap: "var(--space-md)" }}>
					<button
						type="button"
						onClick={onSelectAll}
						disabled={isProcessing}
						className="btn btn-plain btn-sm"
					>
						全选
					</button>
					{selectedCount > 0 && (
						<button
							type="button"
							onClick={onClearSelection}
							disabled={isProcessing}
							className="btn btn-plain btn-sm"
						>
							取消选择
						</button>
					)}
				</div>
			</div>

			{selectedCount > 0 && (
				<div style={{ display: "flex", gap: "var(--space-md)" }}>
					<button
						type="button"
						onClick={onApprove}
						disabled={isProcessing}
						className="btn btn-primary"
					>
						{isProcessing ? "处理中..." : "批量批准"}
					</button>
					<button
						type="button"
						onClick={onDiscard}
						disabled={isProcessing}
						className="btn btn-danger"
					>
						{isProcessing ? "处理中..." : "批量否决"}
					</button>
				</div>
			)}

			{showProgress && (
				<div style={{ marginTop: "var(--space-md)" }}>
					<ProgressBar
						progress={progress}
						label={`处理进度: ${Math.round(progress)}%`}
					/>
				</div>
			)}
		</div>
	);
}
