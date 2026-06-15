import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing";
import { isAuthenticated, setToken } from "./auth-client";
import { createPrompt, fetchPrompts } from "./prompt-client";

// Characterization test: locks in current behavior across the apiFetch
// migration. prompt-client returns {ok,error} envelopes and clears token on
// 401 via a local handleUnauthorized that apiFetch subsumes.

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

describe("prompt-client (characterization)", () => {
	beforeEach(() => fakeBrowser.reset());
	afterEach(() => vi.unstubAllGlobals());

	it("fetchPrompts: happy → 透传后端 json,注入 Authorization", async () => {
		await setToken("tok");
		const { calls } = stubFetch({ ok: true, prompts: [{ id: "p1" }] });
		const r = await fetchPrompts();
		expect(r.ok).toBe(true);
		expect(r.prompts).toHaveLength(1);
		expect((calls[0]?.headers as Record<string, string>).Authorization).toBe(
			"Bearer tok",
		);
	});

	it("fetchPrompts: 401 → {ok:false} 且清 token", async () => {
		await setToken("tok");
		stubFetch({}, 401);
		const r = await fetchPrompts();
		expect(r.ok).toBe(false);
		expect(await isAuthenticated()).toBe(false);
	});

	it("fetchPrompts: 网络错误 → {ok:false, error}", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new Error("boom");
			}),
		);
		const r = await fetchPrompts();
		expect(r.ok).toBe(false);
		expect(r.error).toContain("boom");
	});

	it("createPrompt: happy → 透传 json", async () => {
		stubFetch({ ok: true });
		const r = await createPrompt({
			name: "n",
			template: "t",
			fewShotExamples: "",
		});
		expect(r.ok).toBe(true);
	});

	it("createPrompt: 500 → {ok:false, error: HTTP 500}", async () => {
		stubFetch({}, 500);
		const r = await createPrompt({
			name: "n",
			template: "t",
			fewShotExamples: "",
		});
		expect(r.ok).toBe(false);
		expect(r.error).toContain("500");
	});
});
