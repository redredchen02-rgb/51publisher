// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pasteIntoQuill } from "./quill-paste";

beforeEach(() => {
	document.body.innerHTML = `<div id="editor" class="ql-container"><div class="ql-editor" contenteditable="true"></div></div>`;
});

describe("pasteIntoQuill", () => {
	it("tier ①:window.Quill.find 拿到实例 → dangerouslyPasteHTML 被调用", () => {
		const paste = vi.fn();
		const setText = vi.fn();
		const node = document.querySelector("#editor")!;
		const win = {
			Quill: {
				find: vi.fn((n: Element) =>
					n === node
						? { clipboard: { dangerouslyPasteHTML: paste }, setText }
						: null,
				),
			},
		};
		const res = pasteIntoQuill("<p>正文</p>", "#editor", win, document);
		expect(res.ok).toBe(true);
		expect(res.degraded).toBeUndefined();
		expect(setText).toHaveBeenCalledWith("");
		expect(paste).toHaveBeenCalledWith("<p>正文</p>");
	});

	it("未找到编辑器节点 → ok:false", () => {
		const res = pasteIntoQuill(
			"<p>x</p>",
			"#nope",
			{ Quill: { find: () => null } },
			document,
		);
		expect(res.ok).toBe(false);
		expect(res.error).toMatch(/未找到编辑器/);
	});

	it("无 window.Quill 但有 .ql-editor → tier ② 兜底写入", () => {
		const res = pasteIntoQuill("<p>兜底</p>", "#editor", {}, document);
		expect(res.ok).toBe(true);
		expect(res.degraded).toBe(true);
		expect(document.querySelector(".ql-editor")?.innerHTML).toBe("<p>兜底</p>");
	});

	it("既无 Quill 也无 .ql-editor → ok:false", () => {
		document.body.innerHTML = `<div id="editor"></div>`;
		const res = pasteIntoQuill("<p>x</p>", "#editor", {}, document);
		expect(res.ok).toBe(false);
		expect(res.error).toMatch(/手动粘贴/);
	});

	it("Quill.find 返回无 clipboard 的对象 → 落到 tier ② 兜底", () => {
		const win = { Quill: { find: () => ({}) } };
		const res = pasteIntoQuill("<p>兜底</p>", "#editor", win, document);
		expect(res.ok).toBe(true);
		expect(res.degraded).toBe(true);
	});
});
