import { describe, expect, it } from "vitest";
import type { FactsBlock } from "./facts.js";
import { evaluateQuality } from "./quality-gate.js";
import type { ContentDraft } from "./types.js";

const makeDraft = (overrides: Partial<ContentDraft> = {}): ContentDraft => ({
	id: "test-1",
	topic: "魔法少女",
	title: "魔法少女成人動畫介紹",
	subtitle: "一部好看的動畫",
	body: "<p>嗨嗨大家好！51娘今天給大家推薦一部超神作！安利一下這部宝藏作品，各位紳士快來入坑！精彩看點太顶了，小伙伴们冲啊！</p>",
	description: "魔法少女介紹",
	tags: ["動畫", "魔法"],
	createdAt: "2026-06-16T00:00:00Z",
	...overrides,
});

const goodFacts: FactsBlock = {
	作品名: "魔法少女",
	集数: "全12集",
	制作: "A-1 Pictures",
	漢化: "https://example.com/cn",
	題材: "魔法少女",
	简介: "一部魔法少女動畫",
};

describe("evaluateQuality", () => {
	it("passes a well-formed draft with good facts", () => {
		const verdict = evaluateQuality(makeDraft(), goodFacts);
		expect(verdict.pass).toBe(true);
		expect(verdict.overall).toBeGreaterThanOrEqual(0.6);
	});

	it("returns 5 checks", () => {
		const verdict = evaluateQuality(makeDraft(), goodFacts);
		expect(verdict.checks).toHaveLength(5);
	});

	it("fails body_length check for short body", () => {
		const draft = makeDraft({ body: "<p>太短了</p>" });
		const verdict = evaluateQuality(draft, goodFacts);
		const check = verdict.checks.find((c) => c.name === "body_length");
		expect(check?.pass).toBe(false);
	});

	it("passes body_length check for body >= 150 chars", () => {
		const longBody = `<p>${"大家好！".repeat(40)}</p>`;
		const draft = makeDraft({ body: longBody });
		const verdict = evaluateQuality(draft, goodFacts);
		const check = verdict.checks.find((c) => c.name === "body_length");
		expect(check?.pass).toBe(true);
	});

	it("fails facts_completeness when no facts provided", () => {
		const verdict = evaluateQuality(makeDraft());
		const check = verdict.checks.find((c) => c.name === "facts_completeness");
		expect(check?.pass).toBe(false);
		expect(check?.score).toBe(0);
	});

	it("passes facts_completeness when >= 50% core fields filled", () => {
		const verdict = evaluateQuality(makeDraft(), goodFacts);
		const check = verdict.checks.find((c) => c.name === "facts_completeness");
		expect(check?.pass).toBe(true);
	});

	it("fails title_quality when title contains placeholder", () => {
		const draft = makeDraft({ title: "【待补】" });
		const verdict = evaluateQuality(draft, goodFacts);
		const check = verdict.checks.find((c) => c.name === "title_quality");
		expect(check?.pass).toBe(false);
		expect(check?.score).toBe(0);
	});

	it("fails title_quality when title is too short", () => {
		const draft = makeDraft({ title: "短" });
		const verdict = evaluateQuality(draft, goodFacts);
		const check = verdict.checks.find((c) => c.name === "title_quality");
		expect(check?.pass).toBe(false);
	});

	it("passes title_quality for a good title", () => {
		const verdict = evaluateQuality(makeDraft(), goodFacts);
		const check = verdict.checks.find((c) => c.name === "title_quality");
		expect(check?.pass).toBe(true);
	});

	it("passes community_tone when >= 2 tone words present", () => {
		const verdict = evaluateQuality(makeDraft(), goodFacts);
		const check = verdict.checks.find((c) => c.name === "community_tone");
		expect(check?.pass).toBe(true);
	});

	it("fails community_tone when tone words absent", () => {
		const draft = makeDraft({
			body: "<p>这是一篇平淡的介绍文章，没有任何口语化表达。内容详尽但缺乏活力，读者可能感到枯燥。</p>",
		});
		const verdict = evaluateQuality(draft, goodFacts);
		const check = verdict.checks.find((c) => c.name === "community_tone");
		expect(check?.pass).toBe(false);
	});

	it("fails tags_accuracy when no tags", () => {
		const draft = makeDraft({ tags: [] });
		const verdict = evaluateQuality(draft, goodFacts);
		const check = verdict.checks.find((c) => c.name === "tags_accuracy");
		expect(check?.pass).toBe(false);
	});

	it("passes tags_accuracy when 2-10 tags", () => {
		const draft = makeDraft({ tags: ["動畫", "魔法", "少女"] });
		const verdict = evaluateQuality(draft, goodFacts);
		const check = verdict.checks.find((c) => c.name === "tags_accuracy");
		expect(check?.pass).toBe(true);
	});

	it("uses custom threshold", () => {
		const verdict = evaluateQuality(makeDraft(), goodFacts, 0.99);
		expect(verdict.pass).toBe(false);
	});

	it("overall score is average of check scores", () => {
		const verdict = evaluateQuality(makeDraft(), goodFacts);
		const sum = verdict.checks.reduce((s, c) => s + c.score, 0);
		expect(verdict.overall).toBeCloseTo(sum / verdict.checks.length, 5);
	});
});
