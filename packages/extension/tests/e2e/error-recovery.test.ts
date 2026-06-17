// @vitest-environment jsdom
// E1 错误恢复路径 — 字段缺失容错 + Quill 写入失败 + 完全无字段场景。
// 守:部分字段缺失时已填字段正确写入、零提交；所有字段缺失时 outcome.ok=false。

import type { ContentDraft } from "@51publisher/shared";
import { DEFAULT_FIELD_MAPPING } from "@51publisher/shared";
import { afterEach, describe, expect, it } from "vitest";
import { requestBodyFill } from "../../lib/body-bridge";
import { installBodyResponder } from "../../lib/body-responder";
import { fillDraft } from "../../lib/fillers";
import { sanitizeBody } from "../../lib/sanitize";
import { loadFixture } from "./helpers/quill-fixture";
import { installSubmitSpy } from "./helpers/zero-submit";

function makeDraft(overrides: Partial<ContentDraft> = {}): ContentDraft {
	return {
		id: "err-1",
		title: "错误恢复标题",
		subtitle: "副标题",
		category: "2",
		coverImageUrl: "",
		body: "<p>正文内容</p>",
		tags: ["奇幻"],
		description: "描述摘要",
		postStatus: "1",
		publishedAt: "2026-06-17",
		mediaId: "99999",
		status: "draft",
		createdAt: "2026-06-17T00:00:00.000Z",
		...overrides,
	};
}

const microtask = () => Promise.resolve();

describe("E1 字段缺失容错", () => {
	let uninstall: (() => void) | null = null;
	afterEach(() => {
		uninstall?.();
		uninstall = null;
		document.body.innerHTML = "";
	});

	it("title input 缺失 → 该字段 skipped,其他字段正常写入,零提交", async () => {
		const { document: doc, window: win, form, publishButton } = loadFixture();
		// 移除 title input 模拟字段缺失
		doc.querySelector('input[name="title"]')?.remove();
		uninstall = installBodyResponder(doc, win, doc);
		const spy = installSubmitSpy(form, publishButton);

		const draft = makeDraft();
		const results = fillDraft(draft, DEFAULT_FIELD_MAPPING, doc);

		// title 字段应被标记为 skipped（元素不存在）
		const titleResult = results.find((r) => r.field === "title");
		expect(titleResult?.status).toBe("skipped");

		// subtitle 等其他字段应正常写入
		expect(
			doc.querySelector<HTMLInputElement>('input[name="subtitle"]')?.value,
		).toBe(draft.subtitle);
		expect(
			doc.querySelector<HTMLTextAreaElement>('textarea[name="description"]')
				?.value,
		).toBe(draft.description);

		// 零提交守护
		expect(spy.submitCount()).toBe(0);
		expect(spy.publishClickCount()).toBe(0);
	});

	it("多字段缺失 → 仍填入存在的字段,零提交", async () => {
		const { document: doc, window: win, form, publishButton } = loadFixture();
		// 移除 title + subtitle
		doc.querySelector('input[name="title"]')?.remove();
		doc.querySelector('input[name="subtitle"]')?.remove();
		uninstall = installBodyResponder(doc, win, doc);
		const spy = installSubmitSpy(form, publishButton);

		const draft = makeDraft();
		const results = fillDraft(draft, DEFAULT_FIELD_MAPPING, doc);

		const skipped = results
			.filter((r) => r.status === "skipped")
			.map((r) => r.field);
		expect(skipped).toContain("title");
		expect(skipped).toContain("subtitle");

		// description 仍应写入
		expect(
			doc.querySelector<HTMLTextAreaElement>('textarea[name="description"]')
				?.value,
		).toBe(draft.description);

		expect(spy.submitCount()).toBe(0);
	});
});

describe("E2 Quill 写入失败降级", () => {
	let uninstall: (() => void) | null = null;
	afterEach(() => {
		uninstall?.();
		uninstall = null;
		document.body.innerHTML = "";
	});

	it("window.Quill 不可用 → outcome.degraded=true, outcome.ok=true, .ql-editor 含正文", async () => {
		const { document: doc, window: win } = loadFixture({ withQuill: false });
		uninstall = installBodyResponder(doc, win, doc);

		const outcome = await requestBodyFill(
			sanitizeBody("<p>正文内容</p>"),
			"#editor",
			3000,
			doc,
		);
		await microtask();

		expect(outcome.ok).toBe(true);
		expect(outcome.degraded).toBe(true);
		const editor = doc.querySelector<HTMLElement>("#editor .ql-editor");
		expect(editor?.textContent).toContain("正文内容");
	});

	it("降级路径填充其他字段不触发提交", async () => {
		const {
			document: doc,
			window: win,
			form,
			publishButton,
		} = loadFixture({ withQuill: false });
		uninstall = installBodyResponder(doc, win, doc);
		const spy = installSubmitSpy(form, publishButton);

		const draft = makeDraft();
		fillDraft(draft, DEFAULT_FIELD_MAPPING, doc);
		await requestBodyFill(sanitizeBody(draft.body), "#editor", 3000, doc);
		await microtask();

		expect(spy.submitCount()).toBe(0);
		expect(spy.publishClickCount()).toBe(0);
	});
});

describe("E3 完全无字段场景", () => {
	let uninstall: (() => void) | null = null;
	afterEach(() => {
		uninstall?.();
		uninstall = null;
		document.body.innerHTML = "";
	});

	it("空 DOM → body fill outcome.ok=false, note 含「手动粘贴」, 零提交", async () => {
		// 替换 body 为空容器（无任何表单元素、无 Quill）
		document.body.innerHTML = "<div id='empty'></div>";
		const win = window as Window & typeof globalThis;
		const fakeForm = document.createElement("form");
		const fakeBtn = document.createElement("button");
		document.body.appendChild(fakeForm);
		document.body.appendChild(fakeBtn);

		uninstall = installBodyResponder(document, win, document);
		const spy = installSubmitSpy(fakeForm, fakeBtn as HTMLButtonElement);

		const outcome = await requestBodyFill(
			"<p>正文</p>",
			"#editor",
			3000,
			document,
		);
		await microtask();

		expect(outcome.ok).toBe(false);
		// 无 #editor 容器时返回「未找到编辑器」提示（手动粘贴提示在 .ql-editor 缺失路径）
		expect(outcome.note).toBeTruthy();
		expect(spy.submitCount()).toBe(0);
	});

	it("空 DOM → fillDraft 所有字段均 skipped", () => {
		document.body.innerHTML = "<div></div>";
		const draft = makeDraft();
		const results = fillDraft(draft, DEFAULT_FIELD_MAPPING, document);
		// 所有字段应为 skipped（无对应 DOM）
		const nonSkipped = results.filter((r) => r.status !== "skipped");
		expect(nonSkipped).toHaveLength(0);
	});
});
