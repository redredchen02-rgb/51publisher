import { useState } from "react";

interface ErrorDisplayProps {
	message: string;
	solution?: string;
	details?: string;
	onRetry?: () => void;
	onDismiss?: () => void;
}

export function ErrorDisplay({
	message,
	solution,
	details,
	onRetry,
	onDismiss,
}: ErrorDisplayProps) {
	const [showDetails, setShowDetails] = useState(false);

	return (
		<div
			role="alert"
			style={{
				background: "#fff1f0",
				border: "1px solid #ffa39e",
				borderRadius: 6,
				padding: "12px 16px",
				marginBottom: 12,
			}}
		>
			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					alignItems: "flex-start",
				}}
			>
				<div>
					<div style={{ fontWeight: 600, color: "#cf1322", marginBottom: 4 }}>
						{message}
					</div>
					{solution && (
						<div style={{ fontSize: 13, color: "#8c8c8c", marginBottom: 4 }}>
							{solution}
						</div>
					)}
				</div>
				<div style={{ display: "flex", gap: 8 }}>
					{onRetry && (
						<button
							type="button"
							onClick={onRetry}
							style={{
								border: "none",
								background: "#ff7875",
								color: "white",
								padding: "4px 12px",
								borderRadius: 4,
								cursor: "pointer",
								fontSize: 12,
							}}
						>
							重试
						</button>
					)}
					{onDismiss && (
						<button
							type="button"
							onClick={onDismiss}
							aria-label="关闭"
							style={{
								border: "none",
								background: "none",
								cursor: "pointer",
								fontSize: 12,
								color: "#8c8c8c",
							}}
						>
							关闭
						</button>
					)}
				</div>
			</div>

			{details && (
				<div style={{ marginTop: 8 }}>
					<button
						type="button"
						onClick={() => setShowDetails(!showDetails)}
						style={{
							border: "none",
							background: "none",
							cursor: "pointer",
							fontSize: 12,
							color: "#1677ff",
							padding: 0,
						}}
					>
						{showDetails ? "隐藏详情" : "显示详情"}
					</button>
					{showDetails && (
						<pre
							style={{
								background: "#fff7e6",
								border: "1px solid #ffd591",
								borderRadius: 4,
								padding: 8,
								marginTop: 4,
								fontSize: 11,
								overflowX: "auto",
								whiteSpace: "pre-wrap",
							}}
						>
							{details}
						</pre>
					)}
				</div>
			)}
		</div>
	);
}
