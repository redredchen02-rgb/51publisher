import { describe, expect, it } from "vitest";
import { toDraft } from "./draft.js";
import type { AssembledDraft } from "./post-assembler.js";

const assembled: AssembledDraft = {
	title: "魔法少女完結篇",
	subtitle: "全12集",
	body: "<p>精彩内容</p>",
	description: "一段简介",
};

describe("toDraft", () => {
	it("映射标题、副标题、正文、简介", () => {
		const d = toDraft(
			assembled,
			"漫畫文章",
			["魔法", "少女"],
			"id-1",
			"2026-01-01T00:00:00Z",
		);
		expect(d.title).toBe("魔法少女完結篇");
		expect(d.subtitle).toBe("全12集");
		expect(d.body).toBe("<p>精彩内容</p>");
		expect(d.description).toBe("一段简介");
	});

	it("写入 id 和 createdAt", () => {
		const d = toDraft(
			assembled,
			"漫畫文章",
			[],
			"my-id",
			"2026-06-16T00:00:00Z",
		);
		expect(d.id).toBe("my-id");
		expect(d.createdAt).toBe("2026-06-16T00:00:00Z");
	});

	it("分类和 tags 直通", () => {
		const d = toDraft(
			assembled,
			"動漫文章",
			["番劇", "新番"],
			"id-2",
			"2026-01-01T00:00:00Z",
		);
		expect(d.category).toBe("動漫文章");
		expect(d.tags).toEqual(["番劇", "新番"]);
	});

	it("postStatus 默认 '0'（草稿）", () => {
		const d = toDraft(
			assembled,
			"漫畫文章",
			[],
			"id-3",
			"2026-01-01T00:00:00Z",
		);
		expect(d.postStatus).toBe("0");
	});

	it("status 默认 'draft'", () => {
		const d = toDraft(
			assembled,
			"漫畫文章",
			[],
			"id-4",
			"2026-01-01T00:00:00Z",
		);
		expect(d.status).toBe("draft");
	});

	it("coverImageUrl 默认空字串", () => {
		const d = toDraft(
			assembled,
			"漫畫文章",
			[],
			"id-5",
			"2026-01-01T00:00:00Z",
		);
		expect(d.coverImageUrl).toBe("");
	});

	it("空 tags 数组", () => {
		const d = toDraft(
			assembled,
			"漫畫文章",
			[],
			"id-6",
			"2026-01-01T00:00:00Z",
		);
		expect(d.tags).toEqual([]);
	});
});
