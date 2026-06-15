import { Type } from "@sinclair/typebox";

// ── Shared ────────────────────────────────────────────
export const OkStatus = Type.Literal(true);
export const ErrorBody = Type.Object({
	ok: Type.Literal(false),
	error: Type.String(),
	kind: Type.Optional(Type.String()),
});

// ── Settings ──────────────────────────────────────────
export const SettingsSchema = Type.Object({
	endpoint: Type.String(),
	model: Type.String(),
	apiKey: Type.Optional(Type.String()),
	promptTemplate: Type.Optional(Type.String()),
	facts: Type.Optional(Type.String()),
	fewShot: Type.Optional(Type.String()),
	extraInstructions: Type.Optional(Type.String()),
	publishMode: Type.Optional(
		Type.Union([
			Type.Literal("off"),
			Type.Literal("dry-run"),
			Type.Literal("authorized"),
		]),
	),
});

// ── FactsBlock ────────────────────────────────────────
export const FactsBlockSchema = Type.Object({
	intro: Type.Optional(Type.String()),
	highlights: Type.Optional(Type.Array(Type.String())),
	characters: Type.Optional(Type.String()),
	workTitle: Type.Optional(Type.String()),
	episodeNumber: Type.Optional(Type.String()),
});

// ── Drafts ────────────────────────────────────────────
export const GenerateDraftBody = Type.Object({
	prompt: Type.String({ minLength: 1 }),
	settings: SettingsSchema,
	facts: Type.Optional(FactsBlockSchema),
	enrichment: Type.Optional(Type.String()),
});

// 模型叙事槽位(供扩展端重新组装;字段须与 shared/post-assembler.ts 的 DraftSlots 一致)。
export const DraftSlotsSchema = Type.Object({
	titleSuffix: Type.Optional(Type.String()),
	subtitle: Type.Optional(Type.String()),
	intro: Type.String(),
	highlights: Type.String(),
	outro: Type.Optional(Type.String()),
});

export const GenerateDraftResponse = Type.Object({
	ok: OkStatus,
	// 可选:Fastify+TypeBox 会剥除 schema 之外的响应字段,故必须在此声明,否则 slots 被静默丢弃。
	slots: Type.Optional(DraftSlotsSchema),
	draft: Type.Object({
		id: Type.String(),
		title: Type.String(),
		subtitle: Type.String(),
		category: Type.String(),
		coverImageUrl: Type.String(),
		body: Type.String(),
		tags: Type.Array(Type.String()),
		description: Type.String(),
		postStatus: Type.String(),
		publishedAt: Type.String(),
		mediaId: Type.String(),
		status: Type.String(),
		createdAt: Type.String(),
	}),
});

export const ReviewDraftBody = Type.Object({
	draft: Type.Object({
		id: Type.String(),
		title: Type.String(),
		subtitle: Type.String(),
		category: Type.String(),
		coverImageUrl: Type.String(),
		body: Type.String(),
		tags: Type.Array(Type.String()),
		description: Type.String(),
		postStatus: Type.String(),
		publishedAt: Type.String(),
		mediaId: Type.String(),
		status: Type.String(),
		createdAt: Type.String(),
	}),
	criteriaPrompt: Type.Optional(Type.String()),
	settings: SettingsSchema,
});

export const RewriteDraftBody = Type.Object({
	draft: Type.Object({
		id: Type.String(),
		title: Type.String(),
		subtitle: Type.String(),
		category: Type.String(),
		coverImageUrl: Type.String(),
		body: Type.String(),
		tags: Type.Array(Type.String()),
		description: Type.String(),
		postStatus: Type.String(),
		publishedAt: Type.String(),
		mediaId: Type.String(),
		status: Type.String(),
		createdAt: Type.String(),
	}),
	failedDims: Type.Array(Type.String()),
	settings: SettingsSchema,
});

// ── Auth ──────────────────────────────────────────────
export const LoginBody = Type.Object({
	// maxLength bounds the synchronous scrypt cost per request (micro-DoS guard).
	password: Type.String({ minLength: 1, maxLength: 1024 }),
});

export const LoginResponse = Type.Object({
	ok: OkStatus,
	token: Type.String(),
});

export const AuthStatusResponse = Type.Object({
	ok: OkStatus,
	authenticated: Type.Boolean(),
});

// ── Models ────────────────────────────────────────────
export const ModelsResponse = Type.Object({
	ok: OkStatus,
	models: Type.Optional(Type.Array(Type.Unknown())),
});

// ── Batch ─────────────────────────────────────────────
export const CreateBatchBody = Type.Object({
	id: Type.String({ minLength: 1 }),
	tabId: Type.Number(),
	authorizedHost: Type.String({ minLength: 1 }),
	topics: Type.Array(Type.String({ minLength: 1 }), {
		minItems: 1,
		maxItems: 20,
	}),
	facts: Type.Optional(
		Type.Array(Type.Optional(Type.Record(Type.String(), Type.Unknown()))),
	),
});

// ── Scraper ──────────────────────────────────────────
export const TriggerScrapeBody = Type.Object({
	siteName: Type.String({ minLength: 1 }),
	url: Type.Optional(Type.String()),
});

// ── Prompts ──────────────────────────────────────────
export const CreatePromptBody = Type.Object({
	name: Type.String({ minLength: 1, maxLength: 100 }),
	template: Type.String({ minLength: 1, maxLength: 50000 }),
	fewShotExamples: Type.Optional(Type.String({ maxLength: 50000 })),
	model: Type.Optional(Type.String({ maxLength: 100 })),
});

export const UpdatePromptBody = Type.Object({
	name: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
	template: Type.Optional(Type.String({ minLength: 1, maxLength: 50000 })),
	fewShotExamples: Type.Optional(Type.String({ maxLength: 50000 })),
	model: Type.Optional(Type.String({ maxLength: 100 })),
});
