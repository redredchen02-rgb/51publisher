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

	it("描述被手编留下【待补】→ 拦", () => {
		const clean = draftFrom(FULL);
		const tampered: ContentDraft = {
			...clean,
			description: `${clean.description}【待补】`,
		};
		const v = evaluateGrounding(tampered, FULL);
		expect(v.ok).toBe(false);
		expect(v.reasons.join()).toContain("描述");
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
