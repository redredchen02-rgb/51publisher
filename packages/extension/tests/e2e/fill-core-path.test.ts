// @vitest-environment jsdom
// U3 核心填充路径 e2e + U4 降级路径(同一 spec)。
// 绕过 Side Panel,直接驱动 lib/ 的填充逻辑:
//   非正文 → fillDraft;正文 → 经隔离端 requestBodyFill ↔ MAIN 端 installBodyResponder 完整桥往返。
// 守:字段填对 + 正文进 Quill(过规范化)+ 消毒生效 + 零提交。

import type { ContentDraft } from "@51publisher/shared";
import { DEFAULT_FIELD_MAPPING } from "@51publisher/shared";
import { afterEach, describe, expect, it } from "vitest";
import { requestBodyFill } from "../../lib/body-bridge";
import { installBodyResponder } from "../../lib/body-responder";
import { fillDraft } from "../../lib/fillers";
import { sanitizeBody } from "../../lib/sanitize";
import { installFetchSubmitSpy } from "./helpers/authorized-submit";
import { loadFixture } from "./helpers/quill-fixture";
import { installSubmitSpy } from "./helpers/zero-submit";

function makeDraft(overrides: Partial<ContentDraft> = {}): ContentDraft {
	return {
		id: "e2e-1",
		title: "AI 标题",
		subtitle: "AI 副标题",
		category: "2",
		coverImageUrl: "",
		body: "<p>正文第一段 <strong>加粗</strong></p><p>第二段</p>",
		tags: ["奇幻", "校園"],
		description: "一段描述摘要",
		postStatus: "1",
		publishedAt: "2026-06-04",
		mediaId: "12345",
		status: "draft",
		createdAt: "2026-06-04T00:00:00.000Z",
		...overrides,
	};
}

const microtask = () => Promise.resolve();

describe("U3 核心填充路径(真 Quill)", () => {
	let uninstall: (() => void) | null = null;
	afterEach(() => {
		uninstall?.();
		uninstall = null;
		document.body.innerHTML = "";
	});

	async function runFill(draft: ContentDraft) {
		const { document: doc, window: win, form, publishButton } = loadFixture();
		uninstall = installBodyResponder(doc, win, doc);
		const spy = installSubmitSpy(form, publishButton);
		const results = fillDraft(draft, DEFAULT_FIELD_MAPPING, doc);
		const bodyOutcome = await requestBodyFill(
			sanitizeBody(draft.body),
			"#editor",
			3000,
			doc,
		);
		await microtask();
		return { doc, spy, results, bodyOutcome };
	}

	it("文本字段:title/subtitle/description/media_id/published_at 正确写入", async () => {
		const draft = makeDraft();
		const { doc } = await runFill(draft);
		expect(
			doc.querySelector<HTMLInputElement>('input[name="title"]')?.value,
		).toBe(draft.title);
		expect(
			doc.querySelector<HTMLInputElement>('input[name="subtitle"]')?.value,
		).toBe(draft.subtitle);
		expect(
			doc.querySelector<HTMLTextAreaElement>('textarea[name="description"]')
				?.value,
		).toBe(draft.description);
		expect(
			doc.querySelector<HTMLInputElement>('input[name="media_id"]')?.value,
		).toBe(draft.mediaId);
		expect(
			doc.querySelector<HTMLInputElement>('input[name="published_at"]')?.value,
		).toBe(draft.publishedAt);
	});

	it("下拉:type 选中 2、status 选中 1", async () => {
		const { doc } = await runFill(makeDraft());
		expect(
			doc.querySelector<HTMLSelectElement>('select[name="type"]')?.value,
		).toBe("2");
		expect(
			doc.querySelector<HTMLSelectElement>('select[name="status"]')?.value,
		).toBe("1");
	});

	it("标签:draft.tags 对应 checkbox 勾选,未列出的保持未选", async () => {
		const { doc } = await runFill(makeDraft({ tags: ["奇幻", "校園"] }));
		const checked = Array.from(
			doc.querySelectorAll<HTMLInputElement>('input[name="tags[]"]'),
		)
			.filter((b) => b.checked)
			.map((b) => b.id);
		expect(checked.sort()).toEqual(["tag_1", "tag_2"]); // 奇幻=tag_1, 校園=tag_2
		expect(doc.querySelector<HTMLInputElement>("#tag_3")?.checked).toBe(false); // 熱血未列出
	});

	it("正文:HTML 进真 Quill 的 .ql-editor,<strong> 保留", async () => {
		const { doc, bodyOutcome } = await runFill(makeDraft());
		expect(bodyOutcome.ok).toBe(true);
		expect(bodyOutcome.degraded).not.toBe(true);
		const editor = doc.querySelector<HTMLElement>("#editor .ql-editor")!;
		expect(editor.textContent).toContain("正文第一段");
		expect(editor.textContent).toContain("加粗");
		expect(editor.querySelector("strong")).toBeTruthy();
	});

	it("消毒:正文里的 <script> / onerror 不会进 .ql-editor", async () => {
		const draft = makeDraft({
			body: '<p>安全</p><script>alert(1)</script><img src=x onerror="alert(1)">',
		});
		const { doc } = await runFill(draft);
		const editor = doc.querySelector<HTMLElement>("#editor .ql-editor")!;
		expect(editor.querySelector("script")).toBeNull();
		expect(editor.innerHTML.toLowerCase()).not.toContain("onerror");
		expect(editor.innerHTML.toLowerCase()).not.toContain("<script");
	});

	it("off/dry-run 零提交:纯填充流程后 form submit=0、发布 click=0、save POST=0", async () => {
		const fetchSpy = installFetchSubmitSpy();
		try {
			const { spy } = await runFill(makeDraft());
			expect(spy.submitCount()).toBe(0);
			expect(spy.publishClickCount()).toBe(0);
			// 第 4 通道:填充流程绝不触发到 save 端点的 POST(真实提交路径)。
			expect(fetchSpy.submitCount()).toBe(0);
		} finally {
			fetchSpy.restore();
		}
	});
});

describe("U4 降级路径(window.Quill 不可用)", () => {
	let uninstall: (() => void) | null = null;
	afterEach(() => {
		uninstall?.();
		uninstall = null;
		document.body.innerHTML = "";
	});

	it("无 window.Quill → tier② 兜底写入,outcome.degraded:true,.ql-editor 含正文", async () => {
		const { document: doc, window: win } = loadFixture({ withQuill: false });
		uninstall = installBodyResponder(doc, win, doc);
		const draft = makeDraft();
		const outcome = await requestBodyFill(
			sanitizeBody(draft.body),
			"#editor",
			3000,
			doc,
		);
		await microtask();
		expect(outcome.ok).toBe(true);
		expect(outcome.degraded).toBe(true);
		const editor = doc.querySelector<HTMLElement>("#editor .ql-editor")!;
		expect(editor.textContent).toContain("正文第一段");
	});

	it("降级路径仍零提交", async () => {
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

	it("连 .ql-editor 都不存在(选择器全错)→ outcome.ok:false,note 提示手动粘贴,仍零提交", async () => {
		const {
			document: doc,
			window: win,
			form,
			publishButton,
		} = loadFixture({ withQuill: false });
		doc.querySelector("#editor .ql-editor")?.remove(); // 抹掉编辑器 DOM
		uninstall = installBodyResponder(doc, win, doc);
		const spy = installSubmitSpy(form, publishButton);
		const outcome = await requestBodyFill("<p>x</p>", "#editor", 3000, doc);
		await microtask();
		expect(outcome.ok).toBe(false);
		expect(outcome.note).toMatch(/手动粘贴/);
		expect(spy.submitCount()).toBe(0);
	});
});
