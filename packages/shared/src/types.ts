// 三层(side panel / background / content script)共享的类型定义。
// Migrated from both packages/backend/src/shared/types.ts and packages/extension/lib/types.ts
import type { FactsBlock } from "./facts.js";
import type { DraftSlots } from "./post-assembler.js";

/** Few-shot 范例对(结构化版;R11-R13)。source of truth;fewShotExamples 由此派生。 */
export interface FewShotPair {
	input: string;
	output: string;
}

/** 草稿在本插件内的生命周期状态(注意与后台表单的"显示/隐藏"状态 postStatus 区分)。 */
export type DraftStatus = "draft" | "filled" | "published";

/**
 * 一条内容草稿。AI 生成 title/subtitle/category/body/tags/description;
 * postStatus/publishedAt/mediaId 由人工在 side panel 填写或取默认值(非 AI 生成)。
 */
export interface ContentDraft {
	id: string;
	title: string;
	subtitle: string;
	/** 后台分类(对应 select[name=type] 的 value,如 "2"/"4")。 */
	category: string;
	/** 封面图 URL;自动抓取时由适配器提供,填入后台 input[name=cover_url] 隐藏字段。 */
	coverImageUrl: string;
	/** 正文 HTML(写入 Quill 前需消毒)。 */
	body: string;
	tags: string[];
	/** 描述/摘要(AI 生成)。 */
	description: string;
	/** 后台显示状态:'0'=隐藏,'1'=显示。 */
	postStatus: "0" | "1";
	/** 发布时间 yyyy-MM-dd。 */
	publishedAt: string;
	/** 关联作品 id。 */
	mediaId: string;
	status: DraftStatus;
	/** ISO 时间戳。 */
	createdAt: string;
	/** Web 富化上下文(可选;来自 web-enricher)。 */
	enrichment?: string;
}

/** 字段填充策略类型。U0 确认本后台用到 text/textarea/quill/native-select/checkbox-multi/date。 */
export type FieldType =
	| "text"
	| "textarea"
	| "quill"
	| "native-select"
	| "checkbox-multi"
	| "date"
	| "custom-dropdown"
	| "tag-input";

/** 单个字段:稳定选择器 + 填充类型。 */
export interface FieldDefinition {
	selector: string;
	fieldType: FieldType;
	label?: string;
}

/** 草稿字段 → 页面元素的映射。键为 ContentDraft 的可填字段。 */
export type FieldMapping = Partial<
	Record<
		| "title"
		| "subtitle"
		| "category"
		| "body"
		| "tags"
		| "description"
		| "postStatus"
		| "publishedAt"
		| "mediaId"
		| "coverUrl",
		FieldDefinition
	>
>;

/**
 * 发布安全档位(自主发布器闸门)。
 * - 'off':今天的行为——背景永不发"准许",无任何提交路径。
 * - 'dry-run':跑完整流程但不发"准许",只产出"将发布什么"的报告。
 * - 'authorized':仅当目标 tab 的 host 命中授权名单才发"准许"。
 */
export type SafetyMode = "off" | "dry-run" | "authorized";

/** 用户可配置的设置(API key 单独存取,不在此对象内)。 */
export interface Settings {
	/** 大模型 endpoint(OpenAI 兼容 chat/completions),须为 https。 */
	endpoint: string;
	/** 模型名。 */
	model: string;
	/** 备用模型名(主模型超时或 5xx 时自动切换重试，留空则不使用)。 */
	fallbackModel?: string;
	/** prompt 模板,用户主题会注入其中。支持占位符 {{topic}} {{facts}} {{fewshot}}。 */
	promptTemplate: string;
	/**
	 * 51娘 few-shot 范例原始字符串(后端 prompt 注入用)。
	 * @deprecated 使用 fewShotPairs 作为编辑源;保存时由 fewShotPairs 派生此字段(向前兼容)。
	 */
	fewShotExamples?: string;
	/** 结构化 few-shot 范例列表(R11-R13);与 fewShotExamples 并存,fewShotPairs 为编辑源。 */
	fewShotPairs?: FewShotPair[];
	/** 运营者维护的推荐标签子集(~20-50 条);注入 prompt 约束,防模型造词(R5-R6)。 */
	recommendedTags?: string[];
	/** 字段映射(可在设置页编辑)。 */
	fieldMapping: FieldMapping;
	/** 51publisher 后端 URL（http://localhost:3001 等）;空=不启用后端双写。 */
	backendUrl?: string;
	/** AI 评审标准 prompt（Phase 3）;空时使用内置四维默认标准。 */
	reviewCriteriaPrompt?: string;
	/** 每日批量自动发帖上限（Phase 5）;有效范围 [1, 20],默认 5。 */
	dailyBatchSize?: number;
	/** 是否启用 Web 搜索富化（默认 true）;启用后抓取时自动搜索补充资讯。 */
	webSearchEnabled?: boolean;
}

// ---- 消息协议(side panel ↔ background ↔ content script) ----

/** 单字段填充结果。 */
export interface FieldFillResult {
	field: string;
	status: "filled" | "skipped" | "degraded";
	note?: string;
}

/** 发布结果(content 执行后回传 background,再回 side panel)。绝不含 key/CSRF/登录态。 */
export interface PublishResult {
	ok: boolean;
	/** 发布成功后的帖子 URL(若后台返回);回滚依据。 */
	url?: string;
	/** 结构化错误码,绝不带敏感串。 */
	error?: string;
	/** 是否 dry-run(走完流程但未真正提交)。 */
	dryRun: boolean;
	/** URL 来源:save 响应直取 / ID 推导 / 不可得。 */
	urlSource?: "from_save" | "derived_id" | "not_available";
}

export type RuntimeMessage =
	| { type: "GENERATE_DRAFT"; prompt: string }
	| { type: "FILL_PAGE"; draft: ContentDraft }
	// background → content:一次性"准许"。content 只在收到此消息时才触发提交。
	| { type: "PUBLISH_GRANT" }
	// side panel → background:批量编排(均显式 tabId,绝不查 active)。
	// facts / coverImageUrls 与 topics 同序平行;iterate=true 走"只生成不发"迭代通道(绕重入闸)。
	| {
			type: "RUN_BATCH";
			topics: string[];
			tabId: number;
			facts?: FactsBlock[];
			iterate?: boolean;
			coverImageUrls?: string[];
			/** 与 topics 同序平行;同索引 = 同选题。handleRunBatch 写入 item.pendingTopicId。 */
			topicIds?: string[];
			/** 预格式化的 web 搜索富化文本（可选），与 topics 同序平行。 */
			enrichments?: (string | undefined)[];
	  }
	| {
			type: "APPROVE_BATCH";
			tabId: number;
			draftOverrides?: Record<string, ContentDraft>;
	  }
	| { type: "KILL_BATCH" }
	| { type: "RELEASE_QUARANTINE"; itemId: string }
	| { type: "RELEASE_QUARANTINE_BATCH" }
	| { type: "RETRY_BATCH_ITEM"; itemId: string }
	| {
			type: "DISCARD_BATCH_ITEM";
			itemId: string;
			rejectionReason?: RejectionReason;
	  }
	| { type: "GET_BATCH" }
	// side panel → background:标记操作者已手动修改该条草稿(直发率度量)。
	| { type: "MARK_ITEM_EDITED"; itemId: string }
	// side panel → background:单条发布(approve + fill + publish 单条 awaiting-approval)。
	| { type: "APPROVE_SINGLE_ITEM"; tabId: number; itemId: string }
	// side panel → background:操作者补齐缺失事实 → 重组装 + 重跑闸门(gate-failed → awaiting-approval)。
	// 特权通道:仅 side panel 可发;mutate facts/draft/snapshot 并驱动提升,绝不自我授权发布。
	// facts 为操作者补的事实覆盖(Partial<FactsBlock>);background 与 item.facts 合并后重跑 assembleDraft。
	| { type: "REFILL_ITEM_FACTS"; itemId: string; facts: Partial<FactsBlock> }
	// side panel → content:轻量选择器漂移自检(R6 轻量)。
	| { type: "CHECK_SELECTORS" };

export interface DryRunItemResult {
	itemId: string;
	topic: string;
	fillResults: FieldFillResult[];
	draftTitle?: string;
}

export interface DryRunReport {
	batchId: string;
	ts: string;
	items: DryRunItemResult[];
}

/** 拒绝原因枚举值（路由层校验；DB 列保留 TEXT 存储字符串值）。 */
export type RejectionReason =
	| "duplicate"
	| "quality"
	| "topic_mismatch"
	| "missing_facts"
	| "other";

/** AI 评审单维度结果。 */
export interface ReviewDimension {
	name: string;
	pass: boolean;
	reason?: string;
}

/** AI 评审 LLM 响应结果（Phase 3）。 */
export interface ReviewResult {
	ok: boolean;
	dimensions?: ReviewDimension[];
}

export type GenerateDraftResponse =
	| {
			ok: true;
			draft: ContentDraft;
			/** 模型叙事槽位;扩展端据此重新组装(re-assemble)。旧响应可能缺省。 */
			slots?: DraftSlots;
			llmCostTokens?: {
				prompt: number;
				completion: number;
				estimated?: boolean;
			};
			/** 质量警告（非阻塞，供 UI 提示）。 */
			qualityWarnings?: Array<{ name: string; message: string }>;
	  }
	| { ok: false; error: string; kind?: "no-key" | "network" | "format" };

export type FillPageResponse =
	| { ok: true; results: FieldFillResult[] }
	| { ok: false; error: string };
