import type { PreflightResponse } from "./types";

interface Props {
	preflight: PreflightResponse | null;
	preflightError: string | null;
	onNext: () => void;
}

export function StepPreflight({ preflight, preflightError, onNext }: Props) {
	return (
		<section aria-label="preflight 自检结论">
			{preflightError && (
				<div className="banner-error" role="alert">
					{preflightError}
				</div>
			)}
			{preflight && (
				<>
					<div
						className={preflight.ok ? "banner-info" : "banner-error"}
						role="status"
					>
						总体:{preflight.ok ? "🟢 自检通过" : "🟢 自检未通过"} (
						{preflight.checks.filter((c) => c.pass).length}/
						{preflight.checks.length} 项通过)
					</div>

					{preflight.checks.some((c) => !c.pass) && (
						<div
							className="banner-error"
							data-zone="self-check-failed"
							style={{ marginTop: "var(--space-md)" }}
						>
							<strong className="text-error">🟢 自检未通过项</strong>
							<ul style={{ margin: "var(--space-sm) 0 0", paddingLeft: 18 }}>
								{preflight.checks
									.filter((c) => !c.pass)
									.map((c) => (
										<li key={c.id} className="text-error">
											{c.label}
											<span className="text-muted text-xs">
												{" "}
												— 请修复后端环境变量后重试
											</span>
										</li>
									))}
							</ul>
						</div>
					)}

					<div
						className="banner-info"
						data-zone="operator-only"
						style={{ marginTop: "var(--space-md)" }}
					>
						<strong>🔴 仅人工可验证(非失败,请自检)</strong>
						<ul style={{ margin: "var(--space-sm) 0 0", paddingLeft: 18 }}>
							{preflight.residuals.map((r) => (
								<li key={r.id}>{r.label}</li>
							))}
						</ul>
					</div>
				</>
			)}
			<div style={{ marginTop: "var(--space-lg)" }}>
				<button type="button" className="btn btn-primary" onClick={onNext}>
					下一步:排演
				</button>
			</div>
		</section>
	);
}
