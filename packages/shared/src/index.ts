// Shared types and utilities for 51publisher monorepo
export type {
  FewShotPair,
  DraftStatus,
  ContentDraft,
  FieldType,
  FieldDefinition,
  FieldMapping,
  SafetyMode,
  Settings,
  FieldFillResult,
  PublishResult,
  RuntimeMessage,
  DryRunItemResult,
  DryRunReport,
  GenerateDraftResponse,
  FillPageResponse,
  PublishPageResponse,
  ReviewDimension,
  ReviewResult,
  RejectionReason,
} from './types.js';

export type { FactsBlock, FactKey, ParsedTopic } from './facts.js';
export {
  FACT_ORDER,
  parseTopicLine,
  isEmptyFacts,
  factUrls,
  formatFactsForPrompt,
  applyPromptTemplate,
} from './facts.js';

export { DEFAULT_FIELD_MAPPING } from './field-mapping.js';

export type { DraftSlots, AssembledDraft } from './post-assembler.js';
export { PLACEHOLDER, sanitizeToPlainText, assembleDraft } from './post-assembler.js';

export type { CategoryOption } from './vocab.js';
export { CATEGORY_VOCAB, normalizeCategory } from './vocab.js';
