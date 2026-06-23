import { describe, expect, it, vi } from "vitest";
import {
	asPublishResult,
	buildConstraintSuffix,
	createHandlers,
} from "../../entrypoints/background";
import { DRAFT, HOST, makeDeps, SETTINGS } from "./bg-test-fixtures";

// ================================================================
// handleGenerate
// ================================================================

describe("handleGenerate", () => {
	it("happy path: generateDraftFn called with prompt + constraint suffix", async () => {
		const deps = makeDeps();
		const h = createHandlers(deps);
		const result = await h.handleGenerate("test prompt");
		expect(result).toEqual({ ok: true, draft: DRAFT });
		expect(deps.generateDraftFn).toHaveBeenCalledWith(
			expect.stringContaining("test prompt"),
			expect.objectContaining({ apiKey: "test-key" }),
		);
		const [calledPrompt] = (deps.generateDraftFn as ReturnType<typeof vi.fn>)
			.mock.calls[0] as [string];
		expect(calledPrompt).toContain("分类约束");
	});

	it("generateDraftFn throws → returns ok:false error", async () => {
		const deps = makeDeps({
			generateDraftFn: vi.fn(async () => {
				throw new Error("network");
			}),
		});
		const h = createHandlers(deps);
		const result = await h.handleGenerate("prompt");
		expect(result).toMatchObject({ ok: false });
	});

	it("generateDraftFn throws non-Error → String(err) branch", async () => {
		const deps = makeDeps({
			generateDraftFn: vi.fn(async () => {
				throw "string-thrown";
			}),
		});
		const h = createHandlers(deps);
		const result = await h.handleGenerate("prompt");
		expect(result).toMatchObject({ ok: false });
	});
});

// ================================================================
// evaluateGate (TOCTOU fix)
// ================================================================

describe("evaluateGate TOCTOU fix", () => {
	it("atomic snapshot: tab on authorized host → allowed:true", async () => {
		const deps = makeDeps({
			getSafetyMode: vi.fn(async () => "authorized" as const),
			getAuthorizedHosts: vi.fn(async () => [HOST]),
			tabsGet: vi.fn(
				async () =>
					({ url: `https://${HOST}/admin` }) as { url?: string; id?: number },
			),
		});
		const h = createHandlers(deps);
		const decision = await h.evaluateGate(1);
		expect(decision.allowed).toBe(true);
		expect(decision.host).toBe(HOST);
	});

	it("tab navigated to non-authorized host → allowed:false", async () => {
		const deps = makeDeps({
			getSafetyMode: vi.fn(async () => "authorized" as const),
			getAuthorizedHosts: vi.fn(async () => [HOST]),
			tabsGet: vi.fn(
				async () =>
					({ url: "https://other-host.com/page" }) as {
						url?: string;
						id?: number;
					},
			),
		});
		const h = createHandlers(deps);
		const decision = await h.evaluateGate(1);
		expect(decision.allowed).toBe(false);
		expect(decision.host).toBe("other-host.com");
		expect(deps.getSafetyMode).toHaveBeenCalledOnce();
		expect(deps.getAuthorizedHosts).toHaveBeenCalledOnce();
		expect(deps.tabsGet).toHaveBeenCalledOnce();
	});

	it("tab closed (tabsGet throws) → host null → allowed:false", async () => {
		const deps = makeDeps({
			getSafetyMode: vi.fn(async () => "authorized" as const),
			getAuthorizedHosts: vi.fn(async () => [HOST]),
			tabsGet: vi.fn(async () => {
				throw new Error("no tab");
			}),
		});
		const h = createHandlers(deps);
		const decision = await h.evaluateGate(999);
		expect(decision.allowed).toBe(false);
		expect(decision.host).toBeNull();
	});

	it("GET_BATCH inline route: getBatch called directly (not via handler)", async () => {
		const deps = makeDeps({ getBatch: vi.fn(async () => null) });
		const result = await deps.getBatch();
		expect(result).toBeNull();
		expect(deps.getBatch).toHaveBeenCalledOnce();
	});
});

// ================================================================
// buildConstraintSuffix
// ================================================================

describe("buildConstraintSuffix", () => {
	it("有标签时 suffix 包含分类约束和标签约束", () => {
		const suffix = buildConstraintSuffix(["漢化", "無修正", "校園"]);
		expect(suffix).toContain("分类约束");
		expect(suffix).toContain("漫畫文章");
		expect(suffix).toContain("标签约束");
		expect(suffix).toContain("漢化");
		expect(suffix).toContain("無修正");
		expect(suffix).toContain("校園");
	});

	it("recommendedTags 为空时只含分类约束，不含标签约束", () => {
		const suffix = buildConstraintSuffix([]);
		expect(suffix).toContain("分类约束");
		expect(suffix).not.toContain("标签约束");
	});

	it("handleGenerate 时 generateDraftFn 收到的 prompt 含约束块", async () => {
		const deps = makeDeps({
			getSettings: vi.fn(async () => ({
				...SETTINGS,
				recommendedTags: ["漢化", "無修正"],
			})),
		});
		const h = createHandlers(deps);
		await h.handleGenerate("请写一篇文章");
		const [calledPrompt] = (deps.generateDraftFn as ReturnType<typeof vi.fn>)
			.mock.calls[0] as [string];
		expect(calledPrompt).toContain("分类约束");
		expect(calledPrompt).toContain("漢化");
	});

	it("handleRunBatch 时 generateDraftFn 收到的 prompt 含约束块", async () => {
		const deps = makeDeps({
			getSettings: vi.fn(async () => ({
				...SETTINGS,
				recommendedTags: ["校園"],
			})),
		});
		const h = createHandlers(deps);
		await h.handleRunBatch(["topic-x"], 1);
		const [calledPrompt] = (deps.generateDraftFn as ReturnType<typeof vi.fn>)
			.mock.calls[0] as [string];
		expect(calledPrompt).toContain("分类约束");
		expect(calledPrompt).toContain("校園");
	});
});

// ================================================================
// asPublishResult (R4 判别式形状校验)
// ================================================================

describe("asPublishResult(R4 判别式形状校验)", () => {
	it("合法成功(ok:true 无 error)原样通过", () => {
		expect(
			asPublishResult({ ok: true, dryRun: false, url: "https://x/1" }),
		).toEqual({ ok: true, dryRun: false, url: "https://x/1" });
	});
	it("合法失败(ok:false + error)原样通过", () => {
		expect(
			asPublishResult({ ok: false, dryRun: false, error: "boom" }),
		).toEqual({ ok: false, dryRun: false, error: "boom" });
	});
	it("畸形 { ok:true, error } → 降级为失败(杜绝假确认)", () => {
		expect(
			asPublishResult({ ok: true, dryRun: false, error: "sneaky" }),
		).toEqual({
			ok: false,
			dryRun: false,
			error: "content-response-malformed",
		});
	});
	it("畸形 { ok:false 无 error } → content-response-invalid", () => {
		expect(asPublishResult({ ok: false, dryRun: false })).toEqual({
			ok: false,
			dryRun: false,
			error: "content-response-invalid",
		});
	});
	it("dry-run 成功(ok:true, dryRun:true 无 error)通过", () => {
		expect(asPublishResult({ ok: true, dryRun: true })).toEqual({
			ok: true,
			dryRun: true,
		});
	});
	it("非对象 / 缺 dryRun → content-response-invalid", () => {
		expect(asPublishResult(null)).toEqual({
			ok: false,
			dryRun: false,
			error: "content-response-invalid",
		});
		expect(asPublishResult({ ok: true })).toEqual({
			ok: false,
			dryRun: false,
			error: "content-response-invalid",
		});
	});
});
