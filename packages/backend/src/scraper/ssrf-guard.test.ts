import type { LookupAddress } from "node:dns";
import { lookup } from "node:dns/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	assertUrlSafe,
	isPublicUnicastIp,
	SsrfError,
	safeFetch,
} from "./ssrf-guard.js";

// Wrap node:dns lookup so individual tests can override one resolution via
// mockResolvedValueOnce; all other calls delegate to the real resolver, so the
// localhost / real-host tests below keep their genuine behavior.
vi.mock("node:dns/promises", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:dns/promises")>();
	return { ...actual, lookup: vi.fn(actual.lookup) };
});

describe("isPublicUnicastIp", () => {
	it("allows public unicast addresses", () => {
		for (const ip of [
			"8.8.8.8",
			"1.1.1.1",
			"203.0.114.1",
			"2606:4700:4700::1111",
			"::ffff:8.8.8.8",
		]) {
			expect(isPublicUnicastIp(ip), ip).toBe(true);
		}
	});

	it("blocks private / loopback / link-local / CGNAT IPv4", () => {
		for (const ip of [
			"127.0.0.1",
			"10.0.0.1",
			"172.16.5.5",
			"192.168.1.1",
			"169.254.1.1",
			"100.64.0.1",
			"0.0.0.0",
			"224.0.0.1",
			"255.255.255.255",
		]) {
			expect(isPublicUnicastIp(ip), ip).toBe(false);
		}
	});

	it("blocks IPv6 special ranges and mapped loopback", () => {
		for (const ip of [
			"::1",
			"::",
			"fe80::1",
			"fc00::1",
			"fd12:3456::1",
			"ff02::1",
			"::ffff:127.0.0.1",
		]) {
			expect(isPublicUnicastIp(ip), ip).toBe(false);
		}
	});

	it("blocks hex-form IPv4-in-IPv6 (compat / mapped / NAT64) pointing at private space", () => {
		for (const ip of [
			"::a00:1", // ::/96 compat = 10.0.0.1
			"::7f00:1", // ::/96 compat = 127.0.0.1
			"::a9fe:a9fe", // ::/96 compat = 169.254.169.254 (cloud metadata)
			"::ffff:a00:1", // mapped = 10.0.0.1
			"64:ff9b::7f00:1", // NAT64 = 127.0.0.1
		]) {
			expect(isPublicUnicastIp(ip), ip).toBe(false);
		}
	});

	it("still allows public hex-form embedded IPv4", () => {
		expect(isPublicUnicastIp("::ffff:808:808")).toBe(true); // mapped = 8.8.8.8
	});

	it("rejects non-IP input", () => {
		expect(isPublicUnicastIp("not-an-ip")).toBe(false);
	});
});

describe("assertUrlSafe", () => {
	it("rejects a literal loopback host", async () => {
		await expect(assertUrlSafe("http://127.0.0.1/x")).rejects.toBeInstanceOf(
			SsrfError,
		);
	});

	it("rejects localhost (resolves to loopback)", async () => {
		await expect(assertUrlSafe("http://localhost/x")).rejects.toBeInstanceOf(
			SsrfError,
		);
	});

	it("rejects non-http(s) protocols", async () => {
		await expect(assertUrlSafe("ftp://example.com/x")).rejects.toBeInstanceOf(
			SsrfError,
		);
		await expect(assertUrlSafe("file:///etc/passwd")).rejects.toBeInstanceOf(
			SsrfError,
		);
	});

	it("rejects URLs carrying credentials", async () => {
		await expect(
			assertUrlSafe("http://user:pass@1.1.1.1/"),
		).rejects.toBeInstanceOf(SsrfError);
	});

	it("accepts a literal public IP host", async () => {
		await expect(assertUrlSafe("https://1.1.1.1/")).resolves.toBeInstanceOf(
			URL,
		);
	});

	// Multi-record DNS: a public hostname that resolves to several addresses,
	// one of which is private (DNS-poisoning / split-horizon). assertUrlSafe
	// checks EVERY resolved address, so any private record must reject.
	// (True DNS-rebind across the assertUrlSafe→fetch boundary is an accepted
	// residual — see ssrf-guard.ts header; bounded by the upstream allowlist.)
	it("rejects a host whose multi-record DNS includes a private address", async () => {
		vi.mocked(lookup).mockResolvedValueOnce([
			{ address: "93.184.216.34", family: 4 },
			{ address: "10.0.0.5", family: 4 },
		] as unknown as LookupAddress);
		await expect(
			assertUrlSafe("https://multi.example.com/x"),
		).rejects.toBeInstanceOf(SsrfError);
	});

	it("accepts a host whose multi-record DNS is all public", async () => {
		vi.mocked(lookup).mockResolvedValueOnce([
			{ address: "93.184.216.34", family: 4 },
			{ address: "1.1.1.1", family: 4 },
		] as unknown as LookupAddress);
		await expect(
			assertUrlSafe("https://allpublic.example.com/x"),
		).resolves.toBeInstanceOf(URL);
	});
});

describe("safeFetch", () => {
	afterEach(() => vi.unstubAllGlobals());

	it("returns the response for an allowed host", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("ok", { status: 200 })),
		);
		const res = await safeFetch("https://1.1.1.1/");
		expect(res.status).toBe(200);
	});

	it("rejects a redirect that points at a loopback address", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(null, {
						status: 302,
						headers: { location: "http://127.0.0.1/" },
					}),
			),
		);
		await expect(safeFetch("https://1.1.1.1/")).rejects.toBeInstanceOf(
			SsrfError,
		);
	});

	it("rejects after too many redirects", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(null, {
						status: 302,
						headers: { location: "https://1.1.1.1/next" },
					}),
			),
		);
		await expect(safeFetch("https://1.1.1.1/", {}, 2)).rejects.toThrow(
			/Too many redirects/,
		);
	});
});
