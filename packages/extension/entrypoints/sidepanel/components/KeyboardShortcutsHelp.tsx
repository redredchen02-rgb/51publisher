import { useState } from "react";

interface Shortcut {
	keys: string;
	description: string;
}

const shortcuts: Shortcut[] = [
	{ keys: "Ctrl + Enter", description: "生成草稿" },
	{ keys: "Ctrl + Shift + Enter", description: "填充到当前页" },
	{ keys: "Ctrl + →", description: "下一条" },
	{ keys: "Ctrl + S", description: "保存" },
];

export function KeyboardShortcutsHelp() {
	const [isOpen, setIsOpen] = useState(false);

	return (
		<>
			<button
				type="button"
				aria-label="快捷键帮助"
				onClick={() => setIsOpen(true)}
				style={{
					border: "none",
					background: "none",
					cursor: "pointer",
					fontSize: 12,
					color: "#666",
					padding: "0 4px",
				}}
			>
				?
			</button>

			{isOpen && (
				<div
					role="dialog"
					style={{
						position: "fixed",
						top: 0,
						left: 0,
						right: 0,
						bottom: 0,
						background: "rgba(0, 0, 0, 0.5)",
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						zIndex: 1000,
					}}
					onClick={(e) => {
						if (e.target === e.currentTarget) {
							setIsOpen(false);
						}
					}}
				>
					<div
						style={{
							background: "white",
							borderRadius: 8,
							padding: 16,
							maxWidth: 400,
							width: "100%",
						}}
					>
						<div
							style={{
								display: "flex",
								justifyContent: "space-between",
								alignItems: "center",
								marginBottom: 12,
							}}
						>
							<h3 style={{ margin: 0, fontSize: 16 }}>快捷键帮助</h3>
							<button
								type="button"
								aria-label="关闭"
								onClick={() => setIsOpen(false)}
								style={{
									border: "none",
									background: "none",
									cursor: "pointer",
									fontSize: 16,
									color: "#666",
								}}
							>
								×
							</button>
						</div>

						<div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
							{shortcuts.map((shortcut) => (
								<div
									key={shortcut.keys}
									style={{
										display: "flex",
										justifyContent: "space-between",
										padding: "8px 0",
										borderBottom: "1px solid #f0f0f0",
									}}
								>
									<span style={{ fontWeight: 500 }}>{shortcut.keys}</span>
									<span style={{ color: "#666" }}>{shortcut.description}</span>
								</div>
							))}
						</div>
					</div>
				</div>
			)}
		</>
	);
}
