interface Props {
	busy: boolean;
	adaptersAvailable: boolean;
	quickDraftStatus: string;
	onBack: () => void;
	onRefresh: () => void;
	onScrape: () => void;
	onQuickDraft: () => void;
}

export function PendingTopicsNav({
	busy,
	adaptersAvailable,
	quickDraftStatus,
	onBack,
	onRefresh,
	onScrape,
	onQuickDraft,
}: Props) {
	return (
		<nav className="flex-between mb-md">
			<h1 style={{ fontSize: "var(--font-xl)", margin: 0 }}>待审核选题</h1>
			<div className="flex gap-sm" style={{ alignItems: "center" }}>
				<button
					type="button"
					disabled={busy || !adaptersAvailable}
					onClick={onQuickDraft}
					className="btn btn-primary btn-sm"
				>
					{quickDraftStatus === "备稿中…" ? "备稿中…" : "今日一键备稿"}
				</button>
				<button
					type="button"
					disabled={busy || !adaptersAvailable}
					onClick={onScrape}
					className="btn btn-sm"
					style={{
						background: adaptersAvailable
							? "var(--color-warning)"
							: "var(--color-border-lighter)",
						color: adaptersAvailable ? "#fff" : "var(--color-text-disabled)",
					}}
				>
					⚡ 立即抓取
				</button>
				<button
					type="button"
					onClick={onRefresh}
					className="btn btn-plain btn-sm"
				>
					↻ 刷新
				</button>
				<button type="button" onClick={onBack} className="btn btn-plain btn-sm">
					← 返回
				</button>
			</div>
		</nav>
	);
}
