// @vitest-environment jsdom

import { DEFAULT_FIELD_MAPPING } from "@51publisher/shared";
import { describe, expect, it } from "vitest";
import { checkSelectorDrift } from "./selectors";

describe("checkSelectorDrift", () => {
	it("全部选择器在场 → ok,无缺失", () => {
		document.body.innerHTML = `
      <input name="title" /><input name="subtitle" />
      <select name="type"></select><div id="editor"></div>
      <input name="tags[]" type="checkbox" />
      <textarea name="description"></textarea>
      <select name="status"></select>
      <input name="published_at" /><input name="media_id" />
      <input name="cover_url" />`;
		const r = checkSelectorDrift(document, DEFAULT_FIELD_MAPPING);
		expect(r.ok).toBe(true);
		expect(r.missing).toEqual([]);
	});

	it("缺正文编辑器 + 标题 → 报缺失 label", () => {
		document.body.innerHTML = `
      <input name="subtitle" /><select name="type"></select>
      <input name="tags[]" type="checkbox" /><textarea name="description"></textarea>
      <select name="status"></select><input name="published_at" /><input name="media_id" />`;
		const r = checkSelectorDrift(document, DEFAULT_FIELD_MAPPING);
		expect(r.ok).toBe(false);
		expect(r.missing).toContain("標題");
		expect(r.missing).toContain("文章内容");
	});

	it("空 document → 全缺失", () => {
		document.body.innerHTML = "";
		const r = checkSelectorDrift(document, DEFAULT_FIELD_MAPPING);
		expect(r.ok).toBe(false);
		expect(r.missing.length).toBeGreaterThanOrEqual(8);
	});

	it("mapping 含 null 值 → 跳过，不报缺失", () => {
		document.body.innerHTML = "";
		// null 值代表该字段未配置，应被跳过（line 20: if (!def) continue）
		const r = checkSelectorDrift(document, { title: null } as never);
		expect(r.ok).toBe(true);
		expect(r.missing).toEqual([]);
	});

	it("def.label 为 undefined → 回退到 selector 作为缺失标识", () => {
		document.body.innerHTML = "";
		// label 未设置时用 selector 文字（line 22: def.label ?? def.selector）
		const r = checkSelectorDrift(document, {
			title: { selector: "#my-title" },
		} as never);
		expect(r.ok).toBe(false);
		expect(r.missing).toContain("#my-title");
	});
});
