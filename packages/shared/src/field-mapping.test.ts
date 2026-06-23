import { describe, expect, it } from "vitest";
import {
	DEFAULT_FIELD_MAPPING,
	isValidFieldMapping,
	VALID_FIELD_TYPES,
} from "./field-mapping.js";

describe("isValidFieldMapping", () => {
	it("returns true for DEFAULT_FIELD_MAPPING", () => {
		expect(isValidFieldMapping(DEFAULT_FIELD_MAPPING)).toBe(true);
	});

	it("returns false for null/undefined/primitive", () => {
		expect(isValidFieldMapping(null)).toBe(false);
		expect(isValidFieldMapping(undefined)).toBe(false);
		expect(isValidFieldMapping("string")).toBe(false);
		expect(isValidFieldMapping(42)).toBe(false);
	});

	it("returns false for array", () => {
		expect(isValidFieldMapping([])).toBe(false);
	});

	it("returns false when a field has missing selector", () => {
		const bad = { title: { fieldType: "text" } };
		expect(isValidFieldMapping(bad)).toBe(false);
	});

	it("returns false when selector is empty string", () => {
		const bad = { title: { selector: "", fieldType: "text" } };
		expect(isValidFieldMapping(bad)).toBe(false);
	});

	it("returns false when fieldType is unknown", () => {
		const bad = {
			title: { selector: 'input[name="title"]', fieldType: "unknown-type" },
		};
		expect(isValidFieldMapping(bad)).toBe(false);
	});

	it("returns true for a minimal valid entry", () => {
		const good = { title: { selector: 'input[name="t"]', fieldType: "text" } };
		expect(isValidFieldMapping(good)).toBe(true);
	});

	it("accepts all VALID_FIELD_TYPES", () => {
		for (const ft of VALID_FIELD_TYPES) {
			const mapping = { f: { selector: "#x", fieldType: ft } };
			expect(isValidFieldMapping(mapping), `fieldType=${ft}`).toBe(true);
		}
	});
});

describe("DEFAULT_FIELD_MAPPING", () => {
	it("has expected core fields", () => {
		const keys = Object.keys(DEFAULT_FIELD_MAPPING);
		for (const k of [
			"title",
			"subtitle",
			"body",
			"tags",
			"description",
			"category",
		]) {
			expect(keys, `missing field: ${k}`).toContain(k);
		}
	});

	it("body field uses quill type", () => {
		expect(DEFAULT_FIELD_MAPPING.body.fieldType).toBe("quill");
	});

	it("tags field uses checkbox-multi type", () => {
		expect(DEFAULT_FIELD_MAPPING.tags.fieldType).toBe("checkbox-multi");
	});
});
