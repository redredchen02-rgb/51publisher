// Shared types and utilities for 51publisher monorepo

export type { FactKey, FactsBlock, ParsedTopic } from "./facts.js";
export {
	applyPromptTemplate,
	CORE_FACT_KEYS,
	FACT_ORDER,
	factUrls,
	formatFactsForPrompt,
	isEmptyFacts,
	parseTopicLine,
} from "./facts.js";
export type { FetchWithTimeoutOptions } from "./fetch.js";
export { fetchWithTimeout } from "./fetch.js";
export { DEFAULT_FIELD_MAPPING } from "./field-mapping.js";
export type { AssembledDraft, DraftSlots } from "./post-assembler.js";
export {
	assembleDraft,
	PLACEHOLDER,
	sanitizeToPlainText,
} from "./post-assembler.js";
export type { QualityCheck, QualityVerdict } from "./quality-gate.js";
export { evaluateQuality } from "./quality-gate.js";
export type {
	ContentDraft,
	DraftStatus,
	DryRunItemResult,
	DryRunReport,
	FewShotPair,
	FieldDefinition,
	FieldFillResult,
	FieldMapping,
	FieldType,
	FillPageResponse,
	GenerateDraftResponse,
	PublishPageResponse,
	PublishResult,
	RejectionReason,
	ReviewDimension,
	ReviewResult,
	RuntimeMessage,
	SafetyMode,
	Settings,
} from "./types.js";

export type { CategoryOption } from "./vocab.js";
export { CATEGORY_VOCAB, normalizeCategory } from "./vocab.js";
