// @vitest-environment jsdom

import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FeedbackWidget } from "./FeedbackWidget";

vi.mock("../../../../lib/publish-feedback", () => ({
	getFeedbackForItem: vi.fn(async () => undefined),
	saveFeedback: vi.fn(async () => {}),
}));

import {
	getFeedbackForItem,
	saveFeedback,
} from "../../../../lib/publish-feedback";

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("FeedbackWidget", () => {
	it("renders rating buttons", () => {
		render(<FeedbackWidget itemId="item_0" topic="测试选题" />);
		expect(screen.getByTitle("不错")).toBeTruthy();
		expect(screen.getByTitle("一般")).toBeTruthy();
		expect(screen.getByTitle("需改进")).toBeTruthy();
	});

	it("no feedback initially → no 已评分", () => {
		render(<FeedbackWidget itemId="item_0" topic="测试选题" />);
		expect(screen.queryByText("已评分")).toBeNull();
	});

	it("loads existing feedback on mount → shows 已评分", async () => {
		vi.mocked(getFeedbackForItem).mockResolvedValueOnce({
			itemId: "item_0",
			topic: "测试",
			rating: "good",
			ts: "2026-01-01T00:00:00Z",
		});
		render(<FeedbackWidget itemId="item_0" topic="测试" />);
		await waitFor(() => expect(screen.getByText("已评分")).toBeTruthy());
	});

	it("loads feedback with note → shows note", async () => {
		vi.mocked(getFeedbackForItem).mockResolvedValueOnce({
			itemId: "item_0",
			topic: "测试",
			rating: "ok",
			ts: "2026-01-01T00:00:00Z",
			note: "这条评价备注",
		});
		render(<FeedbackWidget itemId="item_0" topic="测试" />);
		await waitFor(() => expect(screen.getByText("这条评价备注")).toBeTruthy());
	});

	it("clicking rating → saves feedback and shows 已评分", async () => {
		render(<FeedbackWidget itemId="item_0" topic="测试选题" />);
		fireEvent.click(screen.getByTitle("不错"));
		await waitFor(() => expect(screen.getByText("已评分")).toBeTruthy());
		expect(saveFeedback).toHaveBeenCalledWith(
			expect.objectContaining({ rating: "good", itemId: "item_0" }),
		);
	});
});
