import { randomBytes, scryptSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { checkEnv, validateEnv } from "./env-check.js";

function goodHash(): string {
	const salt = randomBytes(16);
	return `${salt.toString("hex")}:${scryptSync("pw", salt, 64).toString("hex")}`;
}

const strongSecret = randomBytes(48).toString("hex");
const validCors = "chrome-extension://abcdefghijklmnop";

function goodEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
	return {
		JWT_SECRET: strongSecret,
		JWT_ADMIN_PASSWORD_HASH: goodHash(),
		CORS_ORIGIN: validCors,
		...overrides,
	};
}

describe("checkEnv", () => {
	it("passes with all required fields valid", () => {
		expect(checkEnv(goodEnv())).toEqual([]);
	});

	it("rejects known placeholder secrets", () => {
		const errors = checkEnv(
			goodEnv({ JWT_SECRET: "change-this-to-a-random-secret" }),
		);
		expect(errors.some((e) => e.includes("JWT_SECRET"))).toBe(true);
	});

	it("rejects the legacy dev secret", () => {
		const errors = checkEnv(
			goodEnv({ JWT_SECRET: "dev-secret-change-in-production" }),
		);
		expect(errors.some((e) => e.includes("JWT_SECRET"))).toBe(true);
	});

	it("rejects a too-short secret", () => {
		const errors = checkEnv(goodEnv({ JWT_SECRET: "short" }));
		expect(errors.some((e) => e.includes("JWT_SECRET"))).toBe(true);
	});

	it("rejects a missing or placeholder admin hash", () => {
		expect(checkEnv(goodEnv({ JWT_ADMIN_PASSWORD_HASH: "" })).length).toBe(1);
		expect(
			checkEnv(goodEnv({ JWT_ADMIN_PASSWORD_HASH: "change-this" })).length,
		).toBe(1);
	});

	it("rejects missing CORS_ORIGIN", () => {
		const errors = checkEnv(goodEnv({ CORS_ORIGIN: "" }));
		expect(errors.some((e) => e.includes("CORS_ORIGIN"))).toBe(true);
	});

	it("rejects wildcard '*' CORS_ORIGIN", () => {
		const errors = checkEnv(goodEnv({ CORS_ORIGIN: "*" }));
		expect(errors.some((e) => e.includes("CORS_ORIGIN"))).toBe(true);
	});

	it("accepts a chrome-extension:// CORS_ORIGIN", () => {
		expect(
			checkEnv(goodEnv({ CORS_ORIGIN: "chrome-extension://abc123" })),
		).toEqual([]);
	});

	it("accepts comma-separated extension origins", () => {
		expect(
			checkEnv(
				goodEnv({
					CORS_ORIGIN: "chrome-extension://abc,chrome-extension://def",
				}),
			),
		).toEqual([]);
	});

	it("validateEnv throws on bad env", () => {
		expect(() =>
			validateEnv({
				JWT_SECRET: "",
				JWT_ADMIN_PASSWORD_HASH: "",
				CORS_ORIGIN: "",
			}),
		).toThrow(/Fail-closed/);
	});

	it("validateEnv does not throw on good env", () => {
		expect(() => validateEnv(goodEnv())).not.toThrow();
	});
});

describe("checkEnv: ACGS51_START_URL guard (only when ACGS51_ENABLED=true)", () => {
	const validStartUrl = "https://51acgs.com/acg/12345.html";

	function scraperEnv(
		overrides: Record<string, string> = {},
	): NodeJS.ProcessEnv {
		return goodEnv({
			ACGS51_ENABLED: "true",
			ACGS51_START_URL: validStartUrl,
			ALLOWED_HOSTS: "51acgs.com",
			...overrides,
		});
	}

	it("passes with a valid detail-page URL whose host is in ALLOWED_HOSTS", () => {
		expect(checkEnv(scraperEnv())).toEqual([]);
	});

	it("passes with protocol-prefixed and wildcard ALLOWED_HOSTS patterns", () => {
		expect(
			checkEnv(scraperEnv({ ALLOWED_HOSTS: "https://51acgs.com" })),
		).toEqual([]);
		expect(
			checkEnv(
				scraperEnv({
					ACGS51_START_URL: "https://sub.51acgs.com/acg/1.html",
					ALLOWED_HOSTS: "*.51acgs.com",
				}),
			),
		).toEqual([]);
	});

	it("rejects missing ACGS51_START_URL when enabled, with guidance", () => {
		const env = goodEnv({
			ACGS51_ENABLED: "true",
			ALLOWED_HOSTS: "51acgs.com",
		});
		const errors = checkEnv(env);
		expect(
			errors.some(
				(e) => e.includes("ACGS51_START_URL") && e.includes(".env.example"),
			),
		).toBe(true);
	});

	it("rejects empty or whitespace-only ACGS51_START_URL when enabled", () => {
		for (const url of ["", "   "]) {
			const errors = checkEnv(scraperEnv({ ACGS51_START_URL: url }));
			expect(
				errors.some(
					(e) => e.includes("ACGS51_START_URL") && e.includes(".env.example"),
				),
			).toBe(true);
		}
	});

	it("rejects a START_URL host not in ALLOWED_HOSTS", () => {
		const errors = checkEnv(scraperEnv({ ALLOWED_HOSTS: "other-site.com" }));
		expect(errors.some((e) => e.includes("ALLOWED_HOSTS"))).toBe(true);
	});

	it("rejects when ALLOWED_HOSTS is unset (fail-closed deny all)", () => {
		const env = goodEnv({
			ACGS51_ENABLED: "true",
			ACGS51_START_URL: validStartUrl,
		});
		const errors = checkEnv(env);
		expect(errors.some((e) => e.includes("ALLOWED_HOSTS"))).toBe(true);
	});

	it("rejects a malformed START_URL", () => {
		const errors = checkEnv(scraperEnv({ ACGS51_START_URL: "not-a-url" }));
		expect(errors.some((e) => e.includes("not a valid URL"))).toBe(true);
	});

	it("skips the guard entirely when ACGS51_ENABLED is unset or false", () => {
		expect(checkEnv(goodEnv())).toEqual([]);
		expect(checkEnv(goodEnv({ ACGS51_ENABLED: "false" }))).toEqual([]);
	});
});

describe("checkEnv: ACGS51_LIST_URL + ACGS51_LIST_BUDGET (only when ACGS51_ENABLED=true)", () => {
	const validStartUrl = "https://51acgs.com/acg/12345.html";

	function scraperEnv(overrides: Record<string, string | undefined> = {}) {
		return goodEnv({
			ACGS51_ENABLED: "true",
			ACGS51_START_URL: validStartUrl,
			ALLOWED_HOSTS: "51acgs.com",
			...overrides,
		});
	}

	it("ACGS51_LIST_URL absent → startup proceeds (list mode optional)", () => {
		expect(checkEnv(scraperEnv())).toEqual([]);
	});

	it("ACGS51_LIST_URL valid and host in ALLOWED_HOSTS → no error", () => {
		expect(
			checkEnv(scraperEnv({ ACGS51_LIST_URL: "https://51acgs.com/acg/" })),
		).toEqual([]);
	});

	it("ACGS51_LIST_URL host not in ALLOWED_HOSTS → startup rejected", () => {
		const errors = checkEnv(
			scraperEnv({ ACGS51_LIST_URL: "https://other-site.com/acg/" }),
		);
		expect(
			errors.some(
				(e) => e.includes("ACGS51_LIST_URL") && e.includes("ALLOWED_HOSTS"),
			),
		).toBe(true);
	});

	it("ACGS51_LIST_URL malformed URL → error", () => {
		const errors = checkEnv(scraperEnv({ ACGS51_LIST_URL: "not-a-url" }));
		expect(errors.some((e) => e.includes("ACGS51_LIST_URL"))).toBe(true);
	});

	it("ACGS51_LIST_BUDGET absent → startup proceeds (default 20)", () => {
		expect(checkEnv(scraperEnv())).toEqual([]);
	});

	it("ACGS51_LIST_BUDGET valid positive integer → no error", () => {
		expect(checkEnv(scraperEnv({ ACGS51_LIST_BUDGET: "50" }))).toEqual([]);
	});

	it("ACGS51_LIST_BUDGET non-numeric string → startup rejected", () => {
		const errors = checkEnv(scraperEnv({ ACGS51_LIST_BUDGET: "many" }));
		expect(errors.some((e) => e.includes("ACGS51_LIST_BUDGET"))).toBe(true);
	});

	it("ACGS51_LIST_BUDGET zero → startup rejected", () => {
		const errors = checkEnv(scraperEnv({ ACGS51_LIST_BUDGET: "0" }));
		expect(errors.some((e) => e.includes("ACGS51_LIST_BUDGET"))).toBe(true);
	});
});
