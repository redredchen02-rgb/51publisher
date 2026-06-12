import { dirname, join } from "node:path";
import { JsonFileStore } from "../utils/json-store.js";

// ---- 类型定义 ----

export interface PromptTemplate {
	id: string;
	name: string;
	template: string;
	fewShotExamples: string;
	model?: string;
	createdAt: string;
	updatedAt: string;
}

export interface PromptTemplateCreate {
	name: string;
	template: string;
	fewShotExamples: string;
	model?: string;
}

export interface PromptTemplateUpdate {
	name?: string;
	template?: string;
	fewShotExamples?: string;
	model?: string;
}

// ---- 文件持久层（轻量 JSON，与 pending-store.ts 一致） ----

const DATA_DIR =
	process.env.PUBLISHER_DATA_DIR ||
	join(dirname(new URL(import.meta.url).pathname), "..", "data");
const PROMPTS_DIR = join(DATA_DIR, "prompts");

const promptStore = new JsonFileStore<PromptTemplate>({
	dirPath: PROMPTS_DIR,
	updatedAtKey: "updatedAt",
});

export async function loadPrompt(id: string): Promise<PromptTemplate | null> {
	return promptStore.read(id);
}

export async function savePrompt(template: PromptTemplate): Promise<void> {
	return promptStore.write(template);
}

export async function listPrompts(): Promise<PromptTemplate[]> {
	return promptStore.list();
}

export async function deletePrompt(id: string): Promise<boolean> {
	return promptStore.delete(id);
}
