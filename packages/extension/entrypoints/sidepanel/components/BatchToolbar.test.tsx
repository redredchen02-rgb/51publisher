// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BatchToolbar } from "./BatchToolbar";

describe("BatchToolbar", () => {
	afterEach(() => {
		cleanup();
	});

	it("renders with selection count", () => {
		render(
			<BatchToolbar
				selectedCount={3}
				totalCount={10}
				isProcessing={false}
				onSelectAll={vi.fn()}
				onClearSelection={vi.fn()}
				onApprove={vi.fn()}
				onDiscard={vi.fn()}
			/>,
		);

		expect(screen.getByText("已选择 3/10 项")).toBeTruthy();
	});

	it("shows select all button", () => {
		const onSelectAll = vi.fn();
		render(
			<BatchToolbar
				selectedCount={0}
				totalCount={10}
				isProcessing={false}
				onSelectAll={onSelectAll}
				onClearSelection={vi.fn()}
				onApprove={vi.fn()}
				onDiscard={vi.fn()}
			/>,
		);

		fireEvent.click(screen.getByText("全选"));
		expect(onSelectAll).toHaveBeenCalled();
	});

	it("shows approve button when items selected", () => {
		const onApprove = vi.fn();
		render(
			<BatchToolbar
				selectedCount={3}
				totalCount={10}
				isProcessing={false}
				onSelectAll={vi.fn()}
				onClearSelection={vi.fn()}
				onApprove={onApprove}
				onDiscard={vi.fn()}
			/>,
		);

		fireEvent.click(screen.getByText("批量批准"));
		expect(onApprove).toHaveBeenCalled();
	});

	it("disables buttons when processing", () => {
		render(
			<BatchToolbar
				selectedCount={3}
				totalCount={10}
				isProcessing={true}
				onSelectAll={vi.fn()}
				onClearSelection={vi.fn()}
				onApprove={vi.fn()}
				onDiscard={vi.fn()}
			/>,
		);

		expect(screen.getByText("全选")).toBeTruthy();
		expect(screen.getAllByText("处理中...")).toHaveLength(2);
	});

	it("shows progress during processing", () => {
		render(
			<BatchToolbar
				selectedCount={3}
				totalCount={10}
				isProcessing={true}
				progress={50}
				onSelectAll={vi.fn()}
				onClearSelection={vi.fn()}
				onApprove={vi.fn()}
				onDiscard={vi.fn()}
			/>,
		);

		expect(screen.getByText("处理进度: 50%")).toBeTruthy();
	});
});
