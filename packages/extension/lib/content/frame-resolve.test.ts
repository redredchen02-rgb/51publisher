// @vitest-environment jsdom

import type { FieldMapping } from "@51guapi/shared";
import { afterEach, describe, expect, it } from "vitest";
import { resolveFormFrame, resolveFrameForSelector } from "./frame-resolve";

// 造一个"同源 iframe":jsdom 不会真的加载 iframe,故用 defineProperty 注入
// contentDocument/contentWindow(模拟 layuiAdmin 把发帖表单装进同源 iframe 的情形)。
function appendFakeIframe(
	innerHTML: string,
	win: { Quill?: unknown } = { Quill: "iframe-quill" },
): void {
	const ifr = document.createElement("iframe");
	const idoc = document.implementation.createHTMLDocument("");
	idoc.body.innerHTML = innerHTML;
	Object.defineProperty(ifr, "contentDocument", {
		get: () => idoc,
		configurable: true,
	});
	Object.defineProperty(ifr, "contentWindow", {
		get: () => win,
		configurable: true,
	});
	document.body.appendChild(ifr);
}

function appendCrossOriginIframe(): void {
	const ifr = document.createElement("iframe");
	Object.defineProperty(ifr, "contentDocument", {
		get: () => {
			throw new Error("SecurityError: cross-origin");
		},
		configurable: true,
	});
	document.body.appendChild(ifr);
}

const MAPPING: FieldMapping = {
	title: { selector: 'input[name="title"]', fieldType: "text" },
	category: { selector: 'select[name="type"]', fieldType: "native-select" },
	body: { selector: "#editor", fieldType: "quill" },
};
const FORM_HTML =
	'<input name="title"><select name="type"></select><div id="editor"></div>';

afterEach(() => {
	document.body.innerHTML = "";
});

describe("resolveFrameForSelector", () => {
	it("顶层命中 → 返回顶层 doc/win(原样透传 rootWin)", () => {
		document.body.innerHTML = '<div id="editor"></div>';
		const rootWin = { Quill: "top" };
		const r = resolveFrameForSelector(document, "#editor", rootWin);
		expect(r.doc).toBe(document);
		expect(r.win).toBe(rootWin);
	});

	it("顶层缺失、同源 iframe 命中 → 返回该 iframe 的 doc/win", () => {
		document.body.innerHTML = ""; // 顶层无 #editor
		const iframeWin = { Quill: "iframe-quill" };
		appendFakeIframe('<div id="editor"></div>', iframeWin);
		const r = resolveFrameForSelector(document, "#editor", { Quill: "top" });
		expect(r.doc).not.toBe(document);
		expect(r.doc.querySelector("#editor")).not.toBeNull();
		expect(r.win).toBe(iframeWin); // 主世界据此取 iframe 的 window.Quill
	});

	it('哪儿都找不到 → 退回顶层(保持原"未找到"降级行为)', () => {
		document.body.innerHTML = "<p>no form</p>";
		const rootWin = { Quill: "top" };
		const r = resolveFrameForSelector(document, "#editor", rootWin);
		expect(r.doc).toBe(document);
		expect(r.win).toBe(rootWin);
	});

	it("多层嵌套 iframe → 递归下钻查找", () => {
		document.body.innerHTML = "";
		// 层 1
		const win1 = { Quill: "win1" };
		appendFakeIframe("", win1);
		const doc1 = document.querySelector("iframe")?.contentDocument!;
		// 层 2
		const win2 = { Quill: "win2" };
		const ifr2 = document.createElement("iframe");
		const idoc2 = document.implementation.createHTMLDocument("");
		idoc2.body.innerHTML = '<div id="deep-editor"></div>';
		Object.defineProperty(ifr2, "contentDocument", {
			get: () => idoc2,
			configurable: true,
		});
		Object.defineProperty(ifr2, "contentWindow", {
			get: () => win2,
			configurable: true,
		});
		doc1.body.appendChild(ifr2);

		const r = resolveFrameForSelector(document, "#deep-editor", {
			Quill: "top",
		});
		expect(r.doc).toBe(idoc2);
		expect(r.win).toBe(win2);
	});

	it("跨源 iframe 抛错 → 跳过,不崩溃", () => {
		document.body.innerHTML = "";
		appendCrossOriginIframe();
		appendFakeIframe('<div id="editor"></div>');
		const r = resolveFrameForSelector(document, "#editor", { Quill: "top" });
		expect(r.doc.querySelector("#editor")).not.toBeNull();
	});
});

describe("resolveFormFrame", () => {
	it("表单在同源 iframe 里 → 选中命中字段最多的 iframe(而非空顶层)", () => {
		document.body.innerHTML = "<div>空壳页面</div>";
		appendFakeIframe(FORM_HTML);
		const r = resolveFormFrame(document, MAPPING, { Quill: "top" });
		expect(r.doc).not.toBe(document);
		expect(r.doc.querySelector('input[name="title"]')).not.toBeNull();
	});

	it("表单在顶层 → 选中顶层(不被无关 iframe 抢走)", () => {
		document.body.innerHTML = FORM_HTML;
		appendFakeIframe("<p>无关</p>");
		const r = resolveFormFrame(document, MAPPING, { Quill: "top" });
		expect(r.doc).toBe(document);
	});

	it("顶层与 iframe 都无字段 → 退回顶层", () => {
		document.body.innerHTML = "<p>x</p>";
		const r = resolveFormFrame(document, MAPPING, { Quill: "top" });
		expect(r.doc).toBe(document);
	});
});
