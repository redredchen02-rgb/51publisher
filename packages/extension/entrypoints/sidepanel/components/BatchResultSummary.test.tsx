// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BatchResultSummary } from "./BatchResultSummary";

describe("BatchResultSummary", () => {
	afterEach(() => {
		cleanup();
	});

	it("renders success count", () => {
		const results = [
			{ id: "1", success: true },
			{ id: "2", success: true },
			{ id: "3", success: false },
		];

		render(<BatchResultSummary results={results} />);

		expect(screen.getByText("成功: 2")).toBeTruthy();
	});

	it("renders failure count", () => {
		const results = [
			{ id: "1", success: true },
			{ id: "2", success: false },
			{ id: "3", success: false },
		];

		render(<BatchResultSummary results={results} />);

		expect(screen.getByText("失败: 2")).toBeTruthy();
	});

	it("renders total count", () => {
		const results = [
			{ id: "1", success: true },
			{ id: "2", success: false },
			{ id: "3", success: true },
		];

		render(<BatchResultSummary results={results} />);

		expect(screen.getByText("总计: 3")).toBeTruthy();
	});

	it("shows success rate", () => {
		const results = [
			{ id: "1", success: true },
			{ id: "2", success: true },
			{ id: "3", success: true },
			{ id: "4", success: false },
		];

		render(<BatchResultSummary results={results} />);

		expect(screen.getByText("成功率: 75%")).toBeTruthy();
	});

	it("shows empty state", () => {
		render(<BatchResultSummary results={[]} />);

		expect(screen.getByText("暂无操作结果")).toBeTruthy();
	});
});
