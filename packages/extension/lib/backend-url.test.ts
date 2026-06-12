import { describe, it, expect, vi, beforeEach } from "vitest";
import { getBackendUrl, clearBackendUrlCache } from "./backend-url";

vi.mock("#imports", () => ({
	storage: {
		getItem: vi.fn(),
	},
}));

import { storage } from "#imports";

const mockStorage = vi.mocked(storage);

describe("getBackendUrl", () => {
	beforeEach(() => {
		clearBackendUrlCache();
		vi.clearAllMocks();
	});

	it("返回配置的 backendUrl", async () => {
		mockStorage.getItem.mockResolvedValue({ backendUrl: "http://custom:8080" });
		const url = await getBackendUrl();
		expect(url).toBe("http://custom:8080");
	});

	it("未配置时返回默认值", async () => {
		mockStorage.getItem.mockResolvedValue({});
		const url = await getBackendUrl();
		expect(url).toBe("http://127.0.0.1:3001");
	});

	it("storage 异常时返回默认值", async () => {
		mockStorage.getItem.mockRejectedValue(new Error("storage error"));
		const url = await getBackendUrl();
		expect(url).toBe("http://127.0.0.1:3001");
	});

	it("结果被缓存", async () => {
		mockStorage.getItem.mockResolvedValue({ backendUrl: "http://cached:9090" });
		await getBackendUrl();
		await getBackendUrl();
		expect(mockStorage.getItem).toHaveBeenCalledTimes(1);
	});

	it("clearBackendUrlCache 后重新读取", async () => {
		mockStorage.getItem.mockResolvedValue({ backendUrl: "http://first:8080" });
		await getBackendUrl();

		clearBackendUrlCache();

		mockStorage.getItem.mockResolvedValue({ backendUrl: "http://second:9090" });
		const url = await getBackendUrl();
		expect(url).toBe("http://second:9090");
	});
});
