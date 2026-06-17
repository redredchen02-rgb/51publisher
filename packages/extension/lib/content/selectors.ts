import type { FieldMapping } from "@51guapi/shared";

// 轻量选择器漂移检测(R6 轻量版;无人值守主动探针 U8 延后)。
// 对当前页查字段映射里的关键选择器是否缺失 → 提示后台可能改版/选择器漂移。
// 纯函数,content 侧用真 document 调用。

export interface DriftReport {
	ok: boolean;
	/** 缺失字段的 label(或选择器),供 UI 提示。 */
	missing: string[];
}

/** 返回在 doc 中找不到的字段(按 FieldMapping)。空 = 无漂移。 */
export function checkSelectorDrift(
	doc: Document,
	mapping: FieldMapping,
): DriftReport {
	const missing: string[] = [];
	for (const def of Object.values(mapping)) {
		if (!def) continue;
		if (!doc.querySelector(def.selector)) {
			missing.push(def.label ?? def.selector);
		}
	}
	return { ok: missing.length === 0, missing };
}
