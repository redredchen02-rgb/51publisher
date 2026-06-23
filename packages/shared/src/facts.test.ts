import { describe, expect, it } from "vitest";
import {
	applyPromptTemplate,
	factUrls,
	formatFactsForPrompt,
	isEmptyFacts,
	parseTopicLine,
} from "./facts.js";

describe("parseTopicLine", () => {
	it("returns null for empty line", () => {
		expect(parseTopicLine("")).toBeNull();
		expect(parseTopicLine("   ")).toBeNull();
	});

	it("returns bare topic when no || separator", () => {
		const result = parseTopicLine("魔法少女");
		expect(result).toEqual({ topic: "魔法少女", facts: {} });
	});

	it("parses topic + facts", () => {
		const result = parseTopicLine("魔法少女||作品名=魔法少女|集数=全12集");
		expect(result?.topic).toBe("魔法少女");
		expect(result?.facts.作品名).toBe("魔法少女");
		expect(result?.facts.集数).toBe("全12集");
	});

	it("supports aliases", () => {
		const result = parseTopicLine("test||name=孤獨搖滾|eps=全13集");
		expect(result?.facts.作品名).toBe("孤獨搖滾");
		expect(result?.facts.集数).toBe("全13集");
	});

	it("ignores unknown keys", () => {
		const result = parseTopicLine("test||unknownkey=value|作品名=孤獨搖滾");
		expect(result?.facts.作品名).toBe("孤獨搖滾");
		expect(Object.keys(result?.facts ?? {}).length).toBe(1);
	});

	it("handles value with = inside (splits on first = only)", () => {
		const result = parseTopicLine(
			"test||漢化=https://example.com/path?a=1&b=2",
		);
		expect(result?.facts.漢化).toBe("https://example.com/path?a=1&b=2");
	});

	it("skips fields with empty value", () => {
		const result = parseTopicLine("test||作品名=|集数=全12集");
		expect(result?.facts.作品名).toBeUndefined();
		expect(result?.facts.集数).toBe("全12集");
	});

	it("later duplicate key overwrites earlier", () => {
		const result = parseTopicLine("test||作品名=第一|作品名=第二");
		expect(result?.facts.作品名).toBe("第二");
	});
});

describe("isEmptyFacts", () => {
	it("returns true for empty object", () => {
		expect(isEmptyFacts({})).toBe(true);
	});

	it("returns false when any fact is set", () => {
		expect(isEmptyFacts({ 作品名: "魔法少女" })).toBe(false);
	});
});

describe("factUrls", () => {
	it("returns empty array when no URL fields", () => {
		expect(factUrls({ 作品名: "魔法少女" })).toEqual([]);
	});

	it("extracts URLs from 漢化 and 無修", () => {
		const urls = factUrls({
			漢化: "漢化版 https://cn.example.com",
			無修: "https://uncen.example.com",
		});
		expect(urls).toContain("https://cn.example.com");
		expect(urls).toContain("https://uncen.example.com");
	});

	it("extracts multiple URLs from a single field", () => {
		const urls = factUrls({ 漢化: "https://a.com https://b.com" });
		expect(urls).toHaveLength(2);
	});
});

describe("formatFactsForPrompt", () => {
	it("returns zero-facts instruction when empty", () => {
		const result = formatFactsForPrompt({});
		expect(result).toContain("【待补】");
		expect(result).toContain("绝不编造");
	});

	it("includes provided fact keys", () => {
		const result = formatFactsForPrompt({ 作品名: "魔法少女", 集数: "全12集" });
		expect(result).toContain("作品名:魔法少女");
		expect(result).toContain("集数:全12集");
	});

	it("omits missing keys", () => {
		const result = formatFactsForPrompt({ 作品名: "魔法少女" });
		expect(result).not.toContain("集数:");
	});
});

describe("applyPromptTemplate", () => {
	it("replaces {{topic}} placeholder", () => {
		const result = applyPromptTemplate("主题是{{topic}}", "魔法少女");
		expect(result).toContain("魔法少女");
		expect(result).not.toContain("{{topic}}");
	});

	it("appends topic when no {{topic}} in template", () => {
		const result = applyPromptTemplate("寫一篇介紹", "魔法少女");
		expect(result).toContain("魔法少女");
	});

	it("replaces {{facts}} when facts provided", () => {
		const result = applyPromptTemplate("{{facts}}\n請根據以上寫作", "topic", {
			作品名: "魔法少女",
		});
		expect(result).toContain("作品名:魔法少女");
		expect(result).not.toContain("{{facts}}");
	});

	it("removes {{facts}} when no facts provided", () => {
		const result = applyPromptTemplate("{{facts}}請寫作", "topic");
		expect(result).not.toContain("{{facts}}");
	});

	it("prepends fewShot when provided and no {{fewshot}} placeholder", () => {
		const result = applyPromptTemplate("寫作指令", "topic", {}, "範例文字");
		expect(result).toContain("範例文字");
	});

	it("removes {{fewshot}} when fewShot is empty", () => {
		const result = applyPromptTemplate("{{fewshot}}正文", "topic", {}, "");
		expect(result).not.toContain("{{fewshot}}");
	});

	it("appends enrichment when provided and no {{enrichment}} placeholder", () => {
		const result = applyPromptTemplate(
			"寫作指令",
			"topic",
			{},
			undefined,
			"額外資訊",
		);
		expect(result).toContain("額外資訊");
	});
});
