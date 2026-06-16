import type { SafetyMode } from "@51publisher/shared";
import { box, MODE_STYLE } from "./constants";

interface Props {
	safetyMode: SafetyMode;
	authorizedHost: string;
	tabHealthy: boolean;
	onModeChange?: (mode: SafetyMode) => void;
	onResume: () => void;
}

export function ModeStatusBar({
	safetyMode,
	authorizedHost,
	tabHealthy,
	onModeChange,
	onResume,
}: Props) {
	const modeStyle = MODE_STYLE[safetyMode];
	return (
		<>
			<div
				style={{
					...box,
					background: modeStyle.bg,
					border: `1px solid ${modeStyle.border}`,
					color: modeStyle.color,
				}}
			>
				<div
					role="status"
					className="flex font-semibold"
					style={{ alignItems: "center", gap: 8 }}
					aria-label={`发布档位 ${safetyMode}`}
				>
					{modeStyle.icon} 档位:
					{onModeChange ? (
						<select
							value={safetyMode}
							onChange={(e) => onModeChange(e.target.value as SafetyMode)}
							style={{
								fontSize: 12,
								padding: "1px 4px",
								border: `1px solid ${modeStyle.border}`,
								borderRadius: 4,
								background: modeStyle.bg,
								color: modeStyle.color,
								cursor: "pointer",
							}}
						>
							<option value="off">⏻ 关闭(只填充)</option>
							<option value="dry-run">🧪 预演(不真发)</option>
							<option value="authorized">🚀 已授权·真发布</option>
						</select>
					) : (
						modeStyle.label
					)}
				</div>
				<div style={{ marginTop: 2 }}>
					授权站点:<code>{authorizedHost || "(未记录)"}</code>
				</div>
				<div style={{ marginTop: 2 }}>
					{tabHealthy ? "✅ 目标标签页正常" : "⚠️ 目标标签页已离开授权站点"}
				</div>
			</div>

			{!tabHealthy && (
				<div
					role="alert"
					style={{
						...box,
						background: "var(--color-warning-light)",
						border: "1px solid var(--color-warning-border)",
						color: "var(--color-warning-deep)",
					}}
				>
					批次已暂停:请切回授权 admin 标签页(<code>{authorizedHost}</code>
					)。在途条目不受影响。
					<div style={{ marginTop: 6 }}>
						<button
							type="button"
							onClick={onResume}
							style={{
								padding: "4px 10px",
								borderRadius: 4,
								border: "none",
								cursor: "pointer",
								background: "var(--color-warning)",
								color: "#fff",
							}}
						>
							我已切回,继续
						</button>
					</div>
				</div>
			)}
		</>
	);
}
