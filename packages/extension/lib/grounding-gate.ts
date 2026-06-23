// 发布前 grounding 硬闸(U4):authorized 真发前,残留【待补】或无来源连结 → 拦。
// 把审核区的「只展示」升级为「发布前 fail-closed」。仅 authorized 档拦截;off/dry-run 不拦(只供提示)。
//
// 纯函数(verifyLinks 为纯 regex 提取,无 DOM 依赖 —— 组装器已保证连结来源,此为 defense-in-depth)。

import type { ContentDraft, FactsBlock } from "@51publisher/shared";
import { containsPlaceholder, factUrls } from "@51publisher/shared";
import { hasUnsourcedLink, verifyLinks } from "./link-source";

const VALID_CATEGORIES = new Set(["2", "4"]);

export interface GroundingVerdict {
	ok: boolean;
	reasons: string[];
}

/** 从纯文本中提取裸 URL(非 HTML <a href>),用于 description/subtitle 的来源校验。
 *  末尾标点符号(句号/逗号/括号等)从匹配结果中剥离,防止 "URL。" 与 facts 中干净 URL 不等而误判。 */
function extractRawUrls(text: string): string[] {
	const matches = text.match(/https?:\/\/[^\s<>"]+/g);
	if (!matches) return [];
	// 剥离常见尾部标点（含中文句号/顿号/书名号）
	return matches.map((u) => u.replace(/[.,;:!?)\]'>。、」』）]+$/, ""));
}

/**
 * 评估一条草稿是否可 authorized 真发。
 * 规则:
 *   ① 标题/正文/副标题/简介残留【待补】→ 拦
 *   ② 正文含无来源连结(HTML <a href>)→ 拦
 *   ③ 简介/副标题含无来源裸 URL → 拦(Phase 2 新增)
 *   ④ category 不在合法值集合 → 拦(Phase 2 新增)
 *   ⑤ tags 含不在 recommendedTags 的项 → 拦(如已配置)(Phase 2 新增)
 *   ⑥ 质量分过低 → 提示
 */
export function evaluateGrounding(
	draft: ContentDraft,
	facts?: FactsBlock,
	qualityScore?: number,
	recommendedTags?: string[],
): GroundingVerdict {
	const reasons: string[] = [];
	const sourcedUrlsList = factUrls(facts ?? {});
	const sourcedUrls = new Set(sourcedUrlsList);

	// ① 四个组装字段全部检测 placeholder
	if (containsPlaceholder(draft.title)) {
		reasons.push("标题仍含【待补】(缺作品名),请补全或编辑后再发。");
	}
	if (containsPlaceholder(draft.body)) {
		reasons.push("正文仍含【待补】(有事实未补),请补全或删去该占位后再发。");
	}
	if (containsPlaceholder(draft.subtitle)) {
		reasons.push("副标题仍含【待补】(有事实未补),请补全或删去该占位后再发。");
	}
	if (containsPlaceholder(draft.description)) {
		reasons.push("简介仍含【待补】(有事实未补),请补全或删去该占位后再发。");
	}

	// ② 正文 HTML <a href> 无来源连结(defense-in-depth)
	if (hasUnsourcedLink(verifyLinks(draft.body, sourcedUrlsList))) {
		reasons.push("正文含无来源连结(疑似编造 URL),请核实。");
	}

	// ③ 简介/副标题裸 URL 来源校验(Phase 2)
	for (const rawUrl of extractRawUrls(draft.description)) {
		if (!sourcedUrls.has(rawUrl)) {
			reasons.push(`简介含无来源裸 URL(疑似编造):${rawUrl}`);
			break; // 只报第一条,避免刷屏
		}
	}
	for (const rawUrl of extractRawUrls(draft.subtitle)) {
		if (!sourcedUrls.has(rawUrl)) {
			reasons.push(`副标题含无来源裸 URL(疑似编造):${rawUrl}`);
			break;
		}
	}

	// ④ category 合法值校验(Phase 2)
	if (draft.category && !VALID_CATEGORIES.has(draft.category)) {
		reasons.push(
			`分类值「${draft.category}」不在合法选项(2=漫畫/4=動漫),请修正后再发。`,
		);
	}

	// ⑤ tags allow-list 校验(Phase 2 —— 仅在 recommendedTags 已配置时执行)
	if (recommendedTags && recommendedTags.length > 0) {
		const allowed = new Set(recommendedTags);
		const bad = draft.tags.filter((t) => t && !allowed.has(t));
		if (bad.length > 0) {
			reasons.push(`标签含未在允许集内的项:「${bad.join("、")}」,请修正。`);
		}
	}

	// ⑥ 质量分检查（非阻塞，仅提示）
	if (qualityScore !== undefined && qualityScore < 0.6) {
		reasons.push(
			`内容质量分 ${(qualityScore * 100).toFixed(0)}% 低于阈值,建议优化后再发。`,
		);
	}

	return { ok: reasons.length === 0, reasons };
}
