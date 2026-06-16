import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerPromptRoutes } from "./prompt-routes.js";
import { deletePrompt, listPrompts } from "./prompt-store.js";

async function buildApp(): Promise<FastifyInstance> {
	const app = Fastify({ logger: false });
	await registerPromptRoutes(app);
	await app.ready();
	return app;
}

async function clearAll() {
	for (const p of await listPrompts()) await deletePrompt(p.id);
}

let app: FastifyInstance;

beforeEach(async () => {
	await clearAll();
	app = await buildApp();
});

afterEach(async () => {
	await app.close();
	await clearAll();
});

const validBody = {
	name: "我的模板",
	template: "写一篇关于 {{topic}} 的帖子",
	fewShotExamples: "例子",
};

describe("GET /api/v1/prompts", () => {
	it("空 store → ok:true, prompts:[]", async () => {
		const res = await app.inject({ method: "GET", url: "/api/v1/prompts" });
		expect(res.statusCode).toBe(200);
		expect(res.json()).toEqual({ ok: true, prompts: [] });
	});
});

describe("POST /api/v1/prompts", () => {
	it("合法 body → 200，返回带 id 的 prompt 且已持久化", async () => {
		const res = await app.inject({
			method: "POST",
			url: "/api/v1/prompts",
			payload: validBody,
		});
		expect(res.statusCode).toBe(200);
		const { ok, prompt } = res.json();
		expect(ok).toBe(true);
		expect(prompt.id).toMatch(/^prompt_/);
		expect(prompt.name).toBe("我的模板");
		expect(prompt.createdAt).toBeTruthy();
		// 持久化校验
		const list = await listPrompts();
		expect(list.find((p) => p.id === prompt.id)).toBeTruthy();
	});

	it("fewShotExamples 缺省 → 存为空字符串", async () => {
		const res = await app.inject({
			method: "POST",
			url: "/api/v1/prompts",
			payload: { name: "n", template: "t" },
		});
		expect(res.statusCode).toBe(200);
		expect(res.json().prompt.fewShotExamples).toBe("");
	});

	it("缺必填 name → 400（schema 校验）", async () => {
		const res = await app.inject({
			method: "POST",
			url: "/api/v1/prompts",
			payload: { template: "t" },
		});
		expect(res.statusCode).toBe(400);
	});

	it("name 为空字符串 → 400（minLength）", async () => {
		const res = await app.inject({
			method: "POST",
			url: "/api/v1/prompts",
			payload: { name: "", template: "t" },
		});
		expect(res.statusCode).toBe(400);
	});
});

describe("GET /api/v1/prompts/:id", () => {
	it("存在 → 返回该 prompt", async () => {
		const created = (
			await app.inject({
				method: "POST",
				url: "/api/v1/prompts",
				payload: validBody,
			})
		).json().prompt;
		const res = await app.inject({
			method: "GET",
			url: `/api/v1/prompts/${created.id}`,
		});
		expect(res.statusCode).toBe(200);
		expect(res.json().prompt.id).toBe(created.id);
	});

	it("不存在 → 404", async () => {
		const res = await app.inject({
			method: "GET",
			url: "/api/v1/prompts/ghost",
		});
		expect(res.statusCode).toBe(404);
	});
});

describe("PUT /api/v1/prompts/:id", () => {
	it("更新部分字段 → 仅改动字段变更，updatedAt 刷新", async () => {
		const created = (
			await app.inject({
				method: "POST",
				url: "/api/v1/prompts",
				payload: validBody,
			})
		).json().prompt;

		await new Promise((r) => setTimeout(r, 5));
		const res = await app.inject({
			method: "PUT",
			url: `/api/v1/prompts/${created.id}`,
			payload: { name: "改后的名字" },
		});
		expect(res.statusCode).toBe(200);
		const updated = res.json().prompt;
		expect(updated.name).toBe("改后的名字");
		expect(updated.template).toBe(created.template); // 未改动字段保留
		expect(updated.updatedAt >= created.updatedAt).toBe(true);
	});

	it("更新不存在的 id → 404", async () => {
		const res = await app.inject({
			method: "PUT",
			url: "/api/v1/prompts/ghost",
			payload: { name: "x" },
		});
		expect(res.statusCode).toBe(404);
	});
});

describe("DELETE /api/v1/prompts/:id", () => {
	it("删除存在的 → ok:true，随后 GET 404", async () => {
		const created = (
			await app.inject({
				method: "POST",
				url: "/api/v1/prompts",
				payload: validBody,
			})
		).json().prompt;
		const del = await app.inject({
			method: "DELETE",
			url: `/api/v1/prompts/${created.id}`,
		});
		expect(del.statusCode).toBe(200);
		expect(del.json().ok).toBe(true);

		const after = await app.inject({
			method: "GET",
			url: `/api/v1/prompts/${created.id}`,
		});
		expect(after.statusCode).toBe(404);
	});

	it("删除不存在的 id → 404", async () => {
		const res = await app.inject({
			method: "DELETE",
			url: "/api/v1/prompts/ghost",
		});
		expect(res.statusCode).toBe(404);
	});
});
