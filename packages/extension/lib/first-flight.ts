import type { ContentDraft } from "@51publisher/shared";
import type { FirstFlightPending } from "./storage";

// 首飞互锁的纯逻辑(无 chrome/#imports/副作用,便于单测)。
// 安全脊柱:首飞期间(pending 标记在场)只允许「与标记完全同一笔意图」的 fill + grant 通过;
// 任何字段不符或 in-memory nonce 不符即 BLOCK。背景接线(读标记、调用 hash、比对)在 background.ts。

/**
 * ContentDraft 的确定性规范序列化(稳定字段序 + tags 原序),供 SHA-256 复算。
 * 只纳入「实际派发到 content 的 draft 字节」语义相关字段;无视对象键的运行时插入顺序。
 */
export function canonicalizeDraft(draft: ContentDraft): string {
	return JSON.stringify([
		draft.id,
		draft.title,
		draft.subtitle,
		draft.category,
		draft.coverImageUrl,
		draft.body,
		draft.tags,
		draft.description,
		draft.postStatus,
		draft.publishedAt,
		draft.mediaId,
	]);
}

/** SHA-256 十六进制摘要(crypto.subtle;SW/测试环境均可用)。 */
export async function sha256Hex(input: string): Promise<string> {
	const bytes = new TextEncoder().encode(input);
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return Array.from(new Uint8Array(digest))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

/** draft 的内容哈希(canonicalize → SHA-256)。 */
export function hashDraft(draft: ContentDraft): Promise<string> {
	return sha256Hex(canonicalizeDraft(draft));
}

/** 一笔发布意图的身份(由批量循环 / 单发路径在派发点提供)。 */
export interface DispatchCtx {
	itemId: string;
	tabId: number;
	host: string;
	/** 实际派发到 content 的 draft(sendFill 发的同一份)。 */
	draft: ContentDraft;
}

/** 互锁判决。allowed=false 时 reason 可读;needReset 表示该路径应触发强制 reset。 */
export interface InterlockVerdict {
	allowed: boolean;
	reason?: string;
	/** true → 调用方应强制 revert(坏标记 / 内容不符 / nonce 不符等可疑信号)。 */
	needReset?: boolean;
}

/**
 * 首飞互锁核心判定(纯函数;hash 已由调用方算好传入)。
 *
 * - 无 pending 标记(null)→ allowed=true(走正常 canSubmit 路径,不归本互锁管)。
 * - 有 pending → 仅当 itemId/tabId/host/contentHash 全等且 liveNonce===pending.nonce 才放行。
 *   任一不符 → BLOCK;其中 host/contentHash/nonce 不符视为可疑信号 needReset=true。
 *
 * host 必须等于「标记 host」(R6 同站约束),不是「任一授权 host」。
 */
export function evaluateInterlock(args: {
	pending: FirstFlightPending | null;
	liveNonce: string | null;
	dispatch: DispatchCtx;
	dispatchHash: string;
}): InterlockVerdict {
	const { pending, liveNonce, dispatch, dispatchHash } = args;
	if (pending === null) return { allowed: true };

	if (dispatch.itemId !== pending.itemId)
		return { allowed: false, reason: "first-flight-itemid-mismatch" };
	if (dispatch.tabId !== pending.tabId)
		return { allowed: false, reason: "first-flight-tabid-mismatch" };
	if (dispatch.host !== pending.host)
		return {
			allowed: false,
			reason: "first-flight-host-mismatch",
			needReset: true,
		};
	if (dispatchHash !== pending.contentHash)
		return {
			allowed: false,
			reason: "first-flight-content-mismatch",
			needReset: true,
		};
	if (liveNonce === null || liveNonce !== pending.nonce)
		return {
			allowed: false,
			reason: "first-flight-nonce-mismatch",
			needReset: true,
		};

	return { allowed: true };
}
