import type { SafetyMode } from "@51publisher/shared";
import { useState } from "react";
import type { BatchPhase, BatchSummary } from "../../../lib/batch";
import { btn } from "./constants";

interface Props {
	phase: BatchPhase;
	summary: BatchSummary;
	safetyMode: SafetyMode;
	authorizedHost: string;
	busy?: boolean;
	canApprove: boolean;
	onApprove: () => void;
	onKill: () => void;
	onDriftCheck: () => void;
}

export function ApprovalBar({
	phase,
	summary,
	safetyMode,
	authorizedHost,
	busy,
	canApprove,
	onApprove,
	onKill,
	onDriftCheck,
}: Props) {
	const [confirming, setConfirming] = useState(false);
	const [typed, setTyped] = useState("");

	const gestureOk =
		safetyMode !== "authorized" || typed.trim().toLowerCase() === "publish";

	function confirmApprove() {
		setConfirming(false);
		setTyped("");
		onApprove();
	}

	return (
		<>
			<div className="flex" style={{ gap: 8, marginTop: 12, flexWrap: "wrap" }}>
				{canApprove && !confirming && (
					<button
						type="button"
						onClick={() => setConfirming(true)}
						style={{
							...btn,
							background:
								safetyMode === "authorized"
									? "var(--color-error)"
									: "var(--color-info)",
							color: "#fff",
						}}
					>
						{safetyMode === "authorized"
							? `批准发布 ${summary.awaitingApproval} 条`
							: `预演 ${summary.awaitingApproval} 条`}
					</button>
				)}
				<button
					type="button"
					onClick={onDriftCheck}
					disabled={busy}
					style={{
						...btn,
						background: "var(--color-border-lighter)",
						color: "var(--color-text)",
					}}
				>
					漂移自检
				</button>
				{phase !== "done" && (
					<button
						type="button"
						onClick={onKill}
						disabled={busy}
						style={{
							...btn,
							background: "var(--color-error-light)",
							color: "var(--color-error)",
							border: "1px solid var(--color-error-border)",
						}}
					>
						急停
					</button>
				)}
			</div>

			{confirming && (
				<div
					role="alertdialog"
					aria-label="发布确认"
					style={{
						padding: 12,
						borderRadius: 6,
						marginTop: 10,
						background: "#fff",
						border: "2px solid var(--color-error)",
					}}
				>
					<div className="font-semibold text-error">
						{safetyMode === "authorized"
							? `确定发布 ${summary.awaitingApproval} 条到 ${authorizedHost}?`
							: `预演发布 ${summary.awaitingApproval} 条(不会真发)?`}
					</div>
					{safetyMode === "authorized" && (
						<div style={{ marginTop: 6 }}>
							<div className="text-sm text-muted">
								防误触:请输入 <code>publish</code> 确认
							</div>
							<input
								aria-label="输入 publish 确认"
								value={typed}
								onChange={(e) => setTyped(e.target.value)}
								style={{
									width: "100%",
									boxSizing: "border-box",
									padding: 5,
									marginTop: 4,
									border: "1px solid var(--color-border)",
									borderRadius: 4,
								}}
							/>
						</div>
					)}
					<div className="flex" style={{ gap: 8, marginTop: 8 }}>
						<button
							type="button"
							onClick={confirmApprove}
							disabled={!gestureOk || !!busy}
							style={{
								...btn,
								background:
									gestureOk && !busy
										? "var(--color-error)"
										: "var(--color-bg-muted)",
								color:
									gestureOk && !busy ? "#fff" : "var(--color-text-disabled)",
							}}
						>
							确认
						</button>
						<button
							type="button"
							onClick={() => {
								setConfirming(false);
								setTyped("");
							}}
							style={{
								...btn,
								background: "var(--color-border-lighter)",
								color: "var(--color-text)",
							}}
						>
							取消
						</button>
					</div>
				</div>
			)}
		</>
	);
}
