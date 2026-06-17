interface Props {
	selectedCount: number;
	busy: boolean;
	onApprove: () => void;
	onReject: () => void;
}

export function TopicActionBar({
	selectedCount,
	busy,
	onApprove,
	onReject,
}: Props) {
	return (
		<div
			style={{
				display: "flex",
				gap: "var(--space-md)",
				marginTop: "var(--space-xl)",
			}}
		>
			<button
				type="button"
				onClick={onApprove}
				disabled={selectedCount === 0 || busy}
				className="btn btn-primary"
			>
				{busy ? "处理中…" : `批准 (${selectedCount}) → 批量`}
			</button>
			<button
				type="button"
				onClick={onReject}
				disabled={selectedCount === 0 || busy}
				className="btn btn-plain"
				style={{
					borderColor: "var(--color-border)",
					color:
						selectedCount > 0 && !busy
							? "var(--color-error)"
							: "var(--color-text-disabled)",
				}}
			>
				拒绝
			</button>
		</div>
	);
}
