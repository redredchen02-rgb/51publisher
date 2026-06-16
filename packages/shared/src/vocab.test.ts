import { describe, expect, it } from "vitest";
import { normalizeCategory } from "./vocab.js";

describe("normalizeCategory", () => {
	it("空字串 → 漫畫文章（兜底）", () => {
		expect(normalizeCategory("")).toBe("漫畫文章");
	});

	it("undefined → 漫畫文章（兜底）", () => {
		expect(normalizeCategory(undefined)).toBe("漫畫文章");
	});

	it("完全不认识的文字 → 漫畫文章（兜底）", () => {
		expect(normalizeCategory("校園日常")).toBe("漫畫文章");
	});

	// --- 已是后台 value ---
	it("value '4' → 動漫文章", () => {
		expect(normalizeCategory("4")).toBe("動漫文章");
	});

	it("value '2' → 漫畫文章", () => {
		expect(normalizeCategory("2")).toBe("漫畫文章");
	});

	// --- 已是后台 label ---
	it("label '動漫文章' → 動漫文章（原样）", () => {
		expect(normalizeCategory("動漫文章")).toBe("動漫文章");
	});

	it("label '漫畫文章' → 漫畫文章（原样）", () => {
		expect(normalizeCategory("漫畫文章")).toBe("漫畫文章");
	});

	// --- 关键词模糊命中：動漫分支 ---
	it("'動漫' 关键词 → 動漫文章", () => {
		expect(normalizeCategory("動漫")).toBe("動漫文章");
	});

	it("'动画' 关键词 → 動漫文章", () => {
		expect(normalizeCategory("动画")).toBe("動漫文章");
	});

	it("'新番' → 動漫文章", () => {
		expect(normalizeCategory("新番")).toBe("動漫文章");
	});

	it("'anime' 大小写不敏感 → 動漫文章", () => {
		expect(normalizeCategory("Anime")).toBe("動漫文章");
	});

	it("'OVA' 全词 → 動漫文章", () => {
		expect(normalizeCategory("OVA")).toBe("動漫文章");
	});

	it("'動畫化' → 動漫文章", () => {
		expect(normalizeCategory("動畫化")).toBe("動漫文章");
	});

	// --- 关键词模糊命中：漫畫分支 ---
	it("'漫画' → 漫畫文章", () => {
		expect(normalizeCategory("漫画")).toBe("漫畫文章");
	});

	it("'同人' → 漫畫文章", () => {
		expect(normalizeCategory("同人")).toBe("漫畫文章");
	});

	it("'本子' → 漫畫文章", () => {
		expect(normalizeCategory("本子")).toBe("漫畫文章");
	});

	it("'manga' 大小写不敏感 → 漫畫文章", () => {
		expect(normalizeCategory("Manga")).toBe("漫畫文章");
	});

	// --- 优先级：動漫先于漫畫 ---
	it("同时含動漫和漫畫关键词 → 動漫文章（優先級）", () => {
		expect(normalizeCategory("動漫漫畫合集")).toBe("動漫文章");
	});

	// --- 空白修剪 ---
	it("前后空白被 trim → 不影响 value 命中", () => {
		expect(normalizeCategory("  4  ")).toBe("動漫文章");
	});
});
