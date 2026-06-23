import type React from "react";
import { lastLabel } from "./types";

interface Props {
	host: string;
	gesture: string;
	setGesture: (g: string) => void;
	gestureOk: boolean;
	warningRef: React.RefObject<HTMLDivElement | null>;
	onRun: () => void;
	onBack: () => void;
}

export function StepConfirm({
	host,
	gesture,
	setGesture,
	gestureOk,
	warningRef,
	onRun,
	onBack,
}: Props) {
	return (
		<section aria-label="确认真实站点">
			<div className="banner-error" role="alert" tabIndex={-1} ref={warningRef}>
				⚠️ 下一步将进入<strong>真实授权发布窗口</strong>,发布到真实站点的动作
				<strong>不可撤销</strong>。 请确认你正停在正确的后台页。
			</div>
			<div style={{ marginTop: "var(--space-md)" }}>
				<div className="pipeline-step-label">真实目标站点(来自当前标签页)</div>
				<div className="pipeline-step-value" data-testid="real-host">
					{host}
				</div>
			</div>
			<label
				style={{ display: "block", marginTop: "var(--space-md)" }}
				htmlFor="ff-gesture"
			>
				<span className="text-secondary">
					防误点:请手动输入站点主标签「{lastLabel(host)}」以确认
				</span>
				<input
					id="ff-gesture"
					className="field-input"
					value={gesture}
					onChange={(e) => setGesture(e.target.value)}
					autoComplete="off"
					style={{ marginTop: 4 }}
				/>
			</label>
			<div style={{ marginTop: "var(--space-lg)", display: "flex", gap: 8 }}>
				<button
					type="button"
					className="btn btn-primary"
					onClick={onRun}
					disabled={!gestureOk}
					aria-disabled={!gestureOk}
				>
					解锁并发布恰好一条
				</button>
				<button type="button" className="btn btn-plain" onClick={onBack}>
					上一步
				</button>
			</div>
		</section>
	);
}
