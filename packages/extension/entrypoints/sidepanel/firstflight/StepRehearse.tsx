import type { FirstFlightRehearseResult } from "@51publisher/shared";

interface Props {
	rehearsing: boolean;
	rehearsal: FirstFlightRehearseResult | null;
	canForwardFrom2: boolean;
	onRehearse: () => void;
	onNext: () => void;
	onBack: () => void;
}

export function StepRehearse({ rehearsing, rehearsal, canForwardFrom2, onRehearse, onNext, onBack }: Props) {
	return (
		<section aria-label="排演">
			<p className="text-secondary">
				排演会在 dry-run 档跑一遍填充并核对接地(grounding),全绿才能继续。绝不真发。
			</p>
			<button
				type="button"
				className="btn btn-primary"
				onClick={onRehearse}
				disabled={rehearsing}
				aria-disabled={rehearsing}
			>
				{rehearsing ? "排演中…" : "开始排演"}
			</button>
			{rehearsing && (
				<div aria-live="polite" className="text-secondary" style={{ marginTop: 8 }}>
					正在 dry-run 排演,请稍候…
				</div>
			)}
			{rehearsal && (
				<div aria-live="polite" style={{ marginTop: "var(--space-md)" }}>
					{rehearsal.ok ? (
						<div className="banner-info" role="status">
							✅ 排演全绿(dry-run 通过 + 接地通过)。
						</div>
					) : (
						<div className="banner-error" role="alert">
							排演未通过{rehearsal.error ? `:${rehearsal.error}` : ""}
							{rehearsal.reasons.length > 0 && (
								<ul style={{ margin: "var(--space-sm) 0 0", paddingLeft: 18 }}>
									{rehearsal.reasons.map((r) => (
										<li key={r}>{r}</li>
									))}
								</ul>
							)}
						</div>
					)}
				</div>
			)}
			<div style={{ marginTop: "var(--space-lg)", display: "flex", gap: 8 }}>
				<button
					type="button"
					className="btn btn-primary"
					onClick={onNext}
					disabled={!canForwardFrom2}
					aria-disabled={!canForwardFrom2}
				>
					下一步:确认真实站点
				</button>
				<button type="button" className="btn btn-plain" onClick={onBack}>
					上一步
				</button>
			</div>
		</section>
	);
}
