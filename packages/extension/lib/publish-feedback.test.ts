import { beforeEach, describe, expect, it, vi } from "vitest";
import { getFeedback, getFeedbackForItem, saveFeedback } from "./publish-feedback";

const mockStorage = new Map<string, unknown>();

vi.mock("#imports", () => ({
	storage: {
		getItem: async (key: string) => mockStorage.get(key) ?? null,
		setItem: async (key: string, value: unknown) => { mockStorage.set(key, value); },
	},
}));

beforeEach(() => mockStorage.clear());

describe("publish-feedback", () => {
	it("初始狀態返回空陣列", async () => {
		expect(await getFeedback()).toEqual([]);
	});

	it("saveFeedback 可存入並讀回", async () => {
		await saveFeedback({ itemId: "a1", topic: "topic-a", rating: "good", ts: "2026-01-01T00:00:00Z" });
		const all = await getFeedback();
		expect(all).toHaveLength(1);
		expect(all[0]?.rating).toBe("good");
	});

	it("同一 itemId 覆寫，不重複", async () => {
		await saveFeedback({ itemId: "a1", topic: "t", rating: "good", ts: "2026-01-01T00:00:00Z" });
		await saveFeedback({ itemId: "a1", topic: "t", rating: "bad", ts: "2026-01-02T00:00:00Z" });
		const all = await getFeedback();
		expect(all).toHaveLength(1);
		expect(all[0]?.rating).toBe("bad");
	});

	it("getFeedbackForItem 回傳指定 item", async () => {
		await saveFeedback({ itemId: "a1", topic: "t1", rating: "ok", ts: "2026-01-01T00:00:00Z" });
		await saveFeedback({ itemId: "a2", topic: "t2", rating: "good", ts: "2026-01-01T00:00:00Z" });
		const found = await getFeedbackForItem("a1");
		expect(found?.rating).toBe("ok");
		expect(await getFeedbackForItem("a99")).toBeUndefined();
	});

	it("note 可選欄位正確存取", async () => {
		await saveFeedback({ itemId: "b1", topic: "t", rating: "bad", note: "內容太短", ts: "2026-01-01T00:00:00Z" });
		const f = await getFeedbackForItem("b1");
		expect(f?.note).toBe("內容太短");
	});
});
