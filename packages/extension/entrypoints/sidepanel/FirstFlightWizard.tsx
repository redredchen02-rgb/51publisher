import { useFirstFlightWizard } from "./hooks/useFirstFlightWizard";
import { StepConfirm } from "./firstflight/StepConfirm";
import { StepPreflight } from "./firstflight/StepPreflight";
import { StepRehearse } from "./firstflight/StepRehearse";
import { StepResult } from "./firstflight/StepResult";

// 首飞向导(Unit 7):线性五步,把「证明闸门时序」拆成操作者可逐步确认的流程。
// 安全脊柱(UI 侧零旁路):
//   - 真实 host 来自目标 tab(经背景 chrome.tabs.get),绝不取自消息或本组件输入框。
//   - 防误点:确认按钮非默认聚焦、无回车直发;进入③初始焦点落在警告/host,不在确认按钮。
//   - 强制排演:②未绿(dry-run + grounding)前禁止前进。
//   - 背景强制 reset 再入:订阅状态,authorized→dry-run 非自身触发的翻转 → 退回①/②。
//   - 失败/重置只回到①/②重新排演(R5),绝无常驻直发入口;⑤失败仅给「重新排演并重试」。

export interface FirstFlightWizardProps {
	/** 目标后台 tab id(由调用方从 chrome.tabs 解析,绝不在本组件查 active)。 */
	tabId: number;
	/** 目标 host(仅用于③展示与防误点手势比对;真实授权 host 仍由背景从 tab 取)。 */
	host: string;
	/** 待首飞的批次条目 id。 */
	itemId: string;
	onBack: () => void;
}

export function FirstFlightWizard({ tabId, host, itemId, onBack }: FirstFlightWizardProps) {
	const wiz = useFirstFlightWizard(tabId, itemId, host);

	return (
		<main className="glass-panel fade-in" style={{ padding: "var(--space-xl)", margin: "12px auto", maxWidth: 480 }}>
			<header className="flex-between" style={{ marginBottom: "var(--space-lg)" }}>
				<h1 style={{ fontSize: "var(--font-xl)", margin: 0 }}>首飞向导</h1>
				<button type="button" onClick={onBack} className="btn btn-plain btn-sm">返回</button>
			</header>

			<ol className="pipeline-strip" aria-label="首飞步骤">
				{[1, 2, 3, 4, 5].map((n) => (
					<li
						key={n}
						className={`pipeline-step ${wiz.step === n ? "active" : ""} ${wiz.step > n ? "done" : ""}`}
						aria-current={wiz.step === n ? "step" : undefined}
					>
						<span className="pipeline-step-label">步骤 {n}</span>
						<span className="pipeline-step-value">
							{["自检", "排演", "确认", "解锁", "结果"][n - 1]}
						</span>
					</li>
				))}
			</ol>

			{wiz.resetNotice && (
				<div className="banner-error" role="alert" aria-live="assertive">
					⚠️ {wiz.resetNotice}。已退回排演步骤,请重新排演。
				</div>
			)}

			{wiz.step === 1 && (
				<StepPreflight
					preflight={wiz.preflight}
					preflightError={wiz.preflightError}
					onNext={() => wiz.setStep(2)}
				/>
			)}

			{wiz.step === 2 && (
				<StepRehearse
					rehearsing={wiz.rehearsing}
					rehearsal={wiz.rehearsal}
					canForwardFrom2={wiz.canForwardFrom2}
					onRehearse={() => void wiz.handleRehearse()}
					onNext={() => wiz.setStep(3)}
					onBack={() => wiz.setStep(1)}
				/>
			)}

			{wiz.step === 3 && (
				<StepConfirm
					host={host}
					gesture={wiz.gesture}
					setGesture={wiz.setGesture}
					gestureOk={wiz.gestureOk}
					warningRef={wiz.warningRef}
					onRun={() => void wiz.handleRun()}
					onBack={() => wiz.setStep(2)}
				/>
			)}

			{wiz.step === 4 && (
				<section aria-label="解锁中">
					<div className="banner-warning" role="status" aria-live="assertive">
						⏳ 正在最小授权窗口内发布恰好一条,请<strong>不要关闭面板</strong>。
						若超过看门狗时限,系统会强制回落 dry-run。
					</div>
					<div aria-busy={wiz.dispatching} className="text-secondary" style={{ marginTop: 8 }}>
						派发进行中…
					</div>
				</section>
			)}

			{wiz.step === 5 && wiz.runResult && (
				<StepResult
					runResult={wiz.runResult}
					onReRehearse={wiz.reRehearse}
					onBack={onBack}
				/>
			)}
		</main>
	);
}
