// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BatchItem } from "../../../../lib/batch";
import { ReviewableItemsList } from "./ReviewableItemsList";

vi.mock("./FeedbackWidget", () => ({ FeedbackWidget: () => null }));

afterEach(cleanup);

const noop = vi.fn();
const emptySet = new Set<string>();

function makeDraft(overrides: Record<string, unknown> = {}) {
	return {
		id: "d1",
		title: "草稿标题",
		subtitle: "",
		body: "<p>正文</p>",
		category: "2",
		coverImageUrl: "",
		tags: [],
		description: "",
		postStatus: "0" as const,
		publishedAt: "",
		mediaId: "",
		status: "draft" as const,
		createdAt: "2026-01-01T00:00:00Z",
		...overrides,
	};
}

function makeItem(overrides: Partial<BatchItem> = {}): BatchItem {
	return {
		id: "item_0",
		topic: "测试选题",
		status: "awaiting-approval",
		draft: makeDraft(),
		...overrides,
	};
}

describe("ReviewableItemsList", () => {
	it("renders item count header", () => {
		render(
			<ReviewableItemsList
				items={[makeItem()]}
				readItems={emptySet}
				publishingItems={emptySet}
				onToggleRead={noop}
				onPublish={noop}
			/>,
		);
		expect(screen.getByText(/待发布/)).toBeTruthy();
	});

	it("item with draft.title → shows title", () => {
		render(
			<ReviewableItemsList
				items={[makeItem()]}
				readItems={emptySet}
				publishingItems={emptySet}
				onToggleRead={noop}
				onPublish={noop}
			/>,
		);
		expect(screen.getByText("草稿标题")).toBeTruthy();
	});

	it("item without draft → falls back to topic", () => {
		render(
			<ReviewableItemsList
				items={[makeItem({ draft: undefined })]}
				readItems={emptySet}
				publishingItems={emptySet}
				onToggleRead={noop}
				onPublish={noop}
			/>,
		);
		expect(screen.getByText("测试选题")).toBeTruthy();
	});

	it("unread item → shows 未读", () => {
		render(
			<ReviewableItemsList
				items={[makeItem()]}
				readItems={emptySet}
				publishingItems={emptySet}
				onToggleRead={noop}
				onPublish={noop}
			/>,
		);
		expect(screen.getByText("未读")).toBeTruthy();
	});

	it("read item → shows 已读", () => {
		render(
			<ReviewableItemsList
				items={[makeItem()]}
				readItems={new Set(["item_0"])}
				publishingItems={emptySet}
				onToggleRead={noop}
				onPublish={noop}
			/>,
		);
		expect(screen.getByText("已读")).toBeTruthy();
	});

	it("publishing item → shows 发布中…", () => {
		render(
			<ReviewableItemsList
				items={[makeItem()]}
				readItems={new Set(["item_0"])}
				publishingItems={new Set(["item_0"])}
				onToggleRead={noop}
				onPublish={noop}
			/>,
		);
		expect(screen.getByText("发布中…")).toBeTruthy();
	});

	it("publish-dispatched status → also shows 发布中…", () => {
		render(
			<ReviewableItemsList
				items={[makeItem({ status: "publish-dispatched" })]}
				readItems={new Set(["item_0"])}
				publishingItems={emptySet}
				onToggleRead={noop}
				onPublish={noop}
			/>,
		);
		expect(screen.getByText("发布中…")).toBeTruthy();
	});

	it("long body → shows preview with 查看全文 button", () => {
		const longBody = "A".repeat(250);
		render(
			<ReviewableItemsList
				items={[makeItem({ draft: makeDraft({ body: longBody }) })]}
				readItems={new Set(["item_0"])}
				publishingItems={emptySet}
				onToggleRead={noop}
				onPublish={noop}
			/>,
		);
		expect(screen.getByText("查看全文")).toBeTruthy();
	});

	it("long body expanded → shows 收起 button", async () => {
		const longBody = "A".repeat(250);
		render(
			<ReviewableItemsList
				items={[makeItem({ draft: makeDraft({ body: longBody }) })]}
				readItems={new Set(["item_0"])}
				publishingItems={emptySet}
				onToggleRead={noop}
				onPublish={noop}
			/>,
		);
		fireEvent.click(screen.getByText("查看全文"));
		expect(screen.getByText("收起")).toBeTruthy();
	});

	it("item with subtitle → shows subtitle", () => {
		render(
			<ReviewableItemsList
				items={[makeItem({ draft: makeDraft({ subtitle: "副标题文本" }) })]}
				readItems={emptySet}
				publishingItems={emptySet}
				onToggleRead={noop}
				onPublish={noop}
			/>,
		);
		expect(screen.getByText("副标题文本")).toBeTruthy();
	});

	it("item without subtitle → no subtitle paragraph", () => {
		render(
			<ReviewableItemsList
				items={[makeItem({ draft: makeDraft({ subtitle: "" }) })]}
				readItems={emptySet}
				publishingItems={emptySet}
				onToggleRead={noop}
				onPublish={noop}
			/>,
		);
		// Just check no crash
		expect(screen.getByText("草稿标题")).toBeTruthy();
	});

	it("onApproveAll + allRead (≥2 items, all read) → shows 全部发布 button", () => {
		const items = [
			makeItem({ id: "i0" }),
			makeItem({ id: "i1", topic: "选题B" }),
		];
		const readItems = new Set(["i0", "i1"]);
		render(
			<ReviewableItemsList
				items={items}
				readItems={readItems}
				publishingItems={emptySet}
				onToggleRead={noop}
				onPublish={noop}
				onApproveAll={noop}
			/>,
		);
		expect(screen.getByText("全部发布")).toBeTruthy();
	});

	it("onApproveAll + not allRead → no 全部发布 button", () => {
		const items = [
			makeItem({ id: "i0" }),
			makeItem({ id: "i1", topic: "选题B" }),
		];
		render(
			<ReviewableItemsList
				items={items}
				readItems={new Set(["i0"])} // only 1 of 2 read
				publishingItems={emptySet}
				onToggleRead={noop}
				onPublish={noop}
				onApproveAll={noop}
			/>,
		);
		expect(screen.queryByText("全部发布")).toBeNull();
	});

	it("no onApproveAll → no 全部发布 button even if all read", () => {
		const items = [
			makeItem({ id: "i0" }),
			makeItem({ id: "i1", topic: "选题B" }),
		];
		render(
			<ReviewableItemsList
				items={items}
				readItems={new Set(["i0", "i1"])}
				publishingItems={emptySet}
				onToggleRead={noop}
				onPublish={noop}
			/>,
		);
		expect(screen.queryByText("全部发布")).toBeNull();
	});

	it("only 1 item (allRead=false even if read) → no 全部发布", () => {
		render(
			<ReviewableItemsList
				items={[makeItem()]}
				readItems={new Set(["item_0"])}
				publishingItems={emptySet}
				onToggleRead={noop}
				onPublish={noop}
				onApproveAll={noop}
			/>,
		);
		expect(screen.queryByText("全部发布")).toBeNull();
	});

	it("item without draft.body → bodyText is empty, no 查看全文", () => {
		render(
			<ReviewableItemsList
				items={[makeItem({ draft: makeDraft({ body: undefined }) })]}
				readItems={new Set(["item_0"])}
				publishingItems={emptySet}
				onToggleRead={noop}
				onPublish={noop}
			/>,
		);
		expect(screen.queryByText("查看全文")).toBeNull();
	});
});
