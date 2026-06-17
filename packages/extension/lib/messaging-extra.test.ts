import type { ContentDraft } from "@51guapi/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing";
import { checkSelectors, requestFill } from "./messaging";

const DRAFT: ContentDraft = {
	id: "d1",
	title: "t",
	subtitle: "",
	category: "2",
	coverImageUrl: "",
	body: "<p>x</p>",
	tags: [],
	description: "",
	postStatus: "0",
	publishedAt: "",
	mediaId: "1",
	status: "draft",
	createdAt: "2026-06-01T00:00:00.000Z",
};

describe("requestFill", () => {
	beforeEach(() => {
		fakeBrowser.reset();
	});

	it("no tabs → ok:false with error message about missing tab", async () => {
		// fakeBrowser.tabs.query returns [] by default after reset
		const res = await requestFill(DRAFT);
		expect(res.ok).toBe(false);
		if (!res.ok) expect(res.error).toContain("未找到");
	});

	it("tab found but sendMessage throws → ok:false connection error", async () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		vi.spyOn(fakeBrowser.tabs, "query").mockResolvedValue([
			{ id: 10, url: "https://dx-999-adm.ympxbys.xyz/admin" },
		] as unknown as Awaited<ReturnType<typeof fakeBrowser.tabs.query>>);
		vi.spyOn(fakeBrowser.tabs, "sendMessage").mockRejectedValue(
			new Error("Could not connect to page"),
		);
		const res = await requestFill(DRAFT);
		expect(res.ok).toBe(false);
		if (!res.ok) expect(res.error).toContain("无法连接");
	});
});

describe("checkSelectors", () => {
	beforeEach(() => {
		fakeBrowser.reset();
	});

	it("sendMessage throws → returns error DriftReport", async () => {
		vi.spyOn(fakeBrowser.tabs, "sendMessage").mockRejectedValue(
			new Error("tab dead"),
		);
		const result = await checkSelectors(5);
		expect(result.ok).toBe(false);
		expect(result.missing.length).toBeGreaterThan(0);
	});

	it("sendMessage succeeds → passes through result", async () => {
		vi.spyOn(fakeBrowser.tabs, "sendMessage").mockResolvedValue({
			ok: true,
			missing: [],
		});
		const result = await checkSelectors(5);
		expect(result.ok).toBe(true);
	});
});
