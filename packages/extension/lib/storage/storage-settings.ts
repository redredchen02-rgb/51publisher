import type { FewShotPair, Settings } from "@51guapi/shared";
import { DEFAULT_FIELD_MAPPING } from "@51guapi/shared";
import { storage } from "#imports";
import { clearBackendUrlCache } from "../api/backend-url";
import { fetchRemoteMappings } from "../api/config-client";

const SETTINGS_KEY = "local:settings";
const API_KEY = "local:apiKey";
const BACKEND_TOKEN_KEY = "local:backendToken";

/** 默认设置。字段映射拆到 lib/field-mapping.ts(不依赖 #imports,供 e2e/contract 复用)。 */
export const DEFAULT_SETTINGS: Settings = {
	endpoint: "",
	model: "gpt-4o-mini",
	fallbackModel: "",
	// 程序化结构化生成(防幻觉):模型只写口吻散文「槽位」,作品名/集数/制作/连结/分类由系统注入。
	// 占位符:{{fewshot}} few-shot 范例 / {{topic}} 选题 / {{facts}} 结构化事实块。
	promptTemplate: [
		"{{fewshot}}你是「51娘」,成人動畫/裏番與成人同人漫畫介紹站的看板娘,口吻活潑,以「嗨嗨~大家好我是51娘」開場、結尾招呼各位紳士。",
		"",
		"你的任务:只写「口吻散文」,不要拼装整篇正文。作品名、集数、制作、连结、抬头、分类标签由系统填入,你绝不要自己写它们。",
		"",
		"铁律:",
		"1. 只根据【事实】写;严禁编造或陈述任何【事实】未给出的具体信息(年份、声优、剧情细节等),缺的信息直接不提。",
		"2. 散文里绝不写任何 URL/连结,也不要写「漢化連結」「無修連結」这类条目——这些由系统注入。",
		"3. 不要罗列「作品名=…」「集数=…」这类字段,那由系统的抬头块负责;你只写引子与看点的口语化介绍。",
		"",
		"以 JSON 返回这些字段(全部纯文本,不含 HTML):",
		"- intro:开场引子(51娘 口吻,1–3 句)",
		"- highlights:看点介绍(2–4 句,只用【事实】范围内的卖点)",
		"- titleSuffix:标题后缀(如「成人動畫介紹」「成人同人推薦」;系统会前置作品名)",
		"- subtitle:一句俏皮副标题",
		"- outro:结尾招呼(可选)",
		"- category:分类(从后台已知分类里挑;不确定就留空)",
		"- tags:标签数组(题材相关;不确定就给空数组)",
		"",
		"主题:{{topic}}",
		"",
		"{{facts}}",
	].join("\n"),
	fewShotPairs: [] as FewShotPair[],
	recommendedTags: [] as string[],
	fieldMapping: DEFAULT_FIELD_MAPPING,
};

/** 读取设置,缺失项回落默认值(storage 为空时返回完整默认对象)。 */
export async function getSettings(): Promise<Settings> {
	const stored = await storage.getItem<Partial<Settings>>(SETTINGS_KEY);
	if (!stored) return structuredClone(DEFAULT_SETTINGS);
	const merged: Settings = {
		...DEFAULT_SETTINGS,
		...stored,
		fieldMapping: {
			...DEFAULT_SETTINGS.fieldMapping,
			...(stored.fieldMapping ?? {}),
		},
	};
	return merged;
}

export async function saveSettings(settings: Settings): Promise<void> {
	await storage.setItem(SETTINGS_KEY, settings);
	// 清除后端 URL 缓存，确保下次请求使用新地址
	clearBackendUrlCache();
}

/** API key 单独存取(明文存于 chrome.storage.local,设置页须提示风险)。 */
export async function getApiKey(): Promise<string> {
	return (await storage.getItem<string>(API_KEY)) ?? "";
}

export async function saveApiKey(key: string): Promise<void> {
	await storage.setItem(API_KEY, key);
}

/** 后端 JWT token（与 apiKey 分开存取）。 */
export async function getBackendToken(): Promise<string> {
	return (await storage.getItem<string>(BACKEND_TOKEN_KEY)) ?? "";
}

export async function saveBackendToken(token: string): Promise<void> {
	await storage.setItem(BACKEND_TOKEN_KEY, token);
}

// ---- Few-shot 范例（R11 一键存为范例）----

export function deriveFewShotExamples(pairs: FewShotPair[]): string {
	return pairs.map((p) => `${p.input}\n---\n${p.output}`).join("\n\n");
}

export function parseFewShotExamples(raw: string): FewShotPair[] {
	if (!raw) return [];
	const blocks = raw.split(/\n\n+/).filter(Boolean);
	return blocks.map((b) => {
		const sep = b.indexOf("\n---\n");
		return sep !== -1
			? { input: b.slice(0, sep), output: b.slice(sep + 5) }
			: { input: "", output: b };
	});
}

const MAX_FEW_SHOT = 8;

/**
 * 追加一条 few-shot 范例到末尾（只写 fewShotPairs）。
 * 返回 { ok: false, reason: 'full' } 当已达上限，不写入。
 */
export async function addFewShotPair(
	pair: FewShotPair,
): Promise<{ ok: boolean; reason?: "full" }> {
	const settings = await getSettings();
	const current = settings.fewShotPairs ?? [];
	if (current.length >= MAX_FEW_SHOT) return { ok: false, reason: "full" };
	const next = [...current, pair];
	await saveSettings({
		...settings,
		fewShotPairs: next,
	});
	return { ok: true };
}

/**
 * 移除末尾一条 few-shot 范例（LIFO 撤销；不影响其他条目）。
 * 空列表时幂等跳过。
 */
export async function removeLastFewShotPair(): Promise<void> {
	const settings = await getSettings();
	const current = settings.fewShotPairs ?? [];
	if (current.length === 0) return;
	const next = current.slice(0, -1);
	await saveSettings({
		...settings,
		fewShotPairs: next,
	});
}

// ---- 远程配置热刷新 ----

/**
 * 拉取后端最新字段映射并写入本地 settings。
 * 供 Background Service Worker 启动时调用(onStartup / onInstalled),
 * 实现选择器配置云端热更新——页面改版只改后端即可,无需扩展发版。
 *
 * 后端不可达时 fail-closed,保留本地已有映射(不覆盖)。
 * 返回 remote=true 表示成功拉取了远程配置。
 */
export async function refreshRemoteMappings(): Promise<{ remote: boolean }> {
	const { mappings, remote } = await fetchRemoteMappings();
	if (!remote) return { remote: false };

	const settings = await getSettings();
	settings.fieldMapping = { ...DEFAULT_FIELD_MAPPING, ...mappings };
	await saveSettings(settings);
	return { remote: true };
}
