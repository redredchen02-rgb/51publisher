// 发布前 grounding 硬闸(U4):authorized 真发前,残留【待补】或无来源连结 → 拦。
// 把审核区的「只展示」升级为「发布前 fail-closed」。仅 authorized 档拦截;off/dry-run 不拦(只供提示)。
//
// 纯函数(verifyLinks 那项需 DOMParser;SW 无 DOM 时该项跳过 —— 组装器已保证连结来源,此为 defense-in-depth)。

import type { ContentDraft, FactsBlock } from "@51publisher/shared";
import { factUrls, PLACEHOLDER } from "@51publisher/shared";
import { hasUnsourcedLink, verifyLinks } from "./link-source";

export interface GroundingVerdict {
	ok: boolean;
	reasons: string[];
}

/**
 * 评估一条草稿是否可 authorized 真发。
 * 规则:① 标题/正文残留【待补】(未完成,缺事实)→ 拦;② 正文含无来源连结(疑似编造)→ 拦。
 */
export function evaluateGrounding(
	draft: ContentDraft,
	facts?: FactsBlock,
): GroundingVerdict {
	const reasons: string[] = [];

	if (draft.title.includes(PLACEHOLDER)) {
		reasons.push("标题仍含【待补】(缺作品名),请补全或编辑后再发。");
	}
	if (draft.body.includes(PLACEHOLDER)) {
		reasons.push("正文仍含【待补】(有事实未补),请补全或删去该占位后再发。");
	}

	// 无来源连结:组装后应恒不触发;此为 defense-in-depth。
	if (hasUnsourcedLink(verifyLinks(draft.body, factUrls(facts ?? {})))) {
		reasons.push("正文含无来源连结(疑似编造 URL),请核实。");
	}

	return { ok: reasons.length === 0, reasons };
}
