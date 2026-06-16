interface ErrorLogEntry {
	id: string;
	message: string;
	timestamp: string;
}

interface ErrorLogPanelProps {
	logs: ErrorLogEntry[];
	onExport: () => void;
	onClear: () => void;
}

export function ErrorLogPanel({ logs, onExport, onClear }: ErrorLogPanelProps) {
	return (
		<div
			className="card surface-muted"
			style={{
				maxHeight: 200,
				overflowY: "auto",
				marginBottom: "var(--space-lg)",
			}}
		>
			<div className="flex-between" style={{ marginBottom: "var(--space-md)" }}>
				<span className="font-semibold">错误日志</span>
				<div style={{ display: "flex", gap: "var(--space-md)" }}>
					<button
						type="button"
						onClick={onExport}
						className="btn-icon text-info"
						style={{ fontSize: "var(--font-sm)" }}
					>
						导出
					</button>
					<button
						type="button"
						onClick={onClear}
						className="btn-icon text-error"
						style={{ fontSize: "var(--font-sm)" }}
					>
						清空
					</button>
				</div>
			</div>

			{logs.length === 0 ? (
				<div className="text-muted">暂无错误日志</div>
			) : (
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						gap: "var(--space-md)",
					}}
				>
					{logs.map((log) => (
						<div
							key={log.id}
							className="surface-elevated"
							style={{ padding: "var(--space-md)" }}
						>
							<div
								className="text-error"
								style={{ marginBottom: "var(--space-sm)" }}
							>
								{log.message}
							</div>
							<div className="text-muted text-xs">
								{new Date(log.timestamp).toLocaleString()}
							</div>
						</div>
					))}
				</div>
			)}
		</div>
	);
}
