import type { FactsBlock, GenerateDraftResponse } from "@51guapi/shared";
import { generateDraft } from "./api/llm";
import { assemblePrompt, buildConstraintSuffix } from "./core/prompt-assembly";
import { logger } from "./logger";

// Re-export for backward-compat.
export { buildConstraintSuffix, generateDraft };

export interface BackgroundHandlerDeps {
	getSettings: () => Promise<import("@51guapi/shared").Settings>;
	getApiKey: () => Promise<string>;
	tabsGet: (tabId: number) => Promise<{ url?: string; id?: number }>;
	tabsSendMessage: (tabId: number, msg: unknown) => Promise<unknown>;
	storageGetItem: <T>(key: `local:${string}`) => Promise<T | null>;
	storageSetItem: (key: `local:${string}`, value: unknown) => Promise<void>;
	generateDraftFn: (
		prompt: string,
		opts: {
			settings: import("@51guapi/shared").Settings;
			apiKey: string;
			facts?: FactsBlock;
			enrichment?: string;
		},
	) => Promise<GenerateDraftResponse>;
}

export function createHandlers(deps: BackgroundHandlerDeps) {
	return {
		async handleGenerate(prompt: string) {
			try {
				const [settings, apiKey] = await Promise.all([
					deps.getSettings(),
					deps.getApiKey(),
				]);
				const suffix = buildConstraintSuffix(settings.recommendedTags ?? []);
				const fullPrompt = suffix ? `${prompt}\n\n${suffix}` : prompt;
				return await deps.generateDraftFn(fullPrompt, {
					settings,
					apiKey,
				});
			} catch (err) {
				return {
					ok: false,
					error: err instanceof Error ? err.message : String(err),
				} as const;
			}
		},
	};
}
