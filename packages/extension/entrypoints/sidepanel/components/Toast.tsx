import { useEffect } from "react";

interface ToastProps {
	message: string;
	type: "success" | "error" | "info";
	onClose?: () => void;
	duration?: number;
}

const BG: Record<ToastProps["type"], string> = {
	success: "#f6ffed",
	error: "#fff1f0",
	info: "#e6f7ff",
};

const BORDER: Record<ToastProps["type"], string> = {
	success: "#b7eb8f",
	error: "#ffa39e",
	info: "#91d5ff",
};

export function Toast({ message, type, onClose, duration = 3000 }: ToastProps) {
	useEffect(() => {
		if (!onClose) return;
		const timer = setTimeout(onClose, duration);
		return () => clearTimeout(timer);
	}, [onClose, duration]);

	return (
		<div
			role="alert"
			style={{
				background: BG[type],
				border: `1px solid ${BORDER[type]}`,
				borderRadius: 4,
				padding: "8px 12px",
				marginBottom: 8,
				display: "flex",
				justifyContent: "space-between",
				alignItems: "center",
				fontSize: 13,
			}}
		>
			<span>{message}</span>
			{onClose && (
				<button
					type="button"
					aria-label="关闭"
					onClick={onClose}
					style={{
						border: "none",
						background: "none",
						cursor: "pointer",
						fontSize: 14,
						color: "#666",
						padding: "0 4px",
						lineHeight: 1,
					}}
				>
					×
				</button>
			)}
		</div>
	);
}
