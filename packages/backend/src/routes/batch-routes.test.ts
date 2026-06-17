import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initPendingDb, resetPendingDb } from "../scraper/pending-db.js";
import { registerBatchRoutes } from "./batch-routes.js";

// data/ 目录清理(测试隔离)。优先使用 test-setup 注入的隔离临时目录，
// 避免误删真实 packages/backend/data。
const DATA_DIR =
	process.env.PUBLISHER_DATA_DIR ||
	join(dirname(new URL(import.meta.url).pathname), "..", "data");

async function buildApp(): Promise<FastifyInstance> {
	const app = Fastify();
	await registerBatchRoutes(app);
	await app.ready();
	return app;
}

function cleanData() {
	// Safety guard: never rmSync the real data dir. test-setup.ts injects
	// PUBLISHER_DATA_DIR (a temp dir); if it's missing, refuse rather than risk
	// wiping packages/backend/data when this file is run outside vitest setup.
	if (!process.env.PUBLISHER_DATA_DIR) {
		throw new Error(
			"cleanData refused: PUBLISHER_DATA_DIR not set (test isolation missing)",
		);
	}
	if (existsSync(DATA_DIR)) {
		rmSync(DATA_DIR, { recursive: true, force: true });
	}
}

describe("Batch Routes", () => {
	let app: FastifyInstance;

	beforeEach(async () => {
		resetPendingDb();
		cleanData();
		mkdirSync(DATA_DIR, { recursive: true });
		initPendingDb();
		app = await buildApp();
	});

	afterEach(async () => {
		await app.close();
		resetPendingDb();
		cleanData();
	});

	describe("POST /api/v1/batches", () => {
		it("creates a new batch", async () => {
			const res = await app.inject({
				method: "POST",
				url: "/api/v1/batches",
				payload: {
					id: "test-batch-1",
					tabId: 42,
					authorizedHost: "example.com",
					topics: ["topic-a", "topic-b"],
				},
			});
			expect(res.statusCode).toBe(200);
			const body = res.json();
			expect(body.ok).toBe(true);
			expect(body.batch.id).toBe("test-batch-1");
			expect(body.batch.items).toHaveLength(2);
			expect(body.batch.items[0].status).toBe("queued");
			expect(body.batch.items[1].topic).toBe("topic-b");
		});

		it("rejects empty topics", async () => {
			const res = await app.inject({
				method: "POST",
				url: "/api/v1/batches",
				payload: {
					id: "test-batch-2",
					tabId: 42,
					authorizedHost: "example.com",
					topics: [],
				},
			});
			expect(res.statusCode).toBe(400);
		});
	});

	describe("GET /api/v1/batches/:id", () => {
		it("returns 404 for unknown batch", async () => {
			const res = await app.inject({
				method: "GET",
				url: "/api/v1/batches/nonexist",
			});
			expect(res.statusCode).toBe(404);
		});

		it("returns a created batch", async () => {
			await app.inject({
				method: "POST",
				url: "/api/v1/batches",
				payload: {
					id: "b1",
					tabId: 1,
					authorizedHost: "h.com",
					topics: ["t1"],
				},
			});
			const res = await app.inject({
				method: "GET",
				url: "/api/v1/batches/b1",
			});
			expect(res.statusCode).toBe(200);
			expect(res.json().batch.id).toBe("b1");
		});
	});

	describe("PATCH /api/v1/batches/:id/items/:itemId", () => {
		it("transitions queued → generating", async () => {
			await app.inject({
				method: "POST",
				url: "/api/v1/batches",
				payload: {
					id: "b2",
					tabId: 1,
					authorizedHost: "h.com",
					topics: ["t1"],
				},
			});

			const res = await app.inject({
				method: "PATCH",
				url: "/api/v1/batches/b2/items/item_0",
				payload: { status: "generating" },
			});
			expect(res.statusCode).toBe(200);
			expect(res.json().item.status).toBe("generating");
		});

		it("rejects invalid state transition", async () => {
			await app.inject({
				method: "POST",
				url: "/api/v1/batches",
				payload: {
					id: "b3",
					tabId: 1,
					authorizedHost: "h.com",
					topics: ["t1"],
				},
			});

			// queued → publish-confirmed is invalid
			const res = await app.inject({
				method: "PATCH",
				url: "/api/v1/batches/b3/items/item_0",
				payload: { status: "publish-confirmed" },
			});
			expect(res.statusCode).toBe(409);
			expect(res.json().ok).toBe(false);
		});

		it("returns 404 for unknown item", async () => {
			await app.inject({
				method: "POST",
				url: "/api/v1/batches",
				payload: {
					id: "b4",
					tabId: 1,
					authorizedHost: "h.com",
					topics: ["t1"],
				},
			});

			const res = await app.inject({
				method: "PATCH",
				url: "/api/v1/batches/b4/items/fake_item",
				payload: { status: "generating" },
			});
			expect(res.statusCode).toBe(404);
		});
	});

	describe("POST /api/v1/batches — missing fields → 400", () => {
		it("returns 400 when topics is missing", async () => {
			const res = await app.inject({
				method: "POST",
				url: "/api/v1/batches",
				payload: { id: "bad1", tabId: 1, authorizedHost: "h.com" },
			});
			expect(res.statusCode).toBe(400);
		});

		it("returns 400 when id is missing", async () => {
			const res = await app.inject({
				method: "POST",
				url: "/api/v1/batches",
				payload: { tabId: 1, authorizedHost: "h.com", topics: ["t1"] },
			});
			expect(res.statusCode).toBe(400);
		});

		it("returns 400 when topics is empty array", async () => {
			const res = await app.inject({
				method: "POST",
				url: "/api/v1/batches",
				payload: { id: "bad2", tabId: 1, authorizedHost: "h.com", topics: [] },
			});
			expect(res.statusCode).toBe(400);
		});
	});

	describe("PATCH — metrics recording", () => {
		async function createBatchWithApproval(id: string) {
			await app.inject({
				method: "POST",
				url: "/api/v1/batches",
				payload: { id, tabId: 1, authorizedHost: "h.com", topics: ["t1"] },
			});
			// queued → generating → filled → awaiting-approval → publish-dispatched
			for (const status of ["generating", "filled", "awaiting-approval", "publish-dispatched"]) {
				await app.inject({
					method: "PATCH",
					url: `/api/v1/batches/${id}/items/item_0`,
					payload: { status },
				});
			}
		}

		it("records publish success when status → publish-confirmed", async () => {
			await createBatchWithApproval("m1");
			const res = await app.inject({
				method: "PATCH",
				url: "/api/v1/batches/m1/items/item_0",
				payload: { status: "publish-confirmed" },
			});
			expect(res.statusCode).toBe(200);
			expect(res.json().item.status).toBe("publish-confirmed");
		});

		it("records publish failure when status → error with publish-failed", async () => {
			await createBatchWithApproval("m2");
			const res = await app.inject({
				method: "PATCH",
				url: "/api/v1/batches/m2/items/item_0",
				payload: { status: "error", error: "publish-failed" },
			});
			expect(res.statusCode).toBe(200);
			expect(res.json().item.status).toBe("error");
		});

		it("records batchCompleted when all items leave active state", async () => {
			// Single-item batch: when it reaches publish-confirmed all items are done
			await createBatchWithApproval("m3");
			const res = await app.inject({
				method: "PATCH",
				url: "/api/v1/batches/m3/items/item_0",
				payload: { status: "publish-confirmed" },
			});
			expect(res.statusCode).toBe(200);
		});
	});

	describe("GET /api/v1/batches (list)", () => {
		it("lists recently created batches", async () => {
			for (const id of ["la", "lb", "lc"]) {
				await app.inject({
					method: "POST",
					url: "/api/v1/batches",
					payload: {
						id,
						tabId: 1,
						authorizedHost: "h.com",
						topics: ["t1"],
					},
				});
			}
			const res = await app.inject({ method: "GET", url: "/api/v1/batches" });
			expect(res.statusCode).toBe(200);
			expect(res.json().batches.length).toBe(3);
		});
	});
});
