import type { PublishResult, SafetyMode } from "@51publisher/shared";

// 发布派发编排(background 侧逻辑,效果全注入,便于单测)。
// 安全脊柱:
//   - 只有 mode==='authorized' 且 host 命中(gate.allowed)才发"准许";
//   - 副作用前 **await** 写盘 publish-dispatched 成功,**再**发准许(崩溃幂等);
//   - off / dry-run / host 不符:绝不发准许、绝不写 dispatched。
// host 由调用方(background)从 chrome.tabs.get(tabId).url 取,绝不接受消息携带的 host。

/** 阻断类判决原因(供诊断/呈现;区分 off / 未授权 host / tab 取不到 url)。 */
export type GateBlockReason = "off" | "not-authorized" | "host-unreachable";
/** 闸门判决的可读原因。 */
export type GateReason = "authorized" | "dry-run" | GateBlockReason;

export interface GateDecision {
	mode: SafetyMode;
	/** canSubmit 结果:仅 authorized + host 命中名单为真。 */
	allowed: boolean;
	host: string | null;
	/**
	 * 可读判决原因(诊断/呈现用)。省略时 orchestratePublish 阻断回退历史值 "blocked"。
	 * 生产路径(evaluateGate)恒填具体值;仅部分测试 mock 省略。
	 */
	reason?: GateReason;
}

/** (mode, host, allowed) → 可读判决原因。纯函数,供 evaluateGate 与单测复用。 */
export function gateReason(
	mode: SafetyMode,
	host: string | null,
	allowed: boolean,
): GateReason {
	if (mode === "off") return "off";
	if (mode === "dry-run") return "dry-run";
	if (host == null) return "host-unreachable";
	return allowed ? "authorized" : "not-authorized";
}

/** orchestratePublish 阻断时 error 的取值集合(含历史回退值 "blocked")。 */
const GATE_BLOCK_ERRORS = new Set<string>([
	"off",
	"not-authorized",
	"host-unreachable",
	"blocked",
]);

/** result.error 是否为闸门阻断(供批量循环判断是否暂停)。 */
export function isGateBlocked(error: string | undefined): boolean {
	return error != null && GATE_BLOCK_ERRORS.has(error);
}

export interface OrchestratorDeps {
	evaluateGate: () => Promise<GateDecision>;
	/** 是否已有一笔在途(publish-dispatched 无回执)。真 → 拒绝重入,绝不二次发准许。 */
	isAlreadyDispatched: () => Promise<boolean>;
	/** 写 publish-dispatched(副作用前的无密标记);await 成功才继续。 */
	writeDispatched: () => Promise<void>;
	/** 发一次性准许到 content,返回 content 的执行结果。 */
	sendGrant: () => Promise<PublishResult>;
	/** 记录 grant 后的最终结果(publish-confirmed / 失败结果)。 */
	writeConfirmed: (result: PublishResult) => Promise<void>;
	/**
	 * 首飞互锁:grant 前最后一道闸(Unit 5)。**在 writeDispatched 之后、sendGrant 之前**求值,
	 * 重读标记 close 「APPROVE_BATCH 在标记写入前已过 evaluateGate」的 TOCTOU。
	 * allowed=false → 绝不 sendGrant,返回 first-flight-locked。省略=不启用(无标记零行为变更)。
	 */
	preGrantGuard?: () => Promise<{ allowed: boolean }>;
}

export async function orchestratePublish(
	deps: OrchestratorDeps,
): Promise<PublishResult> {
	const gate = await deps.evaluateGate();

	// dry-run:走完判定但不发准许,只报告"将发布"。
	if (gate.mode === "dry-run") {
		return { ok: true, dryRun: true };
	}

	// off,或 authorized 但 host 不符/不可达 → 阻断,不发准许、不写 dispatched。
	// error 带可读 reason(off / not-authorized / host-unreachable),省略时回退 "blocked"。
	if (!gate.allowed) {
		return { ok: false, dryRun: false, error: gate.reason ?? "blocked" };
	}

	// 重入守卫:已有在途 dispatched(双击/并发/SW 重放)→ 拒绝,绝不二次发准许致重复发布。
	// 完整崩溃恢复(dispatched→needs-human-verification 隔离)在 U4。
	if (await deps.isAlreadyDispatched()) {
		return { ok: false, dryRun: false, error: "already-publishing" };
	}

	// authorized + host 命中:先 await 写盘 dispatched,再发准许(幂等顺序)。
	await deps.writeDispatched();
	// 首飞互锁:grant 前最后一道闸,重读标记(close 标记写入前已过 evaluateGate 的 TOCTOU)。
	// 不通过 → 绝不 sendGrant;dispatched 标记已写,交由 U4 崩溃恢复/看门狗/reset 收尾。
	if (deps.preGrantGuard) {
		const verdict = await deps.preGrantGuard();
		if (!verdict.allowed) {
			const blocked: PublishResult = {
				ok: false,
				dryRun: false,
				error: "first-flight-locked",
			};
			await deps.writeConfirmed(blocked);
			return blocked;
		}
	}
	const result = await deps.sendGrant();
	await deps.writeConfirmed(result);
	return result;
}
