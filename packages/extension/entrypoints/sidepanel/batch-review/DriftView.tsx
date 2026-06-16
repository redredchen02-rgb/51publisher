import type { DriftReport } from "../../../lib/selectors";
import { box, btn } from "./constants";

interface Props {
	driftResult: DriftReport;
	busy?: boolean;
	onDriftCheck: () => void;
	onApproveBypass: () => void;
}

export function DriftView({
	driftResult,
	busy,
	onDriftCheck,
	onApproveBypass,
}: Props) {
	return (
		<div
			style={{
				...box,
				marginTop: 8,
				background: driftResult.ok
					? "var(--color-success-light)"
					: "var(--color-warning-light)",
				border: `1px solid ${driftResult.ok ? "var(--color-success-border)" : "var(--color-warning-border)"}`,
			}}
		>
			{driftResult.ok ? (
				"✅ 选择器自检通过"
			) : (
				<>
					<div>⚠️ 缺失:{driftResult.missing.join("、")}</div>
					<div
						style={{
							fontSize: 12,
							color: "var(--color-warning-deep)",
							marginTop: 2,
						}}
					>
						请在目标页确认表单已载入,或刷新页面后操作。
					</div>
					<div className="flex" style={{ gap: 6, marginTop: 6 }}>
						<button
							type="button"
							onClick={onDriftCheck}
							disabled={busy}
							style={{
								...btn,
								padding: "3px 8px",
								fontSize: 12,
								background: "var(--color-warning)",
								color: "#fff",
							}}
						>
							重新自检
						</button>
						<button
							type="button"
							onClick={onApproveBypass}
							disabled={busy}
							style={{
								...btn,
								padding: "3px 8px",
								fontSize: 12,
								background: "var(--color-border-lighter)",
								color: "var(--color-text)",
							}}
						>
							跳过检查继续批准
						</button>
					</div>
				</>
			)}
		</div>
	);
}
