import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getCacheKey, getFromCache, saveToCache } from "./enrichment-cache.js";

// Mock pending-db 中的 getDb
const mockDb = {
	exec: vi.fn(),
	prepare: vi.fn().mockReturnValue({
		run: vi.fn(),
		get: vi.fn(),
	}),
};

vi.mock("./pending-db.js", () => ({
	getDb: () => mockDb,
}));

describe("enrichment-cache", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("getCacheKey: 应该根据制作和作品名正确生成键", () => {
		const key = getCacheKey({ 制作: "A制作组", 作品名: "吃瓜日常" });
		expect(key).toBe("A制作组|吃瓜日常");

		const emptyKey = getCacheKey({});
		expect(emptyKey).toBe("|");
	});

	it("getFromCache & saveToCache: 双层缓存读写生命周期", () => {
		const key = "test-key";
		const data = {
			queryResults: [
				{
					query: "test-query",
					results: [
						{
							title: "测试作品",
							snippet: "测试片段",
							url: "https://example.com",
						},
					],
				},
			],
			collectedAt: new Date().toISOString(),
		};

		// 初始状态，缓存应为空
		mockDb.prepare.mockReturnValue({
			get: vi.fn().mockReturnValue(undefined), // SQLite 未命中
		});
		expect(getFromCache(key)).toBeNull();

		// 保存数据
		const mockRun = vi.fn();
		mockDb.prepare.mockReturnValue({
			run: mockRun,
		});
		saveToCache(key, data);

		// 内存缓存应该命中
		expect(getFromCache(key)).toEqual(data);
		expect(mockDb.prepare).toHaveBeenCalled(); // 应该写入了 SQLite

		// 模拟从 SQLite 读取并回填内存
		// 清空内存缓存需要重新加载模块或修改内部，这里测试 getFromCache 内存命中即可
	});

	it("loadFromDbCache: SQLite 缓存过期时应该删除缓存", () => {
		const key = "expired-key";
		const expiredTime = new Date(
			Date.now() - 25 * 60 * 60 * 1000,
		).toISOString(); // 25小时前，已过期

		const mockRun = vi.fn();
		mockDb.prepare.mockReturnValue({
			get: vi.fn().mockReturnValue({
				data: JSON.stringify({ facts: { 作品名: "过期作品" } }),
				created_at: expiredTime,
			}),
			run: mockRun,
		});

		// 应该返回 null 因为已过期
		expect(getFromCache(key)).toBeNull();
		// 应该触发了删除过期 key 的操作
		expect(mockRun).toHaveBeenCalled();
	});
});
