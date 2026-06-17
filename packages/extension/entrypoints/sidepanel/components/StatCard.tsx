/** 可复用的统计指标卡片组件。 */
export function StatCard({
	label,
	value,
	sub,
}: {
	label: string;
	value: string | number;
	sub?: string;
}) {
	return (
		<div
			style={{
				background: "var(--color-surface)",
				border: "1px solid var(--color-border)",
				borderRadius: 8,
				padding: "12px 16px",
				flex: "1 1 120px",
				minWidth: 0,
			}}
		>
			<div
				style={{
					fontSize: "var(--font-sm)",
					color: "var(--color-text-secondary)",
				}}
			>
				{label}
			</div>
			<div style={{ fontSize: 22, fontWeight: 700, margin: "4px 0 2px" }}>
				{value}
			</div>
			{sub && (
				<div
					style={{
						fontSize: "var(--font-xs)",
						color: "var(--color-text-disabled)",
					}}
				>
					{sub}
				</div>
			)}
		</div>
	);
}
