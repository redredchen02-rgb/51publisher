// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withBackendSync, tryBackendRecovery } from "./batch-sync";

// Mock 依赖
vi.mock("./auth-client", () => ({
	getToken: vi.fn(),
}));

vi.mock("./config-client", () => ({
	createRemoteBatch: vi.fn(),
	fetchBatchState: vi.fn(),
	syncBatchItemStatus: vi.fn(),
}));

import { getToken } from "./auth-client";
import {
	createRemoteBatch,
	fetchBatchState,
	syncBatchItemStatus,
} from "./config-client";

const mockGetToken = vi.mocked(getToken);
const mockCreateRemoteBatch = vi.mocked(createRemoteBatch);
const mockFetchBatchState = vi.mocked(fetchBatchState);
const mockSyncBatchItemStatus = vi.mocked(syncBatchItemStatus);

function makeBatch(overrides?: Record<string, unknown>): any {
	return {
		id: "batch-1",
		tabId: 1,
		authorizedHost: "example.com",
		items: [
			{
				id: "item-1",
				topic: "Topic 1",
				status: "queued",
				facts: {},
			},
		],
		...overrides,
	};
}

describe("batch-sync", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGetToken.mockResolvedValue("test-token");
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("withBackendSync", () => {
		it("always writes locally first", async () => {
			const localSave = vi.fn().mockResolvedValue(undefined);
			const batch = makeBatch();
			const sync = withBackendSync(localSave);

			await sync(batch);

			expect(localSave).toHaveBeenCalledWith(batch);
		});

		it("creates remote batch on first call", async () => {
			const localSave = vi.fn().mockResolvedValue(undefined);
			mockCreateRemoteBatch.mockResolvedValue({ ok: true });
			const batch = makeBatch();
			const sync = withBackendSync(localSave);

			await sync(batch);

			expect(mockCreateRemoteBatch).toHaveBeenCalledWith({
				id: "batch-1",
				tabId: 1,
				authorizedHost: "example.com",
				topics: ["Topic 1"],
				facts: [{}],
			});
		});

		it("syncs item status on subsequent calls", async () => {
			const localSave = vi.fn().mockResolvedValue(undefined);
			mockCreateRemoteBatch.mockResolvedValue({ ok: true });
			mockSyncBatchItemStatus.mockResolvedValue({ ok: true });
			const batch = makeBatch();
			const sync = withBackendSync(localSave);

			// 第一次调用
			await sync(batch);

			// 第二次调用
			const updatedBatch = makeBatch({
				items: [{ id: "item-1", topic: "Topic 1", status: "filled", facts: {} }],
			});
			await sync(updatedBatch);

			expect(mockSyncBatchItemStatus).toHaveBeenCalledWith(
				"batch-1",
				"item-1",
				expect.objectContaining({ status: "filled" }),
			);
		});

		it("does not sync if no token", async () => {
			mockGetToken.mockResolvedValue(null);
			const localSave = vi.fn().mockResolvedValue(undefined);
			const batch = makeBatch();
			const sync = withBackendSync(localSave);

			await sync(batch);

			expect(localSave).toHaveBeenCalled();
			expect(mockCreateRemoteBatch).not.toHaveBeenCalled();
		});

		it("handles backend errors gracefully", async () => {
			const localSave = vi.fn().mockResolvedValue(undefined);
			mockCreateRemoteBatch.mockRejectedValue(new Error("Network error"));
			const batch = makeBatch();
			const sync = withBackendSync(localSave);

			// Should not throw
			await expect(sync(batch)).resolves.not.toThrow();
			expect(localSave).toHaveBeenCalled();
		});
	});

	describe("tryBackendRecovery", () => {
		it("returns empty if no batchId", async () => {
			const result = await tryBackendRecovery(null);
			expect(result).toEqual({});
		});

		it("returns empty if no token", async () => {
			mockGetToken.mockResolvedValue(null);
			const result = await tryBackendRecovery("batch-1");
			expect(result).toEqual({});
		});

		it("returns batch if fetch succeeds", async () => {
			const batch = makeBatch();
			mockFetchBatchState.mockResolvedValue({ ok: true, batch });
			const result = await tryBackendRecovery("batch-1");
			expect(result.batch).toEqual(batch);
		});

		it("returns empty if fetch fails", async () => {
			mockFetchBatchState.mockResolvedValue({ ok: false, error: "not found" });
			const result = await tryBackendRecovery("batch-1");
			expect(result).toEqual({});
		});

		it("handles network errors gracefully", async () => {
			mockFetchBatchState.mockRejectedValue(new Error("Network error"));
			const result = await tryBackendRecovery("batch-1");
			expect(result).toEqual({});
		});
	});
});
