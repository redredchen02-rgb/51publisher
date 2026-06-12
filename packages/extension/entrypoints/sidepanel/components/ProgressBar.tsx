interface ProgressBarProps {
	progress: number;
	label?: string;
	/** 不确定进度时显示动画扫描效果 */
	indeterminate?: boolean;
}

export function ProgressBar({ progress, label, indeterminate }: ProgressBarProps) {
	return (
		<div
			style={{
				width: "100%",
				height: 8,
				background: "#f0f0f0",
				borderRadius: 4,
				overflow: "hidden",
				position: "relative",
			}}
		>
			<div
				role="progressbar"
				aria-valuenow={indeterminate ? undefined : progress}
				aria-valuemin={0}
				aria-valuemax={100}
				aria-valuetext={indeterminate ? "加载中…" : undefined}
				style={
					indeterminate
						? {
								position: "absolute",
								width: "40%",
								height: "100%",
								background: "#1677ff",
								borderRadius: 4,
								animation: "progress-indeterminate 1.4s ease infinite",
							}
						: {
								width: `${progress}%`,
								height: "100%",
								background: "#1677ff",
								transition: "width 0.3s ease",
							}
				}
			/>
			{label && (
				<div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>
					{label}
				</div>
			)}
			<style>{`
				@keyframes progress-indeterminate {
					0% { left: -40%; }
					100% { left: 100%; }
				}
			`}</style>
		</div>
	);
}
