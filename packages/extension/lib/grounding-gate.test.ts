// @vitest-environment jsdom

import type { ContentDraft, FactsBlock } from "@51publisher/shared";
import { assembleDraft } from "@51publisher/shared";
import { describe, expect, it } from "vitest";
import { evaluateGrounding } from "./grounding-gate";
import { toDraft } from "./llm";

const FULL: FactsBlock = {
	作品名: "A",
	集数: "2期",
	漢化: "https://h.com/a",
	無修: "https://u.com/b",
};

function draftFrom(
	facts: FactsBlock,
	slots = { intro: "引子", highlights: "看点" },
): ContentDraft {
	return toDraft(
		assembleDraft(slots, facts),
		"2",
		[],
		"id",
		"2026-06-05T00:00:00.000Z",
	);
}

describe("evaluateGrounding", () => {
	it("干净草稿(全事实)→ 放行", () => {
		const v = evaluateGrounding(draftFrom(FULL), FULL);
		expect(v.ok).toBe(true);
		expect(v.reasons).toEqual([]);
	});

	it("缺作品名 → 标题【待补】→ 拦", () => {
		const facts = { 漢化: "https://h.com/a", 無修: "https://u.com/b" };
		const v = evaluateGrounding(draftFrom(facts), facts);
		expect(v.ok).toBe(false);
		expect(v.reasons.join()).toContain("标题");
	});

	it("无连结的草稿 → 放行(不强制连结,避免过度拦截)", () => {
		const facts = { 作品名: "A", 集数: "2期" };
		const v = evaluateGrounding(draftFrom(facts), facts);
		expect(v.ok).toBe(true);
	});

	it("草稿被手动留下【待补】→ 拦", () => {
		const clean = draftFrom(FULL);
		const tampered: ContentDraft = {
			...clean,
			body: `${clean.body}<p>漢化:【待补】</p>`,
		};
		const v = evaluateGrounding(tampered, FULL);
		expect(v.ok).toBe(false);
		expect(v.reasons.join()).toContain("正文");
	});

	it("注入无来源连结 → 拦(defense-in-depth)", () => {
		const clean = draftFrom(FULL);
		const tampered: ContentDraft = {
			...clean,
			body: `${clean.body}<p><a href="https://evil.com/x">x</a></p>`,
		};
		const v = evaluateGrounding(tampered, FULL);
		expect(v.ok).toBe(false);
		expect(v.reasons.join()).toContain("无来源连结");
	});

	it("零事实 → 标题【待补】→ 拦", () => {
		const v = evaluateGrounding(draftFrom({}), {});
		expect(v.ok).toBe(false);
		expect(v.reasons.join()).toContain("标题");
	});

	it("副标题含【待补】→ 拦(此前会漏过)", () => {
		const clean = draftFrom(FULL);
		const tampered: ContentDraft = { ...clean, subtitle: "看点【待补】" };
		const v = evaluateGrounding(tampered, FULL);
		expect(v.ok).toBe(false);
		expect(v.reasons.join()).toContain("副标题");
	});

	it("副标题被手编留下【待补】→ 拦", () => {
		const clean = draftFrom(FULL);
		const tampered: ContentDraft = {
			...clean,
			subtitle: `${clean.subtitle}【待补】`,
		};
		const v = evaluateGrounding(tampered, FULL);
		expect(v.ok).toBe(false);
		expect(v.reasons.join()).toContain("副标题");
	});

	it("简介(description)含【待补】→ 拦(此前会漏过)", () => {
		const clean = draftFrom(FULL);
		const tampered: ContentDraft = {
			...clean,
			description: "简介【待补】",
		};
		const v = evaluateGrounding(tampered, FULL);
		expect(v.ok).toBe(false);
		expect(v.reasons.join()).toContain("简介");
	});

	it("未闭合/标注式【待补 变体也拦(前缀匹配)", () => {
		const clean = draftFrom(FULL);
		const tampered: ContentDraft = {
			...clean,
			body: `${clean.body}<p>漢化:【待补:漢化连结</p>`,
		};
		const v = evaluateGrounding(tampered, FULL);
		expect(v.ok).toBe(false);
		expect(v.reasons.join()).toContain("正文");
	});

	it("描述被手编留下【待补】→ 拦", () => {
		const clean = draftFrom(FULL);
		const tampered: ContentDraft = {
			...clean,
			description: `${clean.description}【待补】`,
		};
		const v = evaluateGrounding(tampered, FULL);
		expect(v.ok).toBe(false);
		// 实现对 description 字段的提示文案用「简介」(PR #26 口径),非「描述」。
		expect(v.reasons.join()).toContain("简介");
	});

	it("干净副标题/描述 → 放行(不误拦)", () => {
		const clean = draftFrom(FULL);
		const edited: ContentDraft = {
			...clean,
			subtitle: "操作者润色后的副标题",
			description: "操作者润色后的描述。",
		};
		const v = evaluateGrounding(edited, FULL);
		expect(v.ok).toBe(true);
	});
});

describe("evaluateGrounding — Phase 2 新增校验", () => {
	const base = draftFrom(FULL);

	// ──── description / subtitle 裸 URL ────

	it("description 含无来源裸 URL → 拦", () => {
		const draft: ContentDraft = {
			...base,
			description: "查看资源:https://evil.com/fake",
		};
		const v = evaluateGrounding(draft, FULL);
		expect(v.ok).toBe(false);
		expect(v.reasons.join()).toContain("简介含无来源裸 URL");
	});

	it("description 含 factUrls 内裸 URL → 放行", () => {
		const draft: ContentDraft = {
			...base,
			description: `汉化资源:${FULL.漢化}`,
		};
		const v = evaluateGrounding(draft, FULL);
		expect(v.ok).toBe(true);
	});

	it("description 含 factUrls 内裸 URL 后跟英文句号 → 放行(尾部标点不影响来源匹配)", () => {
		// 英文句号后紧跟空格是常见格式;此处验证尾部标点被正确剥离
		const draft: ContentDraft = {
			...base,
			description: `汉化资源: ${FULL.漢化}.`,
		};
		const v = evaluateGrounding(draft, FULL);
		expect(v.ok).toBe(true);
	});

	it("description 含 factUrls 内裸 URL 后跟右括号 → 放行", () => {
		const draft: ContentDraft = {
			...base,
			description: `汉化(${FULL.漢化})`,
		};
		const v = evaluateGrounding(draft, FULL);
		expect(v.ok).toBe(true);
	});

	it("description 无裸 URL → 放行", () => {
		const draft: ContentDraft = {
			...base,
			description: "这是一段纯文字描述,没有链接。",
		};
		const v = evaluateGrounding(draft, FULL);
		expect(v.ok).toBe(true);
	});

	it("subtitle 含无来源裸 URL → 拦", () => {
		const draft: ContentDraft = {
			...base,
			subtitle: `看点 https://evil.com/sub`,
		};
		const v = evaluateGrounding(draft, FULL);
		expect(v.ok).toBe(false);
		expect(v.reasons.join()).toContain("副标题含无来源裸 URL");
	});

	// ──── category 校验 ────

	it("category='2' → 放行", () => {
		const draft: ContentDraft = { ...base, category: "2" };
		const v = evaluateGrounding(draft, FULL);
		expect(v.ok).toBe(true);
	});

	it("category='4' → 放行", () => {
		const draft: ContentDraft = { ...base, category: "4" };
		const v = evaluateGrounding(draft, FULL);
		expect(v.ok).toBe(true);
	});

	it("category='99' → 拦", () => {
		const draft: ContentDraft = { ...base, category: "99" };
		const v = evaluateGrounding(draft, FULL);
		expect(v.ok).toBe(false);
		expect(v.reasons.join()).toContain("分类值");
	});

	it("category='' 空字符串 → 不拦(空值不强制)", () => {
		const draft: ContentDraft = { ...base, category: "" };
		const v = evaluateGrounding(draft, FULL);
		// 空 category 不触发校验(无值视为「未填写」而非「非法值」)
		expect(v.reasons.join()).not.toContain("分类值");
	});

	// ──── tags allow-list ────

	it("tags 全在 recommendedTags → 放行", () => {
		const draft: ContentDraft = { ...base, tags: ["漫画", "热血"] };
		const v = evaluateGrounding(draft, FULL, undefined, [
			"漫画",
			"热血",
			"冒险",
		]);
		expect(v.ok).toBe(true);
	});

	it("tags 含不在允许集的项 → 拦", () => {
		const draft: ContentDraft = { ...base, tags: ["漫画", "非法标签"] };
		const v = evaluateGrounding(draft, FULL, undefined, ["漫画", "热血"]);
		expect(v.ok).toBe(false);
		expect(v.reasons.join()).toContain("非法标签");
	});

	it("recommendedTags 未配置(undefined) → tags 任意值不触发拦截", () => {
		const draft: ContentDraft = {
			...base,
			tags: ["任意标签1", "任意标签2"],
		};
		const v = evaluateGrounding(draft, FULL, undefined, undefined);
		expect(v.reasons.join()).not.toContain("标签");
	});

	it("recommendedTags=[] 空数组 → tags 不拦(降级)", () => {
		const draft: ContentDraft = { ...base, tags: ["任意标签"] };
		const v = evaluateGrounding(draft, FULL, undefined, []);
		expect(v.reasons.join()).not.toContain("标签");
	});

	it("tags=[] 空数组 + recommendedTags 配置 → 不拦(无成员)", () => {
		const draft: ContentDraft = { ...base, tags: [] };
		const v = evaluateGrounding(draft, FULL, undefined, ["漫画"]);
		expect(v.ok).toBe(true);
	});

	// ──── 现有 5 个 check 回归 ────

	it("新增校验不影响旧 check:标题【待补】仍拦", () => {
		const v = evaluateGrounding(draftFrom({}), {});
		expect(v.ok).toBe(false);
		expect(v.reasons.join()).toContain("标题");
	});
});
