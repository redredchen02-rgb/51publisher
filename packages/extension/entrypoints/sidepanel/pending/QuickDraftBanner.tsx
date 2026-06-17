import type { PendingTopic } from "../../../lib/api/pending-client";

interface Props {
	topics: PendingTopic[];
	busy: boolean;
	onConfirm: () => void;
	onCancel: () => void;
}

export function QuickDraftBanner({ topics, busy, onConfirm, onCancel }: Props) {
	return (
		<div className="banner-info" style={{ marginBottom: "var(--space-md)" }}>
			<div
				className="font-semibold"
				style={{ marginBottom: "var(--space-lg)" }}
			>
				将生成 {topics.length} 篇草稿：
			</div>
			<ul
				style={{
					margin: "0 0 var(--space-md) 0",
					paddingLeft: "var(--space-xl)",
				}}
			>
				{topics.map((t) => (
					<li
						key={t.id}
						style={{
							marginBottom: "var(--space-xs)",
							fontSize: "var(--font-sm)",
							color: "var(--color-text)",
						}}
					>
						{t.title || t.sourceUrl}
					</li>
				))}
			</ul>
			<div style={{ display: "flex", gap: "var(--space-md)" }}>
				<button
					type="button"
					onClick={onConfirm}
					disabled={busy}
					className="btn btn-primary btn-sm"
				>
					确认生成
				</button>
				<button
					type="button"
					onClick={onCancel}
					disabled={busy}
					className="btn btn-plain btn-sm"
				>
					取消
				</button>
			</div>
		</div>
	);
}
