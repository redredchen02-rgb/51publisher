// 首飞授权状态机(PR-B Unit 4 核心,纯逻辑 + 依赖注入,可单测)。
//
// 安全模型:
// - 持久 pending 标记(`local:firstFlightPending`)+ 持久 mode(`local:safetyMode`)是**分离键**,
//   超集不变量「mode=authorized ⟹ pending 在场」由本模块的**严格排序**维持:
//     arm:    写 pending → 读回确认 → 翻 authorized(authorized 时标记必已在场)
//     revert: 降 dry-run → 清 pending(降档在先,绝不留 authorized+无标记)
//   故持久态只可能是 {dry-run,无}/{dry-run,有}/{authorized,有},永不 {authorized,无}。
// - **内存活动 nonce** 不持久,随 SW 回收消失。interlock(U5)额外要求 pending.nonce == 活动 nonce:
//   SW 回收后活动 nonce=null → 任何残留 pending 必不匹配 → block + 启动复位(顺带封纯 storage 层伪造)。
// - **启动复位必须先于任何 publish handler 发 grant**(由 background 门控);残留授权窗口绝不延续过 SW 回收。
// - 连续 N 次强制复位无干净 settle → 回落 off + 需显式重启用。
//
// 并发:arm 全流程由调用方(background)包进 `createSerialQueue` 临界区;本模块的读回确认是
// chrome.storage.local 无 CAS 下的额外防线(并发第二写覆盖即读回不符 → 拒绝 arm)。
import type { SafetyMode } from "@51publisher/shared";
import type { FirstFlightPending } from "./storage";

export const MAX_CONSECUTIVE_RESETS = 2;

export interface FirstFlightDeps {
	getSafetyMode: () => Promise<SafetyMode>;
	setSafetyMode: (mode: SafetyMode) => Promise<void>;
	getPending: () => Promise<{
		pending: FirstFlightPending | null;
		corrupt: boolean;
	}>;
	setPending: (pending: FirstFlightPending) => Promise<void>;
	clearPending: () => Promise<void>;
	getResetCount: () => Promise<number>;
	setResetCount: (n: number) => Promise<void>;
	/** SW 内存活动 nonce 读写(不持久)。 */
	getActiveNonce: () => string | null;
	setActiveNonce: (nonce: string | null) => void;
	/** 当前时间戳。 */
	now: () => string;
	/** 新 nonce(每次 arm 唯一)。 */
	newNonce: () => string;
	/** 安全事件告警(强制复位等)。 */
	onAlert: (message: string) => void;
}

export type ArmResult =
	| { ok: true; nonce: string }
	| { ok: false; reason: string };

/**
 * arm:写 pending → 读回确认 → 设内存 nonce → 翻 authorized。
 * 任一步失败/读回不符 → 拒绝 arm(清理已写 pending,绝不在「authorized 已置、标记缺/不符」下继续)。
 * 已有 pending(或坏标记)→ 拒绝二次 arm(不 stack)。
 * 调用方须在 `createSerialQueue` 临界区内调用本函数。
 */
export async function armFirstFlight(
	deps: FirstFlightDeps,
	params: {
		itemId: string;
		tabId: number;
		host: string;
		contentHash: string;
	},
): Promise<ArmResult> {
	const cur = await deps.getPending();
	if (cur.corrupt || cur.pending) {
		return {
			ok: false,
			reason: "已有进行中的首飞窗口或坏标记,拒绝二次 arm",
		};
	}

	const nonce = deps.newNonce();
	const pending: FirstFlightPending = {
		itemId: params.itemId,
		tabId: params.tabId,
		host: params.host,
		contentHash: params.contentHash,
		nonce,
		ts: deps.now(),
	};
	await deps.setPending(pending);

	// 读回确认(无 CAS:防并发第二写覆盖)。不符即拒绝 + 清理,绝不翻 authorized。
	const back = await deps.getPending();
	if (!back.pending || back.corrupt || back.pending.nonce !== nonce) {
		await deps.clearPending();
		return { ok: false, reason: "pending 写回确认失败,拒绝 arm" };
	}

	deps.setActiveNonce(nonce);
	// 顺序铁律:authorized 必在 pending 落定之后。
	await deps.setSafetyMode("authorized");
	return { ok: true, nonce };
}

/**
 * revert(非对称,干净 settle):降 dry-run → 清 pending → 清内存 nonce → 复位计数归 0。
 * 降档在先保证任一步崩溃都不留 authorized+无标记。
 */
export async function revertFirstFlight(deps: FirstFlightDeps): Promise<void> {
	await deps.setSafetyMode("dry-run");
	await deps.clearPending();
	deps.setActiveNonce(null);
	await deps.setResetCount(0);
}

export interface StartupResetOutcome {
	reset: boolean;
	fellBackToOff: boolean;
}

/**
 * 启动复位:**必须在任何 publish handler 发 grant 之前跑完**(background 门控)。
 * SW 刚重启 → 内存活动 nonce 必为 null。若 pending 在场/corrupt 或 mode=authorized →
 * 强制复位(残留授权窗口绝不延续过 SW 回收)。无残留 → 不动。
 * 连续 N 次强制复位无干净 settle → 回落 off(真 fail-closed)+ 需显式重启用。
 */
export async function runStartupFirstFlightReset(
	deps: FirstFlightDeps,
): Promise<StartupResetOutcome> {
	const { pending, corrupt } = await deps.getPending();
	const mode = await deps.getSafetyMode();
	const needsReset = corrupt || pending !== null || mode === "authorized";
	if (!needsReset) return { reset: false, fellBackToOff: false };

	const count = (await deps.getResetCount()) + 1;
	await deps.setResetCount(count);
	const fellBackToOff = count >= MAX_CONSECUTIVE_RESETS;

	// 降档在先(off 或 dry-run),再清标记 + 内存 nonce。
	await deps.setSafetyMode(fellBackToOff ? "off" : "dry-run");
	await deps.clearPending();
	deps.setActiveNonce(null);
	deps.onAlert(
		fellBackToOff
			? `首飞授权连续 ${count} 次强制复位无干净 settle → 回落 off,需显式重启用(安全事件)`
			: "首飞授权被强制复位(SW 回收 / 坏标记 / 残留 authorized):已降 dry-run + 清标记(安全事件)",
	);
	return { reset: true, fellBackToOff };
}
