// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { deriveFewShotExamples, validateMapping } from "./Settings";

describe("validateMapping", () => {
	it("合法映射通过", () => {
		const text = JSON.stringify({
			title: { selector: 'input[name="title"]', fieldType: "text" },
		});
		expect(validateMapping(text)).toBeNull();
	});

	it("非法 JSON → 报错", () => {
		expect(validateMapping("{ not json")).toMatch(/JSON 格式错误/);
	});

	it("顶层是数组 → 报错", () => {
		expect(validateMapping("[]")).toMatch(/必须是一个对象/);
	});

	it("缺 selector → 报错", () => {
		expect(
			validateMapping(JSON.stringify({ title: { fieldType: "text" } })),
		).toMatch(/缺少有效的 selector/);
	});

	it("非法 fieldType → 报错", () => {
		expect(
			validateMapping(
				JSON.stringify({ title: { selector: "#x", fieldType: "bogus" } }),
			),
		).toMatch(/fieldType 非法/);
	});
});

describe("deriveFewShotExamples", () => {
	it("空列表 → 空字符串", () => {
		expect(deriveFewShotExamples([])).toBe("");
	});

	it("单条 → input\\n---\\noutput", () => {
		expect(deriveFewShotExamples([{ input: "Q1", output: "A1" }])).toBe(
			"Q1\n---\nA1",
		);
	});

	it("多条 → 条间 \\n\\n 分隔", () => {
		const result = deriveFewShotExamples([
			{ input: "Q1", output: "A1" },
			{ input: "Q2", output: "A2" },
		]);
		expect(result).toBe("Q1\n---\nA1\n\nQ2\n---\nA2");
	});

	it("input/output 含换行 → 保留原样", () => {
		const result = deriveFewShotExamples([
			{ input: "line1\nline2", output: "out" },
		]);
		expect(result).toBe("line1\nline2\n---\nout");
	});
});
