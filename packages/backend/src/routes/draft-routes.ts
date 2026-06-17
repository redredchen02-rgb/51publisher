import type { FactsBlock, Settings } from "@51guapi/shared";
import type { FastifyInstance } from "fastify";
import {
	generateDraft,
	listModels,
	reviewDraftLlm,
	rewriteDraftLlm,
} from "../services/llm.js";
import { recordDraft } from "../services/metrics.js";
import { err } from "../utils/error-response.js";
import { getLlmConfig, validateLlmConfig } from "../utils/llm-config.js";
import {
	GenerateDraftBody as GenerateDraftBodySchema,
	GenerateDraftResponse,
	ReviewDraftBody as ReviewDraftBodySchema,
	RewriteDraftBody as RewriteDraftBodySchema,
} from "../utils/schemas.js";

interface GenerateDraftBody {
	prompt: string;
	settings: Settings;
	facts?: FactsBlock;
	enrichment?: string;
}

export function registerDraftRoutes(app: FastifyInstance): void {
	app.get("/api/v1/models", async (request, reply) => {
		const config = getLlmConfig();
		const validation = validateLlmConfig(config);
		if (!validation.valid)
			return err(reply, 500, validation.error ?? "Unknown error");
		try {
			return await listModels(config.endpoint, config.apiKey);
		} catch (e) {
			request.log.error(e, "Failed to fetch models list");
			return err(reply, 500, "Failed to fetch models from the LLM service.");
		}
	});

	app.post<{ Body: GenerateDraftBody }>(
		"/api/v1/drafts/generate",
		{
			config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
			schema: {
				body: GenerateDraftBodySchema,
				response: { 200: GenerateDraftResponse },
			},
		},
		async (request, reply) => {
			const { prompt, settings, facts, enrichment } = request.body;
			const config = getLlmConfig(settings);
			const validation = validateLlmConfig(config);
			if (!validation.valid)
				return err(reply, 500, validation.error ?? "Unknown error", "no-key");
			const resolvedSettings = {
				...settings,
				endpoint: config.endpoint.trim(),
				model: config.model,
			};
			try {
				const result = await generateDraft(prompt, {
					settings: resolvedSettings,
					apiKey: config.apiKey,
					facts,
					enrichment,
				});
				if (!result.ok) {
					recordDraft(false);
					return err(reply, 422, result.error, result.kind);
				}
				recordDraft(true);
				return result;
			} catch (e) {
				recordDraft(false);
				request.log.error(e, "Failed to generate draft via LLM");
				return err(
					reply,
					500,
					"Internal server error during draft generation.",
					"network",
				);
			}
		},
	);

	app.post<{
		Body: {
			draft: import("@51guapi/shared").ContentDraft;
			criteriaPrompt?: string;
			settings: import("@51guapi/shared").Settings;
		};
	}>(
		"/api/v1/drafts/review",
		{
			schema: {
				body: ReviewDraftBodySchema,
			},
		},
		async (request, reply) => {
			const { draft, criteriaPrompt, settings } = request.body;
			const config = getLlmConfig(settings);
			const validation = validateLlmConfig(config);
			if (!validation.valid)
				return err(reply, 500, validation.error ?? "Unknown error");
			const resolvedSettings = {
				...settings,
				endpoint: config.endpoint,
				model: config.model,
			};
			try {
				const result = await reviewDraftLlm(draft, criteriaPrompt, {
					settings: resolvedSettings,
					apiKey: config.apiKey,
				});
				if (!result.ok) return err(reply, 422, result.error);
				return result;
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e);
				return err(reply, 500, `Review failed: ${msg}`);
			}
		},
	);

	app.post<{
		Body: {
			draft: import("@51guapi/shared").ContentDraft;
			failedDims: string[];
			settings: import("@51guapi/shared").Settings;
		};
	}>(
		"/api/v1/drafts/rewrite",
		{
			schema: {
				body: RewriteDraftBodySchema,
			},
		},
		async (request, reply) => {
			const { draft, failedDims, settings } = request.body;
			const config = getLlmConfig(settings);
			const validation = validateLlmConfig(config);
			if (!validation.valid)
				return err(reply, 500, validation.error ?? "Unknown error");
			if (failedDims.length === 0)
				return err(reply, 400, "failedDims must be a non-empty array.");
			const resolvedSettings = {
				...settings,
				endpoint: config.endpoint,
				model: config.model,
			};
			try {
				const result = await rewriteDraftLlm(draft, failedDims, {
					settings: resolvedSettings,
					apiKey: config.apiKey,
				});
				if (!result.ok) return err(reply, 422, result.error);
				return result;
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e);
				return err(reply, 500, `Rewrite failed: ${msg}`);
			}
		},
	);
}
