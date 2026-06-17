import type { FactsBlock, Settings } from "@51guapi/shared";

export interface LlmDeps {
	settings: Settings;
	apiKey: string;
	facts?: FactsBlock;
	enrichment?: string;
	fetchFn?: typeof fetch;
	now?: () => string;
	genId?: () => string;
	timeoutMs?: number;
	maxRetries?: number;
	retryBaseMs?: number;
	retryCapMs?: number;
	sleep?: (ms: number) => Promise<void>;
}
