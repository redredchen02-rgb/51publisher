// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BatchItem } from "../../../../lib/batch";
import { BatchResultSections } from "./BatchResultSections";

vi.mock("./FeedbackWidget", () => ({
	FeedbackWidget: () => null,
}));

afterEach(cleanup);

const onRetry = vi.fn();

function makeItem(overrides: Partial<BatchItem> = {}): BatchItem {
	return {
		id: "item_0",
		topic: "测试选题",
		status: "gate-failed",
		...overrides,
	};
}

const empty: BatchItem[] = [];

describe("BatchResultSections", () => {
	it("all empty → renders nothing", () => {
		const { container } = render(
			<BatchResultSections
				gateFailedItems={empty}
				needsVerificationItems={empty}
				confirmedItems={empty}
				terminalOtherItems={empty}
				onRetry={onRetry}
			/>,
		);
		expect(container.firstChild).toBeNull();
	});

	describe("gateFailedItems", () => {
		it("item with no reason → no reason paragraph, no hint", () => {
			render(
				<BatchResultSections
					gateFailedItems={[makeItem({ gateFailReason: undefined })]}
					needsVerificationItems={empty}
					confirmedItems={empty}
					terminalOtherItems={empty}
					onRetry={onRetry}
				/>,
			);
			expect(screen.getByText("内容问题")).toBeTruthy();
			expect(screen.getByText("测试选题")).toBeTruthy();
			expect(screen.getByText("重新生成")).toBeTruthy();
		});

		it("item with 待補 reason → shows reason + 待補 hint", () => {
			render(
				<BatchResultSections
					gateFailedItems={[makeItem({ gateFailReason: "标题含【待補】占位" })]}
					needsVerificationItems={empty}
					confirmedItems={empty}
					terminalOtherItems={empty}
					onRetry={onRetry}
				/>,
			);
			expect(screen.getByText("标题含【待補】占位")).toBeTruthy();
			expect(screen.getByText(/提示：草稿含【待補】佔位符/)).toBeTruthy();
		});

		it("item with placeholder reason → 待補 hint", () => {
			render(
				<BatchResultSections
					gateFailedItems={[
						makeItem({ gateFailReason: "placeholder missing" }),
					]}
					needsVerificationItems={empty}
					confirmedItems={empty}
					terminalOtherItems={empty}
					onRetry={onRetry}
				/>,
			);
			expect(screen.getByText(/提示：草稿含【待補】佔位符/)).toBeTruthy();
		});

		it("item with 連結 reason → link hint", () => {
			render(
				<BatchResultSections
					gateFailedItems={[makeItem({ gateFailReason: "缺少連結来源" })]}
					needsVerificationItems={empty}
					confirmedItems={empty}
					terminalOtherItems={empty}
					onRetry={onRetry}
				/>,
			);
			expect(screen.getByText(/提示：缺少來源鏈接/)).toBeTruthy();
		});

		it("item with 来源 reason → link hint", () => {
			render(
				<BatchResultSections
					gateFailedItems={[makeItem({ gateFailReason: "缺少来源链接" })]}
					needsVerificationItems={empty}
					confirmedItems={empty}
					terminalOtherItems={empty}
					onRetry={onRetry}
				/>,
			);
			expect(screen.getByText(/提示：缺少來源鏈接/)).toBeTruthy();
		});

		it("item with 重複 reason → duplicate hint", () => {
			render(
				<BatchResultSections
					gateFailedItems={[makeItem({ gateFailReason: "内容重複" })]}
					needsVerificationItems={empty}
					confirmedItems={empty}
					terminalOtherItems={empty}
					onRetry={onRetry}
				/>,
			);
			expect(screen.getByText(/提示：內容與已發布帖子高度相似/)).toBeTruthy();
		});

		it("item with duplicate reason → duplicate hint", () => {
			render(
				<BatchResultSections
					gateFailedItems={[makeItem({ gateFailReason: "duplicate content" })]}
					needsVerificationItems={empty}
					confirmedItems={empty}
					terminalOtherItems={empty}
					onRetry={onRetry}
				/>,
			);
			expect(screen.getByText(/提示：內容與已發布帖子高度相似/)).toBeTruthy();
		});

		it("item with other reason → reason shown, no hint", () => {
			render(
				<BatchResultSections
					gateFailedItems={[makeItem({ gateFailReason: "其他错误" })]}
					needsVerificationItems={empty}
					confirmedItems={empty}
					terminalOtherItems={empty}
					onRetry={onRetry}
				/>,
			);
			expect(screen.getByText("其他错误")).toBeTruthy();
			expect(screen.queryByText(/提示：/)).toBeNull();
		});
	});

	describe("needsVerificationItems", () => {
		it("item with draft.title → shows draft title", () => {
			render(
				<BatchResultSections
					gateFailedItems={empty}
					needsVerificationItems={[
						makeItem({
							status: "needs-human-verification",
							draft: {
								id: "d1",
								title: "草稿标题",
								body: "",
								subtitle: "",
								category: "2",
								coverImageUrl: "",
								tags: [],
								description: "",
								postStatus: "0",
								publishedAt: "",
								mediaId: "",
								status: "draft",
								createdAt: "",
							},
						}),
					]}
					confirmedItems={empty}
					terminalOtherItems={empty}
					onRetry={onRetry}
				/>,
			);
			expect(screen.getByText("需人工核实")).toBeTruthy();
			expect(screen.getByText("草稿标题")).toBeTruthy();
		});

		it("item without draft → falls back to topic", () => {
			render(
				<BatchResultSections
					gateFailedItems={empty}
					needsVerificationItems={[
						makeItem({ status: "needs-human-verification" }),
					]}
					confirmedItems={empty}
					terminalOtherItems={empty}
					onRetry={onRetry}
				/>,
			);
			expect(screen.getByText("测试选题")).toBeTruthy();
		});
	});

	describe("confirmedItems", () => {
		it("item with draft.title → shows draft title + 已发布", () => {
			render(
				<BatchResultSections
					gateFailedItems={empty}
					needsVerificationItems={empty}
					confirmedItems={[
						makeItem({
							status: "filled",
							draft: {
								id: "d1",
								title: "发布标题",
								body: "",
								subtitle: "",
								category: "2",
								coverImageUrl: "",
								tags: [],
								description: "",
								postStatus: "0",
								publishedAt: "",
								mediaId: "",
								status: "draft",
								createdAt: "",
							},
						}),
					]}
					terminalOtherItems={empty}
					onRetry={onRetry}
				/>,
			);
			expect(screen.getByText("已发布")).toBeTruthy();
			expect(screen.getByText("发布标题")).toBeTruthy();
		});

		it("item without draft → falls back to topic", () => {
			render(
				<BatchResultSections
					gateFailedItems={empty}
					needsVerificationItems={empty}
					confirmedItems={[makeItem({ status: "filled" })]}
					terminalOtherItems={empty}
					onRetry={onRetry}
				/>,
			);
			expect(screen.getByText("测试选题")).toBeTruthy();
		});
	});

	describe("terminalOtherItems", () => {
		it("item with error → shows error text", () => {
			render(
				<BatchResultSections
					gateFailedItems={empty}
					needsVerificationItems={empty}
					confirmedItems={empty}
					terminalOtherItems={[
						makeItem({ status: "error", error: "超时错误" }),
					]}
					onRetry={onRetry}
				/>,
			);
			expect(screen.getByText("出错/中止")).toBeTruthy();
			expect(screen.getByText("超时错误")).toBeTruthy();
		});

		it("item without error → only topic shown", () => {
			render(
				<BatchResultSections
					gateFailedItems={empty}
					needsVerificationItems={empty}
					confirmedItems={empty}
					terminalOtherItems={[makeItem({ status: "aborted" })]}
					onRetry={onRetry}
				/>,
			);
			expect(screen.getByText("测试选题")).toBeTruthy();
		});
	});
});
