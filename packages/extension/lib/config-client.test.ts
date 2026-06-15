import { DEFAULT_FIELD_MAPPING } from "@51publisher/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing";
import { isAuthenticated, setToken } from "./auth-client";
import {
	createRemoteBatch,
	fetchBatchState,
	fetchRemoteMappings,
	syncBatchItemStatus,
} from "./config-client";

// Characterization test: locks in current behavior across the apiFetch
// migration. config-client is fail-closed — it falls back to
// DEFAULT_FIELD_MAPPING / {ok:false} envelopes rather than throwing, so the
// extension keeps working offline. That must survive the refactor.

function stubFetch(body: unknown, status = 200): { calls: RequestInit[] } {
	const calls: RequestInit[] = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(async (_url: string, init?: RequestInit) => {
			calls.push(init ?? {});
			return new Response(JSON.stringify(body), { status });
		}),
	);
	return { calls };
}

describe("config-client (characterization)", () => {
	beforeEach(() => fakeBrowser.reset());
	afterEach(() => vi.unstubAllGlobals());

	it("fetchRemoteMappings: happy → remote:true + 后端映射", async () => {
		const mappings = { ...DEFAULT_FIELD_MAPPING };
		stubFetch({ ok: true, mappings, version: 3 });
		const r = await fetchRemoteMappings();
		expect(r.remote).toBe(true);
	});

	it("fetchRemoteMappings: 401 → 回落 DEFAULT + remote:false + 清 token", async () => {
		await setToken("tok");
		stubFetch({}, 401);
		const r = await fetchRemoteMappings();
		expect(r.remote).toBe(false);
		expect(r.mappings).toBe(DEFAULT_FIELD_MAPPING);
		expect(await isAuthenticated()).toBe(false);
	});

	it("fetchRemoteMappings: 网络错误 → fail-closed 回落 DEFAULT", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new Error("offline");
			}),
		);
		const r = await fetchRemoteMappings();
		expect(r.remote).toBe(false);
		expect(r.mappings).toBe(DEFAULT_FIELD_MAPPING);
	});

	it("syncBatchItemStatus: 401 → {ok:false, error:登录已过期}", async () => {
		await setToken("tok");
		stubFetch({}, 401);
		const r = await syncBatchItemStatus("b1", "i1", { status: "done" });
		expect(r.ok).toBe(false);
		expect(r.error).toBe("登录已过期");
	});

	it("syncBatchItemStatus: happy → {ok:true}", async () => {
		stubFetch({ ok: true });
		const r = await syncBatchItemStatus("b1", "i1", { status: "done" });
		expect(r.ok).toBe(true);
	});

	it("fetchBatchState: happy → {ok:true, batch}", async () => {
		stubFetch({ ok: true, batch: { id: "b1" } });
		const r = await fetchBatchState("b1");
		expect(r.ok).toBe(true);
		expect((r.batch as { id: string }).id).toBe("b1");
	});

	it("createRemoteBatch: 500 → {ok:false, error 含 500}", async () => {
		stubFetch({}, 500);
		const r = await createRemoteBatch({
			id: "b1",
			tabId: 1,
			authorizedHost: "h",
			topics: [],
		});
		expect(r.ok).toBe(false);
		expect(r.error).toContain("500");
	});
});
