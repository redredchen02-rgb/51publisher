import type { ContentDraft, ReviewResult } from "@51publisher/shared";
import { callLlmForJson } from "./http.js";
import type { LlmDeps } from "./types.js";

export function extractUsage(
	raw: unknown,
): { prompt: number; completion: number } | undefined {
	if (typeof raw !== "object" || raw === null) return undefined;
	const u = (raw as Record<string, unknown>).usage;
	if (typeof u !== "object" || u === null) return undefined;
	const obj = u as Record<string, unknown>;
	const prompt =
		typeof obj.prompt_tokens === "number"
			? obj.prompt_tokens
			: typeof obj.inputTokens === "number"
				? obj.inputTokens
				: undefined;
	const completion =
		typeof obj.completion_tokens === "number"
			? obj.completion_tokens
			: typeof obj.outputTokens === "number"
				? obj.outputTokens
				: undefined;
	if (prompt === undefined || completion === undefined) return undefined;
	return { prompt, completion };
}

const DEFAULT_CRITERIA = `你是专业内容评审员。请对以下帖子草稿进行四维评审。

四个维度：
1. body_richness（正文丰富度）：正文字数≥150字、内容实质丰富、不空洞单薄。
2. community_tone（社区口吻）：文风贴近动漫社区，口语化接地气，不过于官方生硬。
3. title_quality（标题质量）：标题有信息量、吸引人，让读者想点进去看。
4. category_accuracy（分类准确性）：分类和标签准确匹配内容，标签有实际含义。

仅输出 JSON，格式：{"dimensions":[{"name":"body_richness","pass":true,"reason":"一句话"},{"name":"community_tone","pass":true,"reason":"一句话"},{"name":"title_quality","pass":true,"reason":"一句话"},{"name":"category_accuracy","pass":true,"reason":"一句话"}]}`;

const DIM_LABELS: Record<string, string> = {
	body_richness: "正文（需更丰富充实，≥150字，有实质内容）",
	community_tone: "正文风格（需更贴近动漫社区口吻，口语化接地气）",
	title_quality: "标题（需更吸引人、有信息量）",
	category_accuracy: "分类和标签（需更准确匹配内容）",
};

export function buildReviewPrompt(
	draft: ContentDraft,
	criteriaPrompt?: string,
): string {
	const criteria = criteriaPrompt?.trim() || DEFAULT_CRITERIA;
	const bodyText = draft.body.replace(/<[^>]+>/g, "").trim();
	return `${criteria}

草稿：
标题：${draft.title}
分类：${draft.category}
标签：${draft.tags.join("、") || "（无）"}
正文：${bodyText}`;
}

export function buildRewritePrompt(
	draft: ContentDraft,
	failedDims: string[],
): string {
	const targets = failedDims.map((d) => DIM_LABELS[d] ?? d).join("\n- ");
	const bodyText = draft.body.replace(/<[^>]+>/g, "").trim();
	return `以下帖子草稿有以下维度未达标，请**仅**针对这些维度重写，其他字段不变：
- ${targets}

原草稿：
标题：${draft.title}
分类：${draft.category}
标签：${draft.tags.join("、") || "（无）"}
正文：${bodyText}

仅输出 JSON（包含需重写的字段，未改动字段省略）：
{"title":"改后标题","body":"<p>改后正文</p>","tags":["改后标签1","改后标签2"]}`;
}

export type ReviewDraftResult =
	| {
			ok: true;
			result: ReviewResult;
			reviewCostTokens?: { prompt: number; completion: number };
	  }
	| { ok: false; error: string };

export async function reviewDraftLlm(
	draft: ContentDraft,
	criteriaPrompt: string | undefined,
	deps: LlmDeps,
): Promise<ReviewDraftResult> {
	const prompt = buildReviewPrompt(draft, criteriaPrompt);
	const result = await callLlmForJson(prompt, deps, "评审");
	if (!result.ok) return { ok: false, error: result.error };

	const { raw, parsed } = result;

	const dims = parsed.dimensions;
	if (!Array.isArray(dims))
		return { ok: false, error: "评审结果缺少 dimensions 字段。" };

	const dimensions = dims
		.filter(
			(d): d is Record<string, unknown> => typeof d === "object" && d !== null,
		)
		.map((d) => ({
			name: String(d.name ?? ""),
			pass: Boolean(d.pass),
			...(d.reason !== undefined ? { reason: String(d.reason) } : {}),
		}))
		.filter((d) => d.name.length > 0);

	const reviewCostTokens = extractUsage(raw);
	return {
		ok: true,
		result: { ok: true, dimensions },
		...(reviewCostTokens ? { reviewCostTokens } : {}),
	};
}

export type RewriteDraftResult =
	| {
			ok: true;
			draft: ContentDraft;
			rewriteCostTokens?: { prompt: number; completion: number };
	  }
	| { ok: false; error: string };

export async function rewriteDraftLlm(
	draft: ContentDraft,
	failedDims: string[],
	deps: LlmDeps,
): Promise<RewriteDraftResult> {
	const prompt = buildRewritePrompt(draft, failedDims);
	const result = await callLlmForJson(prompt, deps, "重写");
	if (!result.ok) return { ok: false, error: result.error };

	const { raw, parsed } = result;

	const rewritten: ContentDraft = { ...draft };
	if (typeof parsed.title === "string" && parsed.title.trim())
		rewritten.title = parsed.title.trim();
	if (typeof parsed.body === "string" && parsed.body.trim())
		rewritten.body = parsed.body.trim();
	if (Array.isArray(parsed.tags)) {
		rewritten.tags = parsed.tags.map((t) => String(t)).filter(Boolean);
	}

	const rewriteCostTokens = extractUsage(raw);
	return {
		ok: true,
		draft: rewritten,
		...(rewriteCostTokens ? { rewriteCostTokens } : {}),
	};
}
