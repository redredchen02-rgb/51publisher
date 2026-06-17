// Shared types and utilities for 51guapi monorepo

export {
	type Batch,
	type BatchItem,
	type BatchItemStatus,
	isTerminal,
	recoverBatch,
	TERMINAL,
} from "./batch.js";
export { toDraft } from "./draft.js";
export type { FactKey, FactsBlock, FactTarget, ParsedTopic } from "./facts.js";
export {
	applyPromptTemplate,
	CORE_FACT_KEYS,
	FACT_ORDER,
	FACT_TARGET,
	factUrls,
	formatFactsForPrompt,
	isEmptyFacts,
	parseTopicLine,
} from "./facts.js";
export type { FetchWithTimeoutOptions } from "./fetch.js";
export { fetchWithTimeout } from "./fetch.js";
export {
	DEFAULT_FIELD_MAPPING,
	isValidFieldMapping,
	VALID_FIELD_TYPES,
} from "./field-mapping.js";
export type { AssembledDraft, DraftSlots } from "./post-assembler.js";
export {
	assembleDraft,
	containsPlaceholder,
	esc,
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
	FirstFlightRehearseResult,
	FirstFlightRunResult,
	FirstFlightStatusResult,
	GenerateDraftResponse,
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
