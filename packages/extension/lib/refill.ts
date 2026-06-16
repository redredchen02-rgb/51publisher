// 事实补全后的重组装核心（re-assembly）。
//
// 目的：操作者补齐缺失的 fact 槽位（作品名/集数/漢化/無修/…）后，
// 用既有的模型槽位（item.slots）+ 合并后的 facts 重跑纯函数 assembleDraft，
// 重新生成 draft 与 assembledDraftSnapshot（两者必须一致）。
//
// 不变量：
//   - 快照只由 assembleDraft 写出（防洗稿）；本模块绝不手搓 HTML。
//   - 含 URL 的操作者事实（漢化/無修/简介）须先过严格白名单（R8）才接受注入，
//     否则整体拒绝（不注入），由调用方提示重生成或修正。
//   - item.slots 缺省 → 拒绝（旧条目无法重组装，调用方路由到重新生成）。
//
// 纯函数、无副作用、不碰 chrome/DOM。

import type { BatchItem } from "@51publisher/shared";
import {
	type AssembledDraft,
	assembleDraft,
	type ContentDraft,
	type DraftSlots,
	type FactsBlock,
	toDraft,
} from "@51publisher/shared";

/** 重组装成功结果：draft 与 snapshot 为同一对象内容（不分叉）。 */
export interface ReassembleOk {
	ok: true;
	draft: ContentDraft;
	snapshot: ContentDraft;
	facts: FactsBlock;
}

/** 拒绝结果：缺 slots（需重新生成）或操作者 URL 不合法（需修正）。 */
export interface ReassembleRefusal {
	ok: false;
	reason: "no-slots" | "invalid-url";
	/** invalid-url 时给出具体被拒字段，便于 UI 标错。 */
	field?: string;
	message: string;
}

export type ReassembleResult = ReassembleOk | ReassembleRefusal;

/** 含 URL 的事实字段（仅这些字段的操作者输入需过 URL 白名单）。 */
const URL_FACT_FIELDS: (keyof FactsBlock)[] = ["漢化", "無修", "简介"];

const MAX_URL_LEN = 2048;

/** 内网/回环/链路本地主机段（fail-closed：命中即拒）。 */
function isInternalHost(host: string): boolean {
	const h = host.toLowerCase();
	if (h === "localhost" || h === "::1") return true;
	if (h.endsWith(".local")) return true;
	if (/^127\./.test(h)) return true;
	if (/^10\./.test(h)) return true;
	if (/^192\.168\./.test(h)) return true;
	if (/^169\.254\./.test(h)) return true;
	// 172.16.0.0 – 172.31.255.255
	if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
	return false;
}

/**
 * 校验一个操作者提供的 URL 字符串（用 URL() 解析，非正则）。
 * 仅接受：https、无内嵌凭证（user:pass@）、非内网/回环主机、非明显 IDN 混淆、长度受限。
 * 通过返回 null；不通过返回拒因。
 */
function validateOperatorUrl(raw: string): string | null {
	if (raw.length > MAX_URL_LEN) return "URL 超长";
	let u: URL;
	try {
		u = new URL(raw);
	} catch {
		return "URL 无法解析";
	}
	if (u.protocol !== "https:") return "仅接受 https 连结";
	if (u.username !== "" || u.password !== "") return "连结不得内嵌凭证";
	if (isInternalHost(u.hostname)) return "连结指向内网/回环地址";
	// 明显的 IDN 混淆：punycode（xn--）或主机含非 ASCII 字符。
	// 用 codePoint 检测代替控制字符正则（biome 禁用控制字符范围）。
	const hasNonAscii = [...u.hostname].some((ch) => ch.charCodeAt(0) > 127);
	if (u.hostname.includes("xn--") || hasNonAscii)
		return "连结主机疑似 IDN 混淆";
	return null;
}

/**
 * 抽出字段里的 URL 片段（与 shared/factUrls 同规则：https?://...，遇空白/竖线止）。
 * 仅用于「操作者是否塞了 URL」的判定与校验；真正注入仍由 assembleDraft 处理。
 */
function extractUrls(value: string): string[] {
	const m = value.match(/https?:\/\/[^\s|]+/gi);
	return m ?? [];
}

/**
 * 合并操作者事实并重组装。
 * @param item 须含 slots（旧条目缺省则拒绝）；draft 提供 category/tags/coverImageUrl。
 * @param operatorFacts 操作者补的事实（覆盖 item.facts 同名键）。
 * @param now 时间戳（注入为可参数，保持纯函数可测/确定）。默认沿用原 draft.createdAt。
 */
export function reassembleWithFacts(
	item: BatchItem,
	operatorFacts: FactsBlock,
	now?: string,
): ReassembleResult {
	if (!item.slots) {
		return {
			ok: false,
			reason: "no-slots",
			message: "该条目缺少模型槽位（旧条目），无法重组装，请重新生成。",
		};
	}

	// 先校验操作者提供的含 URL 字段（只校验操作者新输入的值，逐字段）。
	for (const field of URL_FACT_FIELDS) {
		const value = operatorFacts[field]?.trim();
		if (!value) continue;
		for (const url of extractUrls(value)) {
			const bad = validateOperatorUrl(url);
			if (bad) {
				return {
					ok: false,
					reason: "invalid-url",
					field,
					message: `${field} 的连结被拒：${bad}`,
				};
			}
		}
	}

	const mergedFacts: FactsBlock = { ...item.facts, ...operatorFacts };

	const slots: DraftSlots = item.slots;
	const assembled: AssembledDraft = assembleDraft(slots, mergedFacts);

	// toDraft 硬编码 coverImageUrl:""，故重组后单独保留原封面（镜像 batch-orchestrator.ts:255）。
	const base = toDraft(
		assembled,
		item.draft?.category ?? "",
		item.draft?.tags ?? [],
		item.id,
		now ?? item.draft?.createdAt ?? "",
	);
	const newDraft: ContentDraft = {
		...base,
		coverImageUrl: item.draft?.coverImageUrl ?? "",
	};

	// draft 与 snapshot 内容一致（不分叉）。
	return {
		ok: true,
		draft: newDraft,
		snapshot: newDraft,
		facts: mergedFacts,
	};
}
