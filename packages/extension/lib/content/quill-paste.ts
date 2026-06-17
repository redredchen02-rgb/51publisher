// 主世界写入逻辑(纯函数,注入 window/document 便于测试)。
// U0 勘查:目标后台 window.Quill 2.0.2 全局可用、vanilla(非受控)→ 走 tier ①。
import { sanitizeBody } from "../safety/sanitize";

interface QuillInstance {
	clipboard?: { dangerouslyPasteHTML?: (html: string) => void };
	setText?: (text: string) => void;
}
interface QuillStatic {
	find?: (node: Element) => unknown;
}

export interface PasteResult {
	ok: boolean;
	error?: string;
	/** true 表示走了 tier ② 降级(质量较差)。 */
	degraded?: boolean;
}

function asInstance(v: unknown): QuillInstance | null {
	return v && typeof v === "object" ? (v as QuillInstance) : null;
}

/**
 * 把已消毒 HTML 写入 Quill。
 * tier ①:window.Quill.find(node).clipboard.dangerouslyPasteHTML(html)(确认可用)。
 * tier ②(极端兜底):直接写 .ql-editor.innerHTML + dispatch input(质量较差,见 README)。
 */
export function pasteIntoQuill(
	html: string,
	selector: string,
	win: { Quill?: QuillStatic },
	doc: Document,
): PasteResult {
	const node = doc.querySelector(selector);
	if (!node) return { ok: false, error: `未找到编辑器:${selector}` };

	// tier ①
	const Quill = win.Quill;
	if (Quill && typeof Quill.find === "function") {
		const inst = asInstance(Quill.find(node));
		if (inst?.clipboard?.dangerouslyPasteHTML) {
			inst.setText?.(""); // 清空旧内容,避免追加
			inst.clipboard.dangerouslyPasteHTML(html);
			return { ok: true };
		}
	}

	// tier ②:兜底 — 纵深防御:即使上游已消毒, innerHTML 路径再过一遍
	const editor = node.classList.contains("ql-editor")
		? node
		: node.querySelector(".ql-editor");
	if (editor) {
		(editor as HTMLElement).innerHTML = sanitizeBody(html);
		editor.dispatchEvent(new Event("input", { bubbles: true }));
		return { ok: true, degraded: true };
	}

	return {
		ok: false,
		error: "Quill 实例与 .ql-editor 均不可用,正文需手动粘贴。",
	};
}
