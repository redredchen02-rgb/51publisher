import type { FactsBlock, Settings } from "@51publisher/shared";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";
import Fastify from "fastify";
import { PUBLIC_ROUTES, requireAuth } from "./middleware/auth-middleware.js";
import { registerAuthRoutes } from "./routes/auth-routes.js";
import { registerBatchRoutes } from "./routes/batch-routes.js";
import { registerConfigRoutes } from "./routes/config-routes.js";
import { registerPublishedPostsRoutes } from "./routes/published-posts-routes.js";
import { acgs51Adapter } from "./scraper/adapters/acgs51-adapter.js";
import { demoAdapter } from "./scraper/adapters/demo-adapter.js";
import { getDb, initPendingDb } from "./scraper/pending-db.js";
import { registerPendingRoutes } from "./scraper/pending-routes.js";
import { registerPromptRoutes } from "./scraper/prompt-routes.js";
import { jobs, startScheduler } from "./scraper/scheduler.js";
import { scraperConfig } from "./scraper/scraper-config.js";
import { registerScraperRoutes } from "./scraper/scraper-routes.js";
import {
	generateDraft,
	listModels,
	reviewDraftLlm,
	rewriteDraftLlm,
} from "./services/llm.js";
import { getMetrics } from "./services/metrics.js";
import { startRevisitJob } from "./services/revisit-job.js";
import { err } from "./utils/error-response.js";
import { getLlmConfig, validateLlmConfig } from "./utils/llm-config.js";
import {
	GenerateDraftBody as GenerateDraftBodySchema,
	GenerateDraftResponse,
	ReviewDraftBody as ReviewDraftBodySchema,
	RewriteDraftBody as RewriteDraftBodySchema,
} from "./utils/schemas.js";

export function buildApp(): FastifyInstance {
	initPendingDb();
	const server = Fastify({ logger: true });

	const corsOrigins = (process.env.CORS_ORIGIN ?? "")
		.split(",")
		.map((s) => s.trim())
		.filter((s) => s && s !== "*");
	server.register(cors, { origin: corsOrigins });
	server.register(rateLimit, { max: 100, timeWindow: "1 minute" });

	server.get("/api/v1/healthz", async () => {
		const schedulerRunning = jobs.size > 0;
		const dbHealthy = (() => {
			try {
				getDb().prepare("SELECT 1").get();
				return true;
			} catch {
				return false;
			}
		})();

		// 质量统计
		let quality = { avgScore: 0, passRate: 0, totalGenerations: 0 };
		try {
			const { getQualityStats } = await import("./services/quality-metrics.js");
			quality = await getQualityStats();
		} catch {
			// 质量统计不可用不影响健康检查
		}

		return {
			ok: true,
			uptime: Math.round(process.uptime()),
			scheduler: { running: schedulerRunning, jobCount: jobs.size },
			database: { healthy: dbHealthy },
			memory: {
				heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
			},
			quality,
		};
	});

	server.get("/api/v1/metrics", async (_request, reply) => {
		reply.header("Content-Type", "text/plain; version=0.0.4");
		return getMetrics();
	});

	registerAuthRoutes(server);
	server.addHook("preHandler", async (request, reply) => {
		const url = request.url.split("?")[0];
		if (PUBLIC_ROUTES.has(url)) return;
		return requireAuth(request, reply);
	});
	registerConfigRoutes(server);
	registerBatchRoutes(server);
	registerScraperRoutes(server);
	registerPendingRoutes(server);
	registerPromptRoutes(server);
	registerPublishedPostsRoutes(server);

	scraperConfig.registerAdapter(demoAdapter);
	scraperConfig.addSiteConfig({
		siteName: "demo",
		adapterName: "demo",
		url: "https://example.com",
		enabled: false,
	});
	scraperConfig.registerAdapter(acgs51Adapter);
	scraperConfig.addSiteConfig({
		siteName: "acgs51",
		adapterName: "acgs51",
		url: process.env.ACGS51_START_URL ?? "",
		listUrl: process.env.ACGS51_LIST_URL || undefined,
		cron: process.env.ACGS51_CRON || "0 */6 * * *",
		enabled: process.env.ACGS51_ENABLED === "true",
	});

	return server;
}

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
		if (!validation.valid) return err(reply, 500, validation.error!);
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
				return err(reply, 500, validation.error!, "no-key");
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
				if (!result.ok) return err(reply, 422, result.error, result.kind);
				return result;
			} catch (e) {
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
			draft: import("@51publisher/shared").ContentDraft;
			criteriaPrompt?: string;
			settings: import("@51publisher/shared").Settings;
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
			if (!validation.valid) return err(reply, 500, validation.error!);
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
			draft: import("@51publisher/shared").ContentDraft;
			failedDims: string[];
			settings: import("@51publisher/shared").Settings;
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
			if (!validation.valid) return err(reply, 500, validation.error!);
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

export function startBackgroundJobs(app: FastifyInstance): void {
	const llmEndpoint = process.env.LLM_ENDPOINT;
	const llmApiKey = process.env.LLM_API_KEY;
	if (llmEndpoint && llmApiKey) {
		startScheduler({
			logger: app.log,
			llmEndpoint,
			llmApiKey,
			llmModel: process.env.LLM_MODEL,
		});
		app.log.info("[scheduler] Cron scheduler started");
	} else {
		app.log.info("[scheduler] Skipped (LLM_ENDPOINT/LLM_API_KEY not set)");
	}
	startRevisitJob({ logger: app.log });
	app.log.info("[revisit] Revisit job started");
}
