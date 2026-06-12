import type { ContentDraft } from "@51publisher/shared";
import { describe, expect, it } from "vitest";

const ENDPOINT =
	process.env.LLM_ENDPOINT ||
	process.env.BASE_URL ||
	"https://la-sealion.inaiai.com/v1";
const KEY = process.env.LLM_KEY || process.env.API_KEY;
const MODEL = process.env.LLM_MODEL || process.env.MODEL || "gpt-4o-mini";

const FACT_ORDER = ["作品名", "集数", "制作", "漢化", "無修", "题材", "简介"];
const _PLACEHOLDER = "【待补】";

const PROMPT = [
	"你是「51娘」,成人動畫/裏番與成人同人漫畫介紹站的看板娘,口吻活潑,以「嗨嗨~大家好我是51娘」開場、結尾招呼各位紳士。",
	"",
	"你的任务:只写「口吻散文」,不要拼装整篇正文。作品名、集数、制作、连结、抬头、分类标签由系统填入,你绝不要自己写它们。",
	"",
	"铁律:",
	"1. 只根据【事实】写;严禁编造或陈述任何【事实】未给出的具体信息(年份、声优、剧情细节等),缺的信息直接不提。",
	"2. 散文里绝不写任何 URL/连结,也不要写「漢化連結」「無修連結」这类条目——这些由系统注入。",
	"3. 不要罗列「作品名=…」「集数=…」这类字段,那由系统的抬头块负责;你只写引子与看点的口语化介绍。",
	"",
	"以 JSON 返回这些字段(全部纯文本,不含 HTML):",
	"- intro / highlights / titleSuffix / subtitle / outro / category / tags(数组)",
	"主题:{{topic}}",
	"",
	"{{facts}}",
].join("\n");

function factsBlock(f: Record<string, string>) {
	const lines = FACT_ORDER.filter((k) => f[k]).map((k) => `- ${k}:${f[k]}`);
	if (!lines.length)
		return "【事实】(未提供任何事实——请通篇按缺失处理,绝不编造)";
	return [
		"【事实】(只能使用以下事实;严禁新增或编造;连结只能原样使用给出的 URL):",
		...lines,
	].join("\n");
}
function buildPrompt(topic: string, f: Record<string, string>) {
	return PROMPT.replace("{{topic}}", topic).replace("{{facts}}", factsBlock(f));
}

import { assembleDraft } from "@51publisher/shared";
import { evaluateGrounding } from "../../lib/grounding-gate";

const SCHEMA = {
	name: "draft_slots",
	strict: true,
	schema: {
		type: "object",
		additionalProperties: false,
		properties: {
			titleSuffix: { type: ["string", "null"] },
			subtitle: { type: ["string", "null"] },
			intro: { type: "string" },
			highlights: { type: "string" },
			outro: { type: ["string", "null"] },
			category: { type: ["string", "null"] },
			tags: { type: ["array", "null"], items: { type: "string" } },
		},
		required: [
			"titleSuffix",
			"subtitle",
			"intro",
			"highlights",
			"outro",
			"category",
			"tags",
		],
	},
};

async function call(prompt: string, useSchema: boolean) {
	const res = await fetch(`${ENDPOINT.replace(/\/+$/, "")}/chat/completions`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${KEY}`,
		},
		body: JSON.stringify({
			model: MODEL,
			messages: [{ role: "user", content: prompt }],
			response_format: useSchema
				? { type: "json_schema", json_schema: SCHEMA }
				: { type: "json_object" },
		}),
	});
	return res;
}
async function generate(topic: string, f: Record<string, string>) {
	const prompt = buildPrompt(topic, f);
	let res = await call(prompt, true);
	let mode = "json_schema";
	if (!res.ok && res.status === 400) {
		res = await call(prompt, false);
		mode = "json_object(降级)";
	}
	if (!res.ok) return { err: `HTTP ${res.status} ${res.statusText}` };
	const raw: any = await res.json();
	const content: string = raw?.choices?.[0]?.message?.content ?? "";
	// biome-ignore lint/suspicious/noImplicitAnyLet: JSON.parse returns any
	let parsed;
	try {
		parsed = JSON.parse(
			String(content)
				.replace(/^```(?:json)?\s*/i, "")
				.replace(/\s*```$/i, "")
				.trim(),
		);
	} catch {
		return { err: "模型未返回合法 JSON", content, mode };
	}
	const assembled = assembleDraft(parsed, f as any);
	return { mode, parsed, assembled, facts: f };
}

const CASES: { topic: string; facts: Record<string, string> }[] = [
	{
		topic: "某新番成人動畫介紹",
		facts: {
			作品名: "测试作品甲",
			集数: "全12话",
			制作: "测试社",
			漢化: "https://example.com/hh",
			無修: "https://example.com/uncen",
			简介: "校园日常题材",
		},
	},
	{
		topic: "某成人同人漫畫推薦",
		facts: {
			作品名: "测试同人乙",
			题材: "同人本",
			简介: "人气角色二创",
			漢化: "https://example.com/manga",
		},
	},
	{ topic: "缺事实压力测试", facts: { 作品名: "只给名丙" } },
];

const URL_RE = /https?:\/\/[^\s"'<>]+/gi;

describe.skipIf(!KEY)("validate-grounding", () => {
	it.each(CASES)("should pass case $topic", async (c) => {
		const r = await generate(c.topic, c.facts);
		expect(r.err).toBeUndefined();

		// 审计:body 里所有 URL 必须都来自 facts
		const inputUrls: string[] =
			Object.values(c.facts).join(" ").match(URL_RE) || [];
		const bodyUrls = (r.assembled?.body.match(URL_RE) || []).map((u) =>
			u.replace(/&quot;.*$/, ""),
		);
		const stray = bodyUrls.filter((u) => !inputUrls.includes(u));
		expect(stray).toHaveLength(0);

		// 审计:模型散文里是否冒出 URL
		const parsed = r.parsed as any;
		const proseUrls =
			[parsed.intro, parsed.highlights, parsed.outro].join(" ").match(URL_RE) ||
			[];
		expect(proseUrls).toHaveLength(0);

		// 端到端 fixture: 事实输入 -> 模型 JSON -> 组装草稿 -> grounding gate 测试
		// 测试是否会被拦截 (缺作品名、或者有占位符)
		const draftMock = {
			title: r.assembled?.title,
			body: r.assembled?.body,
		} as ContentDraft;
		const verdict = evaluateGrounding(draftMock, r.facts as any);

		// 如果是"缺事实压力测试" case，作品名是只给名丙，没有其它，可能被拦吗？
		// 我们的 evaluateGrounding 只有在 draft.title 或 draft.body 包含 PLACEHOLDER 时，或者有无来源连结时拦。
		// 如果提供了作品名，就不会有 title PLACEHOLDER。如果模型没造假 URL，就没有 body PLACEHOLDER。
		if (c.topic === "缺事实压力测试") {
			// 没提供连结和其他字段，只给了名丙
			expect(verdict.ok).toBe(true);
		} else {
			expect(verdict.ok).toBe(true);
		}
	});
});
