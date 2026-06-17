import type { FieldMapping } from "@51guapi/shared";

// 后台可能把发帖表单装进**同源 iframe**(layuiAdmin:内容区是 /admin/.../index iframe),
// 而 content script(隔离世界)与正文桥(主世界)默认只在**顶层文档**找元素
// → 表单字段全部「未找到」。这里把「表单所在的 frame」解析出来:
//   顶层有就用顶层;否则下钻一层同源子 iframe;都没有 → 退回顶层(调用方按「未找到」降级,保持原行为)。
// 纯函数 + 注入 root,便于单测。仅向下一层(本后台 content iframe 是顶层直接子级);
// 跨源 iframe 无法访问其 contentDocument → 跳过。

// win 用 `Window | { Quill?: unknown }`:隔离世界只用 doc;主世界桥用 win 取 window.Quill,
// 并自行 cast 成 pasteIntoQuill 期望的类型。这样顶层 window、iframe.contentWindow、测试假 win 都可直接传入
//(纯 `{ Quill? }` 弱类型会触发 TS"与 Window 无共同属性"报错,故保留 Window 成员)。
export interface ResolvedFrame {
	doc: Document;
	win: Window | { Quill?: unknown };
}

/** 收集顶层文档下可访问(同源)的所有子 iframe 的 document/window (递归直到 maxDepth)。 */
function childFrames(rootDoc: Document, maxDepth: number = 3): ResolvedFrame[] {
	if (maxDepth <= 0) return [];
	const out: ResolvedFrame[] = [];
	for (const frame of Array.from(rootDoc.querySelectorAll("iframe"))) {
		try {
			const doc = frame.contentDocument;
			const win = frame.contentWindow;
			if (doc && win) {
				out.push({ doc, win });
				out.push(...childFrames(doc, maxDepth - 1));
			}
		} catch {
			// 跨源 iframe:contentDocument 抛 SecurityError → 跳过。
		}
	}
	return out;
}

/** 找到含有 `selector` 的 frame(顶层优先,再下钻递归同源 iframe)。找不到 → 退回顶层。 */
export function resolveFrameForSelector(
	rootDoc: Document,
	selector: string,
	rootWin: Window | { Quill?: unknown },
): ResolvedFrame {
	if (rootDoc.querySelector(selector)) return { doc: rootDoc, win: rootWin };
	for (const frame of childFrames(rootDoc)) {
		if (frame.doc.querySelector(selector)) return frame;
	}
	return { doc: rootDoc, win: rootWin };
}

/**
 * 按字段映射给每个 frame 打分(命中的选择器数),取最高分的 frame。
 * 用于普通字段填充 / 漂移检测 / 发布序列化——比单选择器更稳(单个字段偶发缺失不会误判 frame)。
 */
export function resolveFormFrame(
	rootDoc: Document,
	mapping: FieldMapping,
	rootWin: Window | { Quill?: unknown },
): ResolvedFrame {
	const selectors = Object.values(mapping)
		.filter((d): d is NonNullable<typeof d> => !!d)
		.map((d) => d.selector);
	const score = (doc: Document) =>
		selectors.reduce((n, s) => (doc.querySelector(s) ? n + 1 : n), 0);

	let best: ResolvedFrame = { doc: rootDoc, win: rootWin };
	let bestScore = score(rootDoc);
	for (const frame of childFrames(rootDoc)) {
		const s = score(frame.doc);
		if (s > bestScore) {
			best = frame;
			bestScore = s;
		}
	}
	return best;
}
