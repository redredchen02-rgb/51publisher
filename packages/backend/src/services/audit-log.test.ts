import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tmpDir: string;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "audit-log-test-"));
	process.env.PUBLISHER_DATA_DIR = tmpDir;
	vi.resetModules();
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
	delete process.env.PUBLISHER_DATA_DIR;
});

describe("auditLogin", () => {
	it("creates audit log file on first call", async () => {
		const { auditLogin, AUDIT_LOG_PATH } = await import("./audit-log.js");
		auditLogin("success", "127.0.0.1");
		expect(existsSync(AUDIT_LOG_PATH)).toBe(true);
	});

	it("appends a JSON line with result and ip", async () => {
		const { auditLogin, AUDIT_LOG_PATH } = await import("./audit-log.js");
		auditLogin("invalid_password", "10.0.0.1");
		const line = readFileSync(AUDIT_LOG_PATH, "utf-8").trim();
		const entry = JSON.parse(line);
		expect(entry.result).toBe("invalid_password");
		expect(entry.ip).toBe("10.0.0.1");
		expect(typeof entry.t).toBe("string");
	});

	it("does not include password or token in log", async () => {
		const { auditLogin, AUDIT_LOG_PATH } = await import("./audit-log.js");
		auditLogin("success", "192.168.1.1");
		const raw = readFileSync(AUDIT_LOG_PATH, "utf-8");
		expect(raw).not.toContain("password");
		expect(raw).not.toContain("token");
		expect(raw).not.toContain("secret");
	});

	it("appends multiple entries as separate lines", async () => {
		const { auditLogin, AUDIT_LOG_PATH } = await import("./audit-log.js");
		auditLogin("success", "1.1.1.1");
		auditLogin("rate_limited", "2.2.2.2");
		const lines = readFileSync(AUDIT_LOG_PATH, "utf-8")
			.trim()
			.split("\n")
			.filter(Boolean);
		expect(lines).toHaveLength(2);
		expect(JSON.parse(lines[1]).result).toBe("rate_limited");
	});

	it("accepts all valid AuthResult values without throwing", async () => {
		const { auditLogin } = await import("./audit-log.js");
		const results = [
			"success",
			"invalid_password",
			"rate_limited",
			"not_configured",
		] as const;
		for (const r of results) {
			expect(() => auditLogin(r, "0.0.0.0")).not.toThrow();
		}
	});
});
