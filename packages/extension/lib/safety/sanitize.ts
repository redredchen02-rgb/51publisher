import DOMPurify from "dompurify";
import { DEFAULT_RECIPE } from "../core/recipe";

// 正文 HTML 在写入 Quill 前必须消毒:LLM 是最不可信输入,
// dangerouslyPasteHTML 会在页面主世界(登录态后台 origin)执行任意脚本。
// 白名单只放 Quill 实际支持的格式标签。
//
// v1 基线硬化(完整 mXSS round-trip + CSS 外泄模型 = U9b,随自主档):
//   - 禁 data:/javascript:/vbscript: 与协议相对 URI;
//   - 剥绝对/远程 src(防 <img src> 自动加载把登录态 origin 的请求外泄),
//     href 保留远程 https(点击才触发,且漢化/無修链接是站点核心);
//   - <a target=_blank> 自动补 rel=noopener noreferrer;
//   - 钉定 DOMPurify 版本(版本/配置漂移须触发测试复核)。

/** 钉定版本:升级 DOMPurify 须同步复核白名单与 mXSS 语料后改此值。 */
export const PINNED_DOMPURIFY_VERSION = "3.4.10";

// 白名单单一来源 = SiteRecipe(lib/recipe.ts)。
const ALLOWED_TAGS = DEFAULT_RECIPE.sanitize.allowedTags;
const ALLOWED_ATTR = DEFAULT_RECIPE.sanitize.allowedAttr;

// 只允许 https / mailto / 锚点 / 真·相对路径;显式排除 data:、javascript:、
// vbscript: 与协议相对(//host)。比放行 http: 更紧(登录态 origin 防降级/外泄)。
const SAFE_URI_REGEXP =
	/^(?:https:\/\/|mailto:|tel:|#|\/(?!\/)|[a-z0-9._~%+-]+(?:[/?#]|$))/i;

// src 视为"远程/绝对"则剥:带 scheme(http:/https:/data:/...)或协议相对(//)。
// 仅放行真·相对与根相对路径(/uploads/x.jpg)。
function isRemoteOrAbsoluteSrc(value: string): boolean {
	const v = value.trim();
	return /^[a-z][a-z0-9+.-]*:/i.test(v) || v.startsWith("//");
}

let hooksInstalled = false;
function installHooks(): void {
	if (hooksInstalled) return;
	hooksInstalled = true;

	// 剥远程/绝对 src:防自动加载型外泄(href 不在此列,点击才触发)。
	DOMPurify.addHook("uponSanitizeAttribute", (_node, data) => {
		if (data.attrName === "src" && isRemoteOrAbsoluteSrc(data.attrValue)) {
			data.keepAttr = false;
		}
	});

	// 外链补 rel=noopener noreferrer(防 window.opener 反向控制 + referrer 外泄)。
	DOMPurify.addHook("afterSanitizeAttributes", (node) => {
		if (
			node.nodeName === "A" &&
			node instanceof Element &&
			node.getAttribute("target") === "_blank"
		) {
			node.setAttribute("rel", "noopener noreferrer");
		}
	});
}

/** 按白名单消毒正文 HTML。剥 script/iframe/事件处理器/危险 URI/远程 src 等。 */
export function sanitizeBody(html: string): string {
	installHooks();
	return DOMPurify.sanitize(html, {
		ALLOWED_TAGS,
		ALLOWED_ATTR,
		ALLOWED_URI_REGEXP: SAFE_URI_REGEXP,
	});
}
