import { describe, expect, it, vi } from "vitest";
import {
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
});
