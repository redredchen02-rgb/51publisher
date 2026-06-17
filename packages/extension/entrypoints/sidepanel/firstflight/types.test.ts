import { describe, expect, it } from "vitest";
import { lastLabel } from "./types";

describe("lastLabel", () => {
	it("standard host with multiple parts → second-to-last segment", () => {
		expect(lastLabel("dx-999-adm.ympxbys.xyz")).toBe("ympxbys");
	});

	it("two-part host → first part", () => {
		expect(lastLabel("example.com")).toBe("example");
	});

	it("single-segment host (no dots) → the only segment", () => {
		expect(lastLabel("localhost")).toBe("localhost");
	});

	it("empty string → empty string (filter removes empty parts, returns host fallback)", () => {
		expect(lastLabel("")).toBe("");
	});

	it("three-part host → middle segment", () => {
		expect(lastLabel("a.b.c")).toBe("b");
	});
});
