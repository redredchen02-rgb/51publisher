// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	type Batch,
	createBatch,
	markConfirmed,
	markDispatched,
	markFilled,
	markGenerating,
	presentForApproval,
	recoverBatch,
	storeFillResults,
} from "../../lib/batch";
import type { ContentDraft, SafetyMode } from "../../lib/types";
import { BatchReviewPanel } from "./BatchReviewPanel";

function draft(title: string): ContentDraft {
	return {
		id: `d_${title}`,
		title,
		subtitle: "",
		category: "2",
		coverImageUrl: "",
		body: "<p>正文</p>",
		tags: [],
		description: `${title} 摘要`,
		postStatus: "0",
		publishedAt: "",
		mediaId: "1",
		status: "draft",
		createdAt: "2026-06-04T00:00:00.000Z",
	};
}

function awaitingBatch(topics: string[]): Batch {
	let b = createBatch(
		"b1",
		9,
		"dx-999-adm.ympxbys.xyz",
		topics,
		"2026-06-04T00:00:00.000Z",
		(i) => `item_${i}`,
	);
	for (const it of b.items)
		b = markFilled(markGenerating(b, it.id), it.id, draft(it.topic));
	return presentForApproval(b);
}

function defaultProps(batch: Batch, mode: SafetyMode = "authorized") {
	return {
		batch,
		safetyMode: mode,
		authorizedHost: "dx-999-adm.ympxbys.xyz",
		tabHealthy: true,
		onApprove: vi.fn(),
		onKill: vi.fn(),
		onRelease: vi.fn(),
		onDriftCheck: vi.fn(),
		onResume: vi.fn(),
	};
}

describe("BatchReviewPanel", () => {
	afterEach(() => cleanup());

	it("摘要带 + 档位带 + 字面 host", () => {
		render(
			<BatchReviewPanel {...defaultProps(awaitingBatch(["A", "B", "C"]))} />,
		);
		expect(screen.getByText(/共 3 条/)).toBeTruthy();
		expect(screen.getByText(/待审 3/)).toBeTruthy();
		expect(
			screen.getAllByText(/dx-999-adm\.ympxbys\.xyz/).length,
		).toBeGreaterThan(0);
		expect(screen.getByLabelText(/发布档位 authorized/)).toBeTruthy();
	});

	it("authorized:批准需打字手势 publish,且二次确认插值 count+host", () => {
		const props = defaultProps(awaitingBatch(["A", "B"]));
		render(<BatchReviewPanel {...props} />);
		fireEvent.click(screen.getByText("批准发布 2 条"));
		// 二次确认弹窗插值
		expect(
			screen.getByText(/确定发布 2 条到 dx-999-adm\.ympxbys\.xyz/),
		).toBeTruthy();
		// 未打字 → 确认禁用
		const confirm = screen.getByText("确认") as HTMLButtonElement;
		expect(confirm.disabled).toBe(true);
		expect(props.onApprove).not.toHaveBeenCalled();
		// 打错 → 仍禁用
		fireEvent.change(screen.getByLabelText("输入 publish 确认"), {
			target: { value: "yes" },
		});
		expect((screen.getByText("确认") as HTMLButtonElement).disabled).toBe(true);
		// 打对 → 可确认
		fireEvent.change(screen.getByLabelText("输入 publish 确认"), {
			target: { value: "publish" },
		});
		fireEvent.click(screen.getByText("确认"));
		expect(props.onApprove).toHaveBeenCalledOnce();
	});

	it("dry-run:文案为预演,无需打字手势", () => {
		const props = defaultProps(awaitingBatch(["A"]), "dry-run");
		render(<BatchReviewPanel {...props} />);
		fireEvent.click(screen.getByText("预演 1 条"));
		expect(screen.getByText(/预演发布 1 条/)).toBeTruthy();
		fireEvent.click(screen.getByText("确认"));
		expect(props.onApprove).toHaveBeenCalledOnce();
	});

	it("off:不显示批准按钮(只填充不发布)", () => {
		render(<BatchReviewPanel {...defaultProps(awaitingBatch(["A"]), "off")} />);
		expect(screen.queryByText(/批准发布/)).toBeNull();
		expect(screen.queryByText(/预演/)).toBeNull();
	});

	it("隔离态:醒目独立表示 + 撤出隔离按钮", () => {
		let b = awaitingBatch(["里番A", "里番B"]);
		b = recoverBatch(markDispatched(b, "item_0")); // item_0 → 隔离
		const props = defaultProps(b);
		render(<BatchReviewPanel {...props} />);
		expect(screen.getByText(/1 条需人工核对/)).toBeTruthy();
		fireEvent.click(screen.getByText("我已核对,撤出隔离"));
		expect(props.onRelease).toHaveBeenCalledWith("item_0");
	});

	it("tab 漂移:阻断式暂停 + 继续按钮;不显示批准", () => {
		const props = { ...defaultProps(awaitingBatch(["A"])), tabHealthy: false };
		render(<BatchReviewPanel {...props} />);
		expect(screen.getByText(/批次已暂停/)).toBeTruthy();
		expect(screen.queryByText(/批准发布/)).toBeNull();
		fireEvent.click(screen.getByText("我已切回,继续"));
		expect(props.onResume).toHaveBeenCalledOnce();
	});

	it("急停 → onKill;条目状态有非颜色文字标签", () => {
		const props = defaultProps(awaitingBatch(["A"]));
		render(<BatchReviewPanel {...props} />);
		expect(screen.getByLabelText("状态 awaiting-approval")).toBeTruthy();
		expect(screen.getByText("[待审]")).toBeTruthy();
		fireEvent.click(screen.getByText("急停"));
		expect(props.onKill).toHaveBeenCalledOnce();
	});

	it("展开条目看草稿;漂移自检结果渲染", () => {
		const props = {
			...defaultProps(awaitingBatch(["番A"])),
			driftResult: { ok: false, missing: ["標題"] },
		};
		render(<BatchReviewPanel {...props} />);
		fireEvent.click(screen.getByText("番A"));
		expect(screen.getByText("番A 摘要")).toBeTruthy();
		expect(screen.getByText(/缺失:標題/)).toBeTruthy();
	});

	describe("Phase-2 degrade badge + few-shot (新增行为)", () => {
		it("批次完成且有降级 → 摘要行显示降级 badge", () => {
			let b = awaitingBatch(["A"]);
			b = storeFillResults(b, "item_0", [
				{ field: "category", status: "degraded" },
			]);
			// 推进到 done 状态
			b = markConfirmed(
				markDispatched(b, "item_0"),
				"item_0",
				"https://example.com/1",
			);
			render(<BatchReviewPanel {...defaultProps(b)} />);
			expect(screen.getByText(/1 条降级/)).toBeTruthy();
		});

		it("批次完成且所有字段 filled → 显示全部成功 banner", () => {
			let b = awaitingBatch(["A"]);
			b = storeFillResults(b, "item_0", [{ field: "title", status: "filled" }]);
			b = markConfirmed(
				markDispatched(b, "item_0"),
				"item_0",
				"https://example.com/1",
			);
			render(<BatchReviewPanel {...defaultProps(b)} />);
			expect(screen.getByText(/所有字段填充成功/)).toBeTruthy();
		});

		it("批次完成无 fillResults → 不显示降级相关 banner", () => {
			let b = awaitingBatch(["A"]);
			b = markConfirmed(
				markDispatched(b, "item_0"),
				"item_0",
				"https://example.com/1",
			);
			render(<BatchReviewPanel {...defaultProps(b)} />);
			expect(screen.queryByText(/所有字段填充成功/)).toBeNull();
			expect(screen.queryByText(/条目有字段降级/)).toBeNull();
		});

		it("条目有降级字段时展开行显示降级计数 badge", () => {
			let b = awaitingBatch(["A"]);
			b = storeFillResults(b, "item_0", [
				{ field: "category", status: "degraded" },
				{ field: "title", status: "filled" },
			]);
			render(<BatchReviewPanel {...defaultProps(b)} />);
			expect(screen.getByText(/1\/2 降级/)).toBeTruthy();
		});

		it("awaiting-approval 条目:onItemEdited 未传时不显示编辑复选框", () => {
			const b = awaitingBatch(["A"]);
			render(<BatchReviewPanel {...defaultProps(b)} />);
			fireEvent.click(screen.getByText("A"));
			expect(screen.queryByText("已手动修改草稿")).toBeNull();
		});

		it("awaiting-approval 条目:onItemEdited 传入时显示复选框;点击调 onItemEdited", () => {
			const onItemEdited = vi.fn();
			const b = awaitingBatch(["A"]);
			render(
				<BatchReviewPanel {...defaultProps(b)} onItemEdited={onItemEdited} />,
			);
			fireEvent.click(screen.getByText("A"));
			const checkbox = screen.getByRole("checkbox");
			fireEvent.click(checkbox);
			expect(onItemEdited).toHaveBeenCalledWith("item_0");
		});

		it("awaiting-approval 条目:userEdited=true 时复选框不重复触发 onItemEdited", () => {
			const onItemEdited = vi.fn();
			let b = awaitingBatch(["A"]);
			// 手动 patch userEdited=true
			b = { ...b, items: b.items.map((it) => ({ ...it, userEdited: true })) };
			render(
				<BatchReviewPanel {...defaultProps(b)} onItemEdited={onItemEdited} />,
			);
			fireEvent.click(screen.getByText("A"));
			const checkbox = screen.getByRole("checkbox");
			fireEvent.click(checkbox);
			expect(onItemEdited).not.toHaveBeenCalled();
		});

		it('publish-confirmed 条目:onSaveAsFewShot 传入时显示"存为范例"按钮', () => {
			const onSaveAsFewShot = vi.fn();
			let b = awaitingBatch(["A"]);
			b = markConfirmed(
				markDispatched(b, "item_0"),
				"item_0",
				"https://example.com/1",
			);
			render(
				<BatchReviewPanel
					{...defaultProps(b)}
					onSaveAsFewShot={onSaveAsFewShot}
				/>,
			);
			fireEvent.click(screen.getByText("A"));
			const btn = screen.getByText("存为范例");
			fireEvent.click(btn);
			expect(onSaveAsFewShot).toHaveBeenCalledWith("item_0");
		});

		it('publish-confirmed 条目:onSaveAsFewShot 未传时不显示"存为范例"按钮', () => {
			let b = awaitingBatch(["A"]);
			b = markConfirmed(
				markDispatched(b, "item_0"),
				"item_0",
				"https://example.com/1",
			);
			render(<BatchReviewPanel {...defaultProps(b)} />);
			fireEvent.click(screen.getByText("A"));
			expect(screen.queryByText("存为范例")).toBeNull();
		});
	});
});
