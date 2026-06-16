// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { logger } from "./logger";

describe("logger", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("info logs with correct format", () => {
		const spy = vi.spyOn(console, "info").mockImplementation(() => {});
		logger.info("test", "hello", { id: 1 });
		expect(spy).toHaveBeenCalledWith(
			'[51publisher] [info] [test] hello {"id":1}',
		);
	});

	it("warn logs with correct format", () => {
		const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
		logger.warn("test-module", "something went wrong");
		expect(spy).toHaveBeenCalledWith(
			"[51publisher] [warn] [test-module] something went wrong",
		);
	});

	it("error logs with correct format and context", () => {
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		logger.error("db", "query failed", { query: "SELECT *" });
		expect(spy).toHaveBeenCalledWith(
			'[51publisher] [error] [db] query failed {"query":"SELECT *"}',
		);
	});

	it("debug is silent when dev-mode gate is off", () => {
		logger.__setDevForTest(false);
		const spy = vi.spyOn(console, "debug").mockImplementation(() => {});
		logger.debug("test", "detail");
		expect(spy).not.toHaveBeenCalled();
	});

	it("debug logs when dev-mode gate is on", () => {
		logger.__setDevForTest(true);
		const spy = vi.spyOn(console, "debug").mockImplementation(() => {});
		logger.debug("test", "debug detail");
		expect(spy).toHaveBeenCalledWith(
			"[51publisher] [debug] [test] debug detail",
		);
	});

	it("logs without context (no trailing JSON)", () => {
		const spy = vi.spyOn(console, "info").mockImplementation(() => {});
		logger.info("test", "no context");
		expect(spy).toHaveBeenCalledWith("[51publisher] [info] [test] no context");
	});
});
