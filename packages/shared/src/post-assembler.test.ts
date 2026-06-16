import { describe, expect, it } from "vitest";
import type { FactsBlock } from "./facts.js";
import {
	assembleDraft,
	containsPlaceholder,
	esc,
	PLACEHOLDER,
	sanitizeToPlainText,
} from "./post-assembler.js";

const minimalSlots = {
	intro: "歡迎各位紳士來到51娘的世界",
	highlights: "精彩看點多多，入坑不後悔",
};

const fullFacts: FactsBlock = {
	作品名: "魔法少女",
	集数: "全12集",
	制作: "A-1 Pictures",
	漢化: "https://example.com/cn",
	無修: "https://example.com/uncen",
	简介: "一部魔法少女動畫",
};

describe("containsPlaceholder", () => {
	it("returns false for empty/null/undefined", () => {
		expect(containsPlaceholder("")).toBe(false);
		expect(containsPlaceholder(null)).toBe(false);
		expect(containsPlaceholder(undefined)).toBe(false);
	});

	it("detects bare placeholder", () => {
		expect(containsPlaceholder("【待补】")).toBe(true);
	});

	it("detects annotated placeholder", () => {
		expect(containsPlaceholder("【待补:作品名】")).toBe(true);
	});

	it("detects unclosed placeholder", () => {
		expect(containsPlaceholder("【待补")).toBe(true);
	});

	it("returns false for normal text", () => {
		expect(containsPlaceholder("魔法少女動畫")).toBe(false);
	});
});

describe("sanitizeToPlainText", () => {
	it("returns empty string for falsy input", () => {
		expect(sanitizeToPlainText(undefined)).toBe("");
		expect(sanitizeToPlainText("")).toBe("");
	});

	it("strips HTML tags", () => {
		expect(sanitizeToPlainText("<p>Hello <b>world</b></p>")).toBe(
			"Hello world",
		);
	});

	it("replaces bare URLs with placeholder", () => {
		const result = sanitizeToPlainText("看這裡 https://example.com 很好");
		expect(result).toBe(`看這裡 ${PLACEHOLDER} 很好`);
	});

	it("replaces www URLs with placeholder", () => {
		const result = sanitizeToPlainText("去 www.example.com 看看");
		expect(result).toBe(`去 ${PLACEHOLDER} 看看`);
	});

	it("collapses whitespace", () => {
		expect(sanitizeToPlainText("a   b\n\tc")).toBe("a b c");
	});
});

describe("esc", () => {
	it("escapes HTML special chars", () => {
		expect(esc('a & b < c > d "e"')).toBe(
			"a &amp; b &lt; c &gt; d &quot;e&quot;",
		);
	});

	it("passes through plain text unchanged", () => {
		expect(esc("魔法少女")).toBe("魔法少女");
	});
});

describe("assembleDraft", () => {
	it("uses 作品名 in title", () => {
		const result = assembleDraft(minimalSlots, fullFacts);
		expect(result.title).toContain("魔法少女");
	});

	it("sets title to PLACEHOLDER when 作品名 missing", () => {
		const result = assembleDraft(minimalSlots, {});
		expect(result.title).toBe(PLACEHOLDER);
	});

	it("appends titleSuffix to title", () => {
		const result = assembleDraft(
			{ ...minimalSlots, titleSuffix: "成人動畫介紹" },
			fullFacts,
		);
		expect(result.title).toBe("魔法少女成人動畫介紹");
	});

	it("includes header block with facts verbatim", () => {
		const result = assembleDraft(minimalSlots, fullFacts);
		expect(result.body).toContain("魔法少女");
		expect(result.body).toContain("全12集");
		expect(result.body).toContain("A-1 Pictures");
	});

	it("includes link block with facts URLs verbatim", () => {
		const result = assembleDraft(minimalSlots, fullFacts);
		expect(result.body).toContain("https://example.com/cn");
		expect(result.body).toContain("https://example.com/uncen");
	});

	it("model prose URLs are stripped — no unsourced links in body", () => {
		const maliciousSlots = {
			intro: "快去 https://phishing.example.com 看看",
			highlights: "點這 www.evil.com",
		};
		const result = assembleDraft(maliciousSlots, fullFacts);
		expect(result.body).not.toContain("phishing.example.com");
		expect(result.body).not.toContain("evil.com");
	});

	it("model prose HTML tags are stripped", () => {
		const injectionSlots = {
			intro: "<script>alert(1)</script>大家好",
			highlights: "精彩",
		};
		const result = assembleDraft(injectionSlots, fullFacts);
		expect(result.body).not.toContain("<script>");
	});

	it("omits missing facts fields — no empty lines", () => {
		const sparseFacts: FactsBlock = { 作品名: "孤獨搖滾" };
		const result = assembleDraft(minimalSlots, sparseFacts);
		expect(result.body).not.toContain("集数:");
		expect(result.body).not.toContain("制作:");
	});

	it("uses 简介 as description when provided", () => {
		const result = assembleDraft(minimalSlots, fullFacts);
		expect(result.description).toBe("一部魔法少女動畫");
	});

	it("falls back to sanitized intro slice when 简介 absent", () => {
		const result = assembleDraft(minimalSlots, { 作品名: "孤獨搖滾" });
		expect(result.description).toBeTruthy();
		expect(result.description.length).toBeLessThanOrEqual(120);
	});

	it("includes outro when provided", () => {
		const result = assembleDraft(
			{ ...minimalSlots, outro: "下次再見！" },
			fullFacts,
		);
		expect(result.body).toContain("下次再見！");
	});
});
