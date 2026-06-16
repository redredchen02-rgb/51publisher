// @vitest-environment jsdom
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/storage", () => ({
	getDryRunReport: vi.fn(),
	clearDryRunReport: vi.fn(),
}));

import { clearDryRunReport, getDryRunReport } from "../../lib/storage";
import { DryRunReport } from "./DryRunReport.js";

const mockGet = vi.mocked(getDryRunReport);
const mockClear = vi.mocked(clearDryRunReport);

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

function makeReport() {
	return {
		items: [
			{
				itemId: "i1",
				topic: "某作品",
				draftTitle: "草稿标题",
				fillResults: [
					{ status: "filled" },
					{ status: "filled" },
					{ status: "skipped" },
					{ status: "degraded" },
				],
			},
		],
	};
}

describe("DryRunReport", () => {
	it("无报告（storage 返回 null）→ 渲染为空", async () => {
		mockGet.mockResolvedValueOnce(null as never);
		const { container } = render(<DryRunReport />);
		await waitFor(() => expect(mockGet).toHaveBeenCalled());
		expect(container.textContent).toBe("");
	});

	it("有报告 → 渲染条目数、标题与 已填/跳过/降级 计数", async () => {
		mockGet.mockResolvedValueOnce(makeReport() as never);
		render(<DryRunReport />);
		// 标题含条目数
		expect(await screen.findByText(/预演填充报告（1 条）/)).toBeTruthy();
		expect(screen.getByText("标题: 草稿标题")).toBeTruthy();
		expect(screen.getByText("✓已填 2")).toBeTruthy();
		expect(screen.getByText("↷跳过 1")).toBeTruthy();
		expect(screen.getByText("⚠降级 1")).toBeTruthy();
	});

	it("点击清除报告 → 调 clearDryRunReport 并清空视图", async () => {
		mockGet.mockResolvedValueOnce(makeReport() as never);
		mockClear.mockResolvedValueOnce(undefined as never);
		const { container } = render(<DryRunReport />);
		const btn = await screen.findByText("清除报告");
		fireEvent.click(btn);
		await waitFor(() => expect(mockClear).toHaveBeenCalledOnce());
		await waitFor(() => expect(container.textContent).toBe(""));
	});
});
