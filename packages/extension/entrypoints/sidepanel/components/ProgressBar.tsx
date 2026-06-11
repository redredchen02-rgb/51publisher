import React from "react";

interface ProgressBarProps {
	progress: number;
	label?: string;
}

export function ProgressBar({ progress, label }: ProgressBarProps) {
	return (
		<div
			style={{
				width: "100%",
				height: 8,
				background: "#f0f0f0",
				borderRadius: 4,
				overflow: "hidden",
			}}
		>
			<div
				role="progressbar"
				aria-valuenow={progress}
				aria-valuemin={0}
				aria-valuemax={100}
				style={{
					width: `${progress}%`,
					height: "100%",
					background: "#1677ff",
					transition: "width 0.3s ease",
				}}
			/>
			{label && (
				<div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>
					{label}
				</div>
			)}
		</div>
	);
}
