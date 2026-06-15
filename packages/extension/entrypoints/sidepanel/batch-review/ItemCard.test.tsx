// @vitest-environment jsdom

import type {
	BatchItem,
	ContentDraft,
	DraftSlots,
	FactsBlock,
} from "@51publisher/shared";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ItemCard } from "./ItemCard";

// ItemCard 的 U6 缺失事实补全编辑器(替代 prompt() 全局替换)行为测试。

const SLOTS: DraftSlots = {
	titleSuffix: " 成人動畫介紹",
	subtitle: "一句俏皮话",
	intro: "51娘 开场白。",
	highlights: "看点散文。",
};

function draft(over: Partial<ContentDraft> = {}): ContentDraft {
	return {
		id: "d1",
		title: "【待补】",
		subtitle: "",
		category: "2",
		coverImageUrl: "",
		body: "<p>正文</p>",
		tags: [],
		description: "摘要",
		postStatus: "0",
		publishedAt: "",
		mediaId: "1",
		status: "draft",
		createdAt: "2026-06-04T00:00:00.000Z",
		...over,
	};
}

/** 构造一个 gate-failed 条目。facts 决定哪些槽位为空(=可补)。 */
function gateFailedItem(
	facts: FactsBlock,
	opts: { slots?: DraftSlots | undefined } = {},
): BatchItem {
	return {
		id: "item_0",
		topic: "里番A",
		status: "gate-failed",
		gateFailReason: "标题含【待补】",
		slots: "slots" in opts ? opts.slots : SLOTS,
		facts,
		draft: draft(),
		assembledDraftSnapshot: draft(),
	};
}

function baseProps() {
	return {
		expanded: true,
		onToggle: vi.fn(),
		discardPickerId: null,
		setDiscardPickerId: vi.fn(),
		discardReason: "other" as const,
		setDiscardReason: vi.fn(),
	};
}

describe("ItemCard 缺失事实补全编辑器(U6)", () => {
	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
	});

	it("Happy:缺 作品名/集数 → 渲染两个有标签的输入;填两值 + 提交派发 refillItemFacts(独立值);预览显示替换后标题", () => {
		const onRefillFacts = vi.fn();
		// 仅 作品名/集数 为空,其余事实槽位已填 → 只渲染两个输入。
		const item = gateFailedItem({
			制作: "studio X",
			漢化: "https://hh.example.com/a",
			無修: "https://wx.example.com/a",
			简介: "intro text",
		});
		render(
			<ItemCard {...baseProps()} item={item} onRefillFacts={onRefillFacts} />,
		);

		const nameInput = screen.getByLabelText("补全 作品名");
		const epInput = screen.getByLabelText("补全 集数");
		expect(nameInput).toBeTruthy();
		expect(epInput).toBeTruthy();
		// 不应渲染已填字段的输入。
		expect(screen.queryByLabelText("补全 简介")).toBeNull();

		fireEvent.change(nameInput, { target: { value: "某神作" } });
		fireEvent.change(epInput, { target: { value: "第3集" } });

		// 预览标题应反映替换后的值(distinct 值未坍缩)。
		expect(screen.getByLabelText("预览标题").textContent).toContain("某神作");

		fireEvent.click(screen.getByText("提交补全"));
		expect(onRefillFacts).toHaveBeenCalledTimes(1);
		expect(onRefillFacts).toHaveBeenCalledWith("item_0", {
			作品名: "某神作",
			集数: "第3集",
		});
	});

	it("Edge:空白输入阻断提交 + 内联错误;输入后取消触发丢弃确认", () => {
		const onRefillFacts = vi.fn();
		const item = gateFailedItem({
			制作: "s",
			漢化: "https://hh.example.com/a",
			無修: "https://wx.example.com/a",
			简介: "i",
		});
		render(
			<ItemCard {...baseProps()} item={item} onRefillFacts={onRefillFacts} />,
		);

		// 仅填空白 → 提交被阻断,显示内联提示。
		fireEvent.change(screen.getByLabelText("补全 作品名"), {
			target: { value: "   " },
		});
		expect(screen.getByText(/请填写全部/)).toBeTruthy();
		const commit = screen.getByText("提交补全") as HTMLButtonElement;
		expect(commit.disabled).toBe(true);
		fireEvent.click(commit);
		expect(onRefillFacts).not.toHaveBeenCalled();

		// 输入后取消 → 弹出丢弃确认。
		fireEvent.change(screen.getByLabelText("补全 集数"), {
			target: { value: "3" },
		});
		const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
		fireEvent.click(screen.getByText("取消"));
		expect(confirmSpy).toHaveBeenCalledOnce();
	});

	it("Edge:散文占位(无可填事实槽位)→ 显示需重新生成,不显示事实输入", () => {
		const onRefillFacts = vi.fn();
		const onRetryItem = vi.fn();
		// 所有事实槽位均已填 → emptyFactSlots 为空 → prose-only 兜底。
		const item = gateFailedItem({
			作品名: "已填",
			集数: "1",
			制作: "s",
			漢化: "https://hh.example.com/a",
			無修: "https://wx.example.com/a",
			简介: "i",
		});
		render(
			<ItemCard
				{...baseProps()}
				item={item}
				onRefillFacts={onRefillFacts}
				onRetryItem={onRetryItem}
			/>,
		);

		expect(screen.queryByLabelText("补全 作品名")).toBeNull();
		expect(screen.getByText("需重新生成")).toBeTruthy();
		fireEvent.click(screen.getByText("需重新生成"));
		expect(onRetryItem).toHaveBeenCalledWith("item_0");
	});

	it("Edge:无 slots 旧条目 → 需重新生成兜底", () => {
		const onRetryItem = vi.fn();
		const item = gateFailedItem({}, { slots: undefined });
		render(
			<ItemCard
				{...baseProps()}
				item={item}
				onRefillFacts={vi.fn()}
				onRetryItem={onRetryItem}
			/>,
		);
		expect(screen.queryByLabelText("补全 作品名")).toBeNull();
		expect(screen.getByText("需重新生成")).toBeTruthy();
	});

	it("Error:非法 URL 事实(http://)→ 内联校验错误,提交被禁用", () => {
		const onRefillFacts = vi.fn();
		// 漢化 为空 → 可填;输入非 https URL 触发 reassembleWithFacts 的 R8 拒因。
		const item = gateFailedItem({
			作品名: "x",
			集数: "1",
			制作: "s",
			無修: "https://wx.example.com/a",
			简介: "i",
		});
		render(
			<ItemCard {...baseProps()} item={item} onRefillFacts={onRefillFacts} />,
		);

		fireEvent.change(screen.getByLabelText(/补全 漢化/), {
			target: { value: "http://insecure.example.com/a" },
		});
		expect(screen.getByLabelText("重组装校验失败")).toBeTruthy();
		expect((screen.getByText("提交补全") as HTMLButtonElement).disabled).toBe(
			true,
		);
		fireEvent.click(screen.getByText("提交补全"));
		expect(onRefillFacts).not.toHaveBeenCalled();
	});

	it("prompt() 路径已移除:渲染编辑器期间不调用 window.prompt", () => {
		const promptSpy = vi.spyOn(window, "prompt");
		const item = gateFailedItem({
			制作: "s",
			漢化: "https://hh.example.com/a",
			無修: "https://wx.example.com/a",
			简介: "i",
		});
		render(<ItemCard {...baseProps()} item={item} onRefillFacts={vi.fn()} />);
		fireEvent.change(screen.getByLabelText("补全 作品名"), {
			target: { value: "n" },
		});
		fireEvent.change(screen.getByLabelText("补全 集数"), {
			target: { value: "1" },
		});
		fireEvent.click(screen.getByText("提交补全"));
		expect(promptSpy).not.toHaveBeenCalled();
	});
});
