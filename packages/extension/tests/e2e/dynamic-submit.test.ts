// @vitest-environment jsdom
// D2(R9):动态提交盲区。e2e 既有零提交断言守程序提交/submit 事件/按钮 click,
// 但「真后台某字段挂 blur/keydown 自动提交」这条向量此前只靠人工冒烟兜底。
//
// fillers 设计上只派发 input/change,绝不派发 keydown/Enter(见 lib/fillers.ts:17)。
// 本 spec 把这条设计约束钉成自动断言:
//   - 挂 blur/keydown 自动提交 handler → 填充流程绝不触发(submit=0)。
//   - 自检(反例):挂 change 自动提交 handler → 填充确实会触发(submit>0),
//     证明插桩有效、断言非假绿。

import type { ContentDraft } from "@51publisher/shared";
import { DEFAULT_FIELD_MAPPING } from "@51publisher/shared";
import { afterEach, describe, expect, it } from "vitest";
import { requestBodyFill } from "../../lib/body-bridge";
import { installBodyResponder } from "../../lib/body-responder";
import { fillDraft } from "../../lib/fillers";
import { sanitizeBody } from "../../lib/sanitize";
import { attachAutoSubmitOn } from "./helpers/dynamic-submit";
import { loadFixture } from "./helpers/quill-fixture";
import { installSubmitSpy } from "./helpers/zero-submit";

function makeDraft(): ContentDraft {
	return {
		id: "d2-1",
		title: "AI 标题",
		subtitle: "AI 副标题",
		category: "2",
		coverImageUrl: "",
		body: "<p>正文 <strong>加粗</strong></p>",
		tags: ["奇幻", "校園"],
		description: "描述摘要",
		postStatus: "1",
		publishedAt: "2026-06-04",
		mediaId: "12345",
		status: "draft",
		createdAt: "2026-06-04T00:00:00.000Z",
	};
}

const microtask = () => Promise.resolve();

describe("D2 动态提交盲区(合成自动提交 handler)", () => {
	let uninstall: (() => void) | null = null;
	let detach: (() => void) | null = null;

	afterEach(() => {
		detach?.();
		detach = null;
		uninstall?.();
		uninstall = null;
		document.body.innerHTML = "";
	});

	async function runFillWithAutoSubmit(eventTypes: string[]) {
		const { document: doc, window: win, form, publishButton } = loadFixture();
		uninstall = installBodyResponder(doc, win, doc);
		const probe = attachAutoSubmitOn(form, eventTypes);
		detach = probe.restore;
		const spy = installSubmitSpy(form, publishButton);
		const draft = makeDraft();
		fillDraft(draft, DEFAULT_FIELD_MAPPING, doc);
		await requestBodyFill(sanitizeBody(draft.body), "#editor", 3000, doc);
		await microtask();
		return spy;
	}

	it("blur 自动提交 handler → 填充流程零提交", async () => {
		const spy = await runFillWithAutoSubmit(["blur"]);
		expect(spy.submitCount()).toBe(0);
	});

	it("keydown 自动提交 handler → 填充流程零提交", async () => {
		const spy = await runFillWithAutoSubmit(["keydown"]);
		expect(spy.submitCount()).toBe(0);
	});

	it("blur+keydown 同挂 → 仍零提交", async () => {
		const spy = await runFillWithAutoSubmit(["blur", "keydown"]);
		expect(spy.submitCount()).toBe(0);
	});

	it("自检(反例):change 自动提交 handler → 填充会触发(submit>0),证明插桩有效", async () => {
		const spy = await runFillWithAutoSubmit(["change"]);
		// fillers 设计上派发 change(给 layui/Quill 拾取值),所以 change-提交 handler
		// 会被触发——这正说明:零提交不变量依赖「目标后台不在 change 上自动提交」。
		// 若此断言变成 0,说明插桩失效(spy 没接上),需修测试而非放行。
		expect(spy.submitCount()).toBeGreaterThan(0);
	});
});
