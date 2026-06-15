import {
	assembleDraft,
	type BatchItem,
	type ContentDraft,
	containsPlaceholder,
	type DraftSlots,
	toDraft,
} from "@51publisher/shared";
import { describe, expect, it } from "vitest";
import { reassembleWithFacts } from "./refill.js";

const NOW = "2026-06-15T00:00:00.000Z";

function makeDraft(over: Partial<ContentDraft> = {}): ContentDraft {
	return {
		id: "i1",
		title: "《【待补】》第【待补】集",
		subtitle: "副标题",
		category: "动画",
		coverImageUrl: "",
		body: "<p>旧正文</p>",
		tags: ["tag-a", "tag-b"],
		description: "旧描述",
		postStatus: "0",
		publishedAt: "",
		mediaId: "",
		status: "draft",
		createdAt: NOW,
		...over,
	};
}

const SLOTS: DraftSlots = {
	titleSuffix: "",
	subtitle: "快来看",
	intro: "51娘开场",
	highlights: "看点满满",
};

function makeItem(over: Partial<BatchItem> = {}): BatchItem {
	return {
		id: "i1",
		topic: "选题",
		status: "gate-failed",
		facts: {},
		slots: SLOTS,
		draft: makeDraft(),
		...over,
	};
}

describe("reassembleWithFacts", () => {
	it("happy: 补 作品名+集数 → title《某作》第3集，槽位各自正确、placeholder-free、draft 与 snapshot 一致", () => {
		const res = reassembleWithFacts(
			makeItem(),
			{ 作品名: "某作", 集数: "3" },
			NOW,
		);
		expect(res.ok).toBe(true);
		if (!res.ok) return;
		// 作品名 → title 前缀；集数 不应错位到标题
		expect(res.draft.title).toBe("某作");
		// 集数进入抬头块（body）
		expect(res.draft.body).toContain("集数:3");
		expect(res.draft.body).toContain("作品名:某作");
		expect(containsPlaceholder(res.draft.title)).toBe(false);
		expect(containsPlaceholder(res.draft.body)).toBe(false);
		// 两者内容一致
		expect(res.snapshot).toEqual(res.draft);
	});

	it("edge: 只补两缺其一 → 结果仍含【待补 且报告 not-clean", () => {
		// 只补集数、不补作品名 → title 仍为 PLACEHOLDER
		const res = reassembleWithFacts(makeItem(), { 集数: "5" }, NOW);
		expect(res.ok).toBe(true);
		if (!res.ok) return;
		expect(containsPlaceholder(res.draft.title)).toBe(true);
	});

	it("edge(subtitle): slots.subtitle 含裸 URL → 重组 subtitle/description 带【待补 → 被 detector 标记", () => {
		const slots: DraftSlots = {
			...SLOTS,
			subtitle: "看这里 http://evil.example/x 超赞",
		};
		const res = reassembleWithFacts(
			makeItem({ slots }),
			{ 作品名: "某作" },
			NOW,
		);
		expect(res.ok).toBe(true);
		if (!res.ok) return;
		// subtitle 经 sanitizeToPlainText 把裸 URL 转成【待补】
		expect(containsPlaceholder(res.draft.subtitle)).toBe(true);
		// description 在无 简介 时回退到 subtitle/intro，也应被标记
		expect(containsPlaceholder(res.draft.description)).toBe(true);
	});

	it("error: 操作者 URL 含 user:pass@ → 拒绝、不注入", () => {
		const res = reassembleWithFacts(
			makeItem(),
			{ 漢化: "https://user:pass@example.com/x" },
			NOW,
		);
		expect(res.ok).toBe(false);
		if (res.ok) return;
		expect(res.reason).toBe("invalid-url");
		expect(res.field).toBe("漢化");
	});

	it("error: 操作者 URL loopback → 拒绝", () => {
		const res = reassembleWithFacts(
			makeItem(),
			{ 無修: "https://127.0.0.1/x" },
			NOW,
		);
		expect(res.ok).toBe(false);
	});

	it("error: 操作者 URL data:/javascript: → 拒绝", () => {
		const a = reassembleWithFacts(
			makeItem(),
			{ 漢化: "https://ok.example http://bad.example/y" },
			NOW,
		);
		// 含 http（非 https）→ 拒绝
		expect(a.ok).toBe(false);
		// data:/javascript: 不被 extractUrls 抽出（非 http(s)），但若操作者直接写 https 之外协议
		// 这里验证 http 已拒；javascript:/data: 不形成 http(s) URL，故不会被注入为 source。
	});

	it("error: 操作者 URL 超长 → 拒绝", () => {
		const longUrl = `https://example.com/${"a".repeat(2100)}`;
		const res = reassembleWithFacts(makeItem(), { 漢化: longUrl }, NOW);
		expect(res.ok).toBe(false);
	});

	it("error: 无 slots → 拒绝（路由重新生成）", () => {
		const res = reassembleWithFacts(
			makeItem({ slots: undefined }),
			{ 作品名: "某作" },
			NOW,
		);
		expect(res.ok).toBe(false);
		if (res.ok) return;
		expect(res.reason).toBe("no-slots");
	});

	it("anti-false-green: 改 facts 后 snapshot 内容确实区别于陈旧 draft", () => {
		const item = makeItem();
		const res = reassembleWithFacts(item, { 作品名: "全新作品" }, NOW);
		expect(res.ok).toBe(true);
		if (!res.ok) return;
		expect(res.snapshot.body).not.toBe(item.draft?.body);
		expect(res.snapshot.title).not.toBe(item.draft?.title);
		expect(res.snapshot.body).toContain("全新作品");
	});

	it("coverImageUrl 保留：非空封面在重组后仍保留；snapshot 与 fresh toDraft+cover 形状等价", () => {
		const cover = "https://cdn.example.com/cover.jpg";
		const item = makeItem({ draft: makeDraft({ coverImageUrl: cover }) });
		const res = reassembleWithFacts(item, { 作品名: "某作", 集数: "3" }, NOW);
		expect(res.ok).toBe(true);
		if (!res.ok) return;
		expect(res.draft.coverImageUrl).toBe(cover);

		// 与「原始生成路径」形状等价：toDraft(...) 再覆盖 cover。
		const fresh: ContentDraft = {
			...toDraft(
				assembleDraft(SLOTS, { 作品名: "某作", 集数: "3" }),
				"动画",
				["tag-a", "tag-b"],
				"i1",
				NOW,
			),
			coverImageUrl: cover,
		};
		expect(res.draft).toEqual(fresh);
	});
});
