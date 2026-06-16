import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	deletePrompt,
	listPrompts,
	loadPrompt,
	type PromptTemplate,
	savePrompt,
} from "./prompt-store.js";

function makePrompt(overrides: Partial<PromptTemplate> = {}): PromptTemplate {
	const now = new Date().toISOString();
	return {
		id: `prompt_test_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
		name: "测试模板",
		template: "你是一个写手 {{topic}}",
		fewShotExamples: "示例输入→示例输出",
		createdAt: now,
		updatedAt: now,
		...overrides,
	};
}

// 清空 prompts 目录，避免跨测试串扰
async function clearAll() {
	for (const p of await listPrompts()) await deletePrompt(p.id);
}

beforeEach(clearAll);
afterEach(clearAll);

describe("prompt-store", () => {
	it("save → load: 字段完整往返", async () => {
		const p = makePrompt({ model: "gemma" });
		await savePrompt(p);
		const loaded = await loadPrompt(p.id);
		expect(loaded).not.toBeNull();
		expect(loaded?.name).toBe("测试模板");
		expect(loaded?.template).toBe("你是一个写手 {{topic}}");
		expect(loaded?.fewShotExamples).toBe("示例输入→示例输出");
		expect(loaded?.model).toBe("gemma");
	});

	it("load 不存在的 id → null", async () => {
		expect(await loadPrompt("nonexistent")).toBeNull();
	});

	it("save 同 id 两次 → 覆盖，以最新为准", async () => {
		const p = makePrompt();
		await savePrompt(p);
		await savePrompt({ ...p, name: "改名后" });
		expect((await loadPrompt(p.id))?.name).toBe("改名后");
	});

	it("空 store → listPrompts 返回空数组", async () => {
		expect(await listPrompts()).toEqual([]);
	});

	it("listPrompts 返回所有已存模板", async () => {
		await savePrompt(makePrompt({ id: "prompt_a", name: "A" }));
		await savePrompt(makePrompt({ id: "prompt_b", name: "B" }));
		const list = await listPrompts();
		expect(list.length).toBe(2);
		expect(list.map((p) => p.name).sort()).toEqual(["A", "B"]);
	});

	it("delete 已存在 → true，记录消失", async () => {
		const p = makePrompt();
		await savePrompt(p);
		expect(await deletePrompt(p.id)).toBe(true);
		expect(await loadPrompt(p.id)).toBeNull();
	});

	it("delete 不存在的 id → false", async () => {
		expect(await deletePrompt("ghost")).toBe(false);
	});
});
