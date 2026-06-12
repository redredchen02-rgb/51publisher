import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Quill from "quill";

// 把 fixture HTML 加载进 jsdom 的 document,并(可选)在 #editor 上挂真 Quill。
// e2e 用它复现「页面已初始化 Quill」的状态,再驱动 lib/ 的纯填充逻辑。
// 注:jsdom 环境下 import.meta.url 是 http scheme,故用 cwd(测试从项目根跑)解析 fixture。

const FIXTURE_HTML = readFileSync(
	resolve(process.cwd(), "tests/e2e/fixtures/webarticle-add.html"),
	"utf-8",
);

function bodyInner(html: string): string {
	const m = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
	return m?.[1] ?? html;
}

export interface LoadedFixture {
	window: Window & typeof globalThis;
	document: Document;
	/** 真 Quill 实例(withQuill=true 时)。 */
	quill: Quill | null;
	form: HTMLFormElement;
	publishButton: HTMLButtonElement;
}

/**
 * 加载 fixture。
 * - withQuill=true(默认,U3 tier① 路径):window.Quill = Quill 且 new Quill('#editor') 构造编辑器。
 * - withQuill=false(U4 tier② 降级):仍构造 Quill 以生成 .ql-editor DOM,
 *   然后删除 window.Quill —— 模拟「编辑器 DOM 在,但本世界拿不到 window.Quill」。
 */
export function loadFixture(opts: { withQuill?: boolean } = {}): LoadedFixture {
	const withQuill = opts.withQuill ?? true;

	document.body.innerHTML = bodyInner(FIXTURE_HTML);
	const win = window as Window & typeof globalThis;

	(win as unknown as { Quill: typeof Quill }).Quill = Quill;
	const quill = new Quill("#editor", { theme: "snow" });

	if (!withQuill) {
		// 保留 Quill 生成的 .ql-editor DOM,但移除 window.Quill,逼 pasteIntoQuill 走 tier②。
		delete (win as unknown as { Quill?: typeof Quill }).Quill;
	}

	const form = document.querySelector<HTMLFormElement>("#webarticle-form");
	const publishButton =
		document.querySelector<HTMLButtonElement>("#pfa-publish");
	if (!form || !publishButton) {
		throw new Error(
			"fixture 缺少 #webarticle-form 或 #pfa-publish,fixture 可能损坏",
		);
	}

	return {
		window: win,
		document,
		quill: withQuill ? quill : null,
		form,
		publishButton,
	};
}
