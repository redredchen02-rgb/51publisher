import type {
	FirstFlightRehearseResult,
	FirstFlightRunResult,
} from "@51publisher/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "../../lib/api-fetch";
import {
	firstFlightRehearse,
	firstFlightRun,
	firstFlightStatus,
} from "../../lib/messaging";

// 首飞向导(Unit 7):线性五步,把「证明闸门时序」拆成操作者可逐步确认的流程。
// 安全脊柱(UI 侧零旁路):
//   - 真实 host 来自目标 tab(经背景 chrome.tabs.get),绝不取自消息或本组件输入框。
//   - 防误点:确认按钮非默认聚焦、无回车直发;进入③初始焦点落在警告/host,不在确认按钮。
//   - 强制排演:②未绿(dry-run + grounding)前禁止前进。
//   - 背景强制 reset 再入:订阅状态,authorized→dry-run 非自身触发的翻转 → 退回①/②。
//   - 失败/重置只回到①/②重新排演(R5),绝无常驻直发入口;⑤失败仅给「重新排演并重试」。

type Step = 1 | 2 | 3 | 4 | 5;

interface PreflightCheck {
	id: string;
	label: string;
	pass: boolean;
}
interface PreflightResidual {
	id: string;
	label: string;
}
interface PreflightResponse {
	ok: boolean;
	checks: PreflightCheck[];
	residuals: PreflightResidual[];
}

export interface FirstFlightWizardProps {
	/** 目标后台 tab id(由调用方从 chrome.tabs 解析,绝不在本组件查 active)。 */
	tabId: number;
	/** 目标 host(仅用于③展示与防误点手势比对;真实授权 host 仍由背景从 tab 取)。 */
	host: string;
	/** 待首飞的批次条目 id。 */
	itemId: string;
	onBack: () => void;
}

/** 取 host 的最后一段标签(防误点手势:要求操作者手输它)。 */
function lastLabel(host: string): string {
	const parts = host.split(".").filter(Boolean);
	return parts.length >= 2
		? (parts[parts.length - 2] ?? host)
		: (parts[0] ?? host);
}

export function FirstFlightWizard({
	tabId,
	host,
	itemId,
	onBack,
}: FirstFlightWizardProps) {
	const [step, setStep] = useState<Step>(1);
	const [preflight, setPreflight] = useState<PreflightResponse | null>(null);
	const [preflightError, setPreflightError] = useState<string | null>(null);

	const [rehearsing, setRehearsing] = useState(false);
	const [rehearsal, setRehearsal] = useState<FirstFlightRehearseResult | null>(
		null,
	);

	const [gesture, setGesture] = useState("");
	const [dispatching, setDispatching] = useState(false);
	const [runResult, setRunResult] = useState<FirstFlightRunResult | null>(null);
	const [resetNotice, setResetNotice] = useState<string | null>(null);

	const warningRef = useRef<HTMLDivElement>(null);
	// 记录是否处于「自身触发的 authorized 窗口」内,以区分背景强制 reset(非自身翻转)。
	const selfArmingRef = useRef(false);

	// ① 拉取 preflight 自检结论。
	useEffect(() => {
		let alive = true;
		void (async () => {
			try {
				const res = await apiFetch("/api/v1/preflight");
				if (!res.ok) {
					if (alive) setPreflightError(`preflight 自检不可达 (${res.status})`);
					return;
				}
				const data = (await res.json()) as PreflightResponse;
				if (alive) setPreflight(data);
			} catch {
				if (alive) setPreflightError("无法连接后端自检接口");
			}
		})();
		return () => {
			alive = false;
		};
	}, []);

	// 订阅首飞状态:轮询侦测背景强制 reset(authorized→dry-run 非自身触发)。
	useEffect(() => {
		let alive = true;
		const tick = async () => {
			try {
				const s = await firstFlightStatus();
				if (!alive) return;
				// 坏值标记 或 在我们不在派发中却发现 armed 残留被清:都按强制 reset 处理。
				if (s.bad) {
					setResetNotice("首飞授权被强制重置(检测到异常标记)");
					setStep((cur) => (cur > 2 ? 1 : cur));
				}
			} catch {
				/* 状态读失败忽略,下次再试 */
			}
		};
		const id = setInterval(() => void tick(), 1500);
		return () => {
			alive = false;
			clearInterval(id);
		};
	}, []);

	const handleRehearse = useCallback(async () => {
		setRehearsing(true);
		setRehearsal(null);
		try {
			const res = await firstFlightRehearse(tabId, itemId);
			setRehearsal(res);
		} catch {
			setRehearsal({
				ok: false,
				dryRunGreen: false,
				groundingOk: false,
				reasons: [],
				error: "排演失败,请重试",
			});
		} finally {
			setRehearsing(false);
		}
	}, [tabId, itemId]);

	// 进入③时把焦点放在警告(而非确认按钮),避免回车直发。
	useEffect(() => {
		if (step === 3) warningRef.current?.focus();
	}, [step]);

	const gestureOk = gesture.trim() === lastLabel(host);

	const handleRun = useCallback(async () => {
		if (!gestureOk) return;
		setDispatching(true);
		setStep(4);
		selfArmingRef.current = true;
		try {
			const res = await firstFlightRun(tabId, itemId);
			setRunResult(res);
			setStep(5);
		} catch {
			setRunResult({
				ok: false,
				phase: "arm",
				reverted: true,
				error: "执行失败,请重新排演并重试",
			});
			setStep(5);
		} finally {
			selfArmingRef.current = false;
			setDispatching(false);
		}
	}, [gestureOk, tabId, itemId]);

	// 重新排演并重试:回到②(R5,绝不直接重发)。
	const reRehearse = useCallback(() => {
		setRunResult(null);
		setRehearsal(null);
		setGesture("");
		setStep(2);
	}, []);

	const canForwardFrom2 = rehearsal?.ok === true;

	return (
		<main
			className="glass-panel fade-in"
			style={{ padding: "var(--space-xl)", margin: "12px auto", maxWidth: 480 }}
		>
			<header
				className="flex-between"
				style={{ marginBottom: "var(--space-lg)" }}
			>
				<h1 style={{ fontSize: "var(--font-xl)", margin: 0 }}>首飞向导</h1>
				<button type="button" onClick={onBack} className="btn btn-plain btn-sm">
					返回
				</button>
			</header>

			{/* 步进条 */}
			<ol className="pipeline-strip" aria-label="首飞步骤">
				{[1, 2, 3, 4, 5].map((n) => (
					<li
						key={n}
						className={`pipeline-step ${step === n ? "active" : ""} ${step > n ? "done" : ""}`}
						aria-current={step === n ? "step" : undefined}
					>
						<span className="pipeline-step-label">步骤 {n}</span>
						<span className="pipeline-step-value">
							{["自检", "排演", "确认", "解锁", "结果"][n - 1]}
						</span>
					</li>
				))}
			</ol>

			{/* 背景强制 reset 公告 */}
			{resetNotice && (
				<div className="banner-error" role="alert" aria-live="assertive">
					⚠️ {resetNotice}。已退回排演步骤,请重新排演。
				</div>
			)}

			{/* ① preflight 结论条:三区 IA */}
			{step === 1 && (
				<section aria-label="preflight 自检结论">
					{preflightError && (
						<div className="banner-error" role="alert">
							{preflightError}
						</div>
					)}
					{preflight && (
						<>
							{/* 总体结论 + 计数 */}
							<div
								className={preflight.ok ? "banner-info" : "banner-error"}
								role="status"
							>
								总体:{preflight.ok ? "🟢 自检通过" : "🟢 自检未通过"} (
								{preflight.checks.filter((c) => c.pass).length}/
								{preflight.checks.length} 项通过)
							</div>

							{/* 自检失败区(红):代码能验证、但当前没过 */}
							{preflight.checks.some((c) => !c.pass) && (
								<div
									className="banner-error"
									data-zone="self-check-failed"
									style={{ marginTop: "var(--space-md)" }}
								>
									<strong className="text-error">🟢 自检未通过项</strong>
									<ul
										style={{ margin: "var(--space-sm) 0 0", paddingLeft: 18 }}
									>
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

							{/* 操作者专属区(中性/info 色):代码无法替你验证的清单,不是失败 */}
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
						<button
							type="button"
							className="btn btn-primary"
							onClick={() => setStep(2)}
						>
							下一步:排演
						</button>
					</div>
				</section>
			)}

			{/* ② 强制排演 */}
			{step === 2 && (
				<section aria-label="排演">
					<p className="text-secondary">
						排演会在 dry-run
						档跑一遍填充并核对接地(grounding),全绿才能继续。绝不真发。
					</p>
					<button
						type="button"
						className="btn btn-primary"
						onClick={() => void handleRehearse()}
						disabled={rehearsing}
						aria-disabled={rehearsing}
					>
						{rehearsing ? "排演中…" : "开始排演"}
					</button>
					{rehearsing && (
						<div
							aria-live="polite"
							className="text-secondary"
							style={{ marginTop: 8 }}
						>
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
									排演未通过
									{rehearsal.error ? `:${rehearsal.error}` : ""}
									{rehearsal.reasons.length > 0 && (
										<ul
											style={{ margin: "var(--space-sm) 0 0", paddingLeft: 18 }}
										>
											{rehearsal.reasons.map((r) => (
												<li key={r}>{r}</li>
											))}
										</ul>
									)}
								</div>
							)}
						</div>
					)}
					<div
						style={{ marginTop: "var(--space-lg)", display: "flex", gap: 8 }}
					>
						<button
							type="button"
							className="btn btn-primary"
							onClick={() => setStep(3)}
							disabled={!canForwardFrom2}
							aria-disabled={!canForwardFrom2}
						>
							下一步:确认真实站点
						</button>
						<button
							type="button"
							className="btn btn-plain"
							onClick={() => setStep(1)}
						>
							上一步
						</button>
					</div>
				</section>
			)}

			{/* ③ 真实 host + 不可逆警告 + 防误点手势 */}
			{step === 3 && (
				<section aria-label="确认真实站点">
					<div
						className="banner-error"
						role="alert"
						tabIndex={-1}
						ref={warningRef}
					>
						⚠️ 下一步将进入<strong>真实授权发布窗口</strong>,发布到真实站点的动作
						<strong>不可撤销</strong>。 请确认你正停在正确的后台页。
					</div>
					<div style={{ marginTop: "var(--space-md)" }}>
						<div className="pipeline-step-label">
							真实目标站点(来自当前标签页)
						</div>
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
					<div
						style={{ marginTop: "var(--space-lg)", display: "flex", gap: 8 }}
					>
						{/* 确认按钮:非默认聚焦,disabled 直到手势匹配;无 type=submit、无回车直发 */}
						<button
							type="button"
							className="btn btn-primary"
							onClick={() => void handleRun()}
							disabled={!gestureOk}
							aria-disabled={!gestureOk}
						>
							解锁并发布恰好一条
						</button>
						<button
							type="button"
							className="btn btn-plain"
							onClick={() => setStep(2)}
						>
							上一步
						</button>
					</div>
				</section>
			)}

			{/* ④ 解锁中(in-flight):锁面板,提示勿关闭 */}
			{step === 4 && (
				<section aria-label="解锁中">
					<div className="banner-warning" role="status" aria-live="assertive">
						⏳ 正在最小授权窗口内发布恰好一条,请<strong>不要关闭面板</strong>。
						若超过看门狗时限,系统会强制回落 dry-run。
					</div>
					<div
						aria-busy={dispatching}
						className="text-secondary"
						style={{ marginTop: 8 }}
					>
						派发进行中…
					</div>
				</section>
			)}

			{/* ⑤ 结果 + 验证提示(已 revert 回 dry-run) */}
			{step === 5 && runResult && (
				<section aria-label="结果" aria-live="polite">
					{runResult.ok && runResult.phase === "dispatched" ? (
						<>
							<div className="banner-info" role="status">
								✅ 已派发恰好一条(条目终态:{runResult.itemStatus ?? "未知"})。
								{runResult.reverted && " 授权已回落 dry-run、标记已清。"}
							</div>
							<div
								className="banner-warning"
								role="note"
								style={{ marginTop: "var(--space-md)" }}
							>
								🔴
								请到真实站点核实帖子是否真的落地(URL/内容)——首飞只证明闸门时序正确,
								<strong>不</strong>代表发布一定成功。
								{runResult.publishUrl && (
									<div style={{ marginTop: 4 }}>
										回执 URL(请人工核实):<code>{runResult.publishUrl}</code>
									</div>
								)}
							</div>
						</>
					) : (
						<div className="banner-error" role="alert">
							首飞未完成({runResult.phase} 阶段
							{runResult.reason ? `:${runResult.reason}` : ""}
							{runResult.error ? `:${runResult.error}` : ""})。
							{runResult.reverted && " 授权已回落 dry-run。"}
						</div>
					)}
					<div
						style={{ marginTop: "var(--space-lg)", display: "flex", gap: 8 }}
					>
						<button
							type="button"
							className="btn btn-primary"
							onClick={reRehearse}
						>
							重新排演并重试
						</button>
						<button type="button" className="btn btn-plain" onClick={onBack}>
							完成,返回
						</button>
					</div>
				</section>
			)}
		</main>
	);
}
