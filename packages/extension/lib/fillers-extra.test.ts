// @vitest-environment jsdom

import type { ContentDraft, FieldDefinition } from "@51publisher/shared";
import { describe, expect, it } from "vitest";
import { fillField } from "./fillers";

const DRAFT: ContentDraft = {
	id: "d1",
	title: "标题",
	subtitle: "副标题",
	category: "2",
	coverImageUrl: "",
	body: "<p>正文</p>",
	tags: ["奇幻"],
	description: "摘要",
	postStatus: "1",
	publishedAt: "2026-06-03",
	mediaId: "123",
	status: "draft",
	createdAt: "2026-06-03T00:00:00.000Z",
};

describe("fillers — extra branch coverage", () => {
	// fillTextLike catch branch (L47): invalid selector → skip
	it("fillTextLike: invalid selector syntax → skipped with 选择器语法错误", () => {
		document.body.innerHTML = '<input name="title" />';
		const badDef: FieldDefinition = {
			selector: "input[invalid=",
			fieldType: "text",
		};
		const res = fillField("title", badDef, DRAFT, document);
		expect(res?.status).toBe("skipped");
		expect(res?.note).toContain("选择器语法错误");
	});

	// fillNativeSelect catch branch (L66): invalid selector → skip
	it("fillNativeSelect: invalid selector syntax → skipped with 选择器语法错误", () => {
		document.body.innerHTML =
			'<select name="type"><option value="2">X</option></select>';
		const badDef: FieldDefinition = {
			selector: "select[invalid=",
			fieldType: "native-select",
		};
		const res = fillField("category", badDef, DRAFT, document);
		expect(res?.status).toBe("skipped");
		expect(res?.note).toContain("选择器语法错误");
	});

	// fillNativeSelect: custom-dropdown fieldType also routes through fillNativeSelect
	it("fillNativeSelect: custom-dropdown selector not found → skipped", () => {
		document.body.innerHTML = "";
		const def: FieldDefinition = {
			selector: 'select[name="nonexistent"]',
			fieldType: "custom-dropdown",
		};
		const res = fillField("category", def, DRAFT, document);
		expect(res?.status).toBe("skipped");
	});

	// labelTextFor: box.id present, label[for=...] found
	it("labelTextFor: label found via id/for attribute → label text used for matching", () => {
		// checkbox with id="cb1", label[for="cb1"] exists
		document.body.innerHTML = `
			<input type="checkbox" name="tags[]" id="cb1" value="v1" />
			<label for="cb1">奇幻</label>
		`;
		const def: FieldDefinition = {
			selector: 'input[name="tags[]"]',
			fieldType: "checkbox-multi",
		};
		const res = fillField("tags", def, DRAFT, document);
		expect(res?.status).toBe("filled");
		const box = document.querySelector<HTMLInputElement>("#cb1");
		expect(box?.checked).toBe(true);
	});

	// labelTextFor: next sibling is LABEL (no id on checkbox)
	it("labelTextFor: next sibling is LABEL tag → text used for matching", () => {
		// checkbox without id, next sibling is <label>
		document.body.innerHTML = `
			<input type="checkbox" name="tags[]" value="v1" /><label>奇幻</label>
		`;
		const def: FieldDefinition = {
			selector: 'input[name="tags[]"]',
			fieldType: "checkbox-multi",
		};
		const res = fillField("tags", def, DRAFT, document);
		expect(res?.status).toBe("filled");
	});

	// labelTextFor: checkbox wrapped in <label> (closest label)
	it("labelTextFor: checkbox inside <label> → parent label text used", () => {
		// checkbox inside a <label> (no id, no adjacent label)
		document.body.innerHTML = `
			<label><input type="checkbox" name="tags[]" value="v1" />奇幻</label>
		`;
		const def: FieldDefinition = {
			selector: 'input[name="tags[]"]',
			fieldType: "checkbox-multi",
		};
		const res = fillField("tags", def, DRAFT, document);
		expect(res?.status).toBe("filled");
	});

	// labelTextFor: already checked → does NOT fire change event again (box.checked branch)
	it("fillCheckboxMulti: already checked box → still returns filled (no double-fire)", () => {
		document.body.innerHTML = `
			<input type="checkbox" name="tags[]" id="cb2" value="v1" checked /><label for="cb2">奇幻</label>
		`;
		const def: FieldDefinition = {
			selector: 'input[name="tags[]"]',
			fieldType: "checkbox-multi",
		};
		const res = fillField("tags", def, DRAFT, document);
		expect(res?.status).toBe("filled");
	});

	// tag-input fieldType: routes through fillCheckboxMulti
	it("fillField: tag-input fieldType → routes through fillCheckboxMulti", () => {
		document.body.innerHTML = `
			<input type="checkbox" name="tags[]" id="cb3" value="v1" /><label for="cb3">奇幻</label>
		`;
		const def: FieldDefinition = {
			selector: 'input[name="tags[]"]',
			fieldType: "tag-input",
		};
		const res = fillField("tags", def, DRAFT, document);
		expect(res?.status).toBe("filled");
	});
});
