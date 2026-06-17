import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";
import Fastify from "fastify";
import { PUBLIC_ROUTES, requireAuth } from "./middleware/auth-middleware.js";
import { registerAuthRoutes } from "./routes/auth-routes.js";
import { registerBatchRoutes } from "./routes/batch-routes.js";
import { registerConfigRoutes } from "./routes/config-routes.js";
import { registerHealthzRoutes } from "./routes/healthz-routes.js";
import { registerPendingRoutes } from "./routes/pending-routes.js";
import { registerPreflightRoutes } from "./routes/preflight-routes.js";
import { registerPromptRoutes } from "./routes/prompt-routes.js";
import { registerPublishedPostsRoutes } from "./routes/published-posts-routes.js";
import { registerScraperRoutes } from "./routes/scraper-routes.js";
import { demoAdapter } from "./scraper/adapters/demo-adapter.js";
import { initPendingDb } from "./scraper/pending-db.js";
import { startScheduler } from "./scraper/scheduler.js";
import { scraperConfig } from "./scraper/scraper-config.js";
import { startRevisitJob } from "./services/revisit-job.js";

export function buildApp(): FastifyInstance {
	initPendingDb();
	// 日志:env 控制 level(默认 info);redaction 防鉴权头/密钥落日志(secret-hygiene)。
	const server = Fastify({
		genReqId: () => crypto.randomUUID(),
		bodyLimit: 1048576, // 1MB 全局 body 大小限制
		logger: {
			level: process.env.LOG_LEVEL ?? "info",
			redact: {
				paths: [
					"req.headers.authorization",
					"req.headers.cookie",
					'req.headers["x-api-key"]',
					"*.password",
					"*.token",
					"*.apiKey",
					"*.JWT_SECRET",
					"*.LLM_API_KEY",
				],
				censor: "[REDACTED]",
			},
		},
	});

	// 注册 Swagger 插件
	void server.register(import("@fastify/swagger"), {
		openapi: {
			openapi: "3.0.0",
			info: {
				title: "51guapi Backend API",
				description: "51guapi 后端 API 文档",
				version: "0.1.0",
			},
			servers: [
				{
					url: "http://localhost:3001",
					description: "开发服务器",
				},
			],
			components: {
				securitySchemes: {
					bearerAuth: {
						type: "http",
						scheme: "bearer",
						bearerFormat: "JWT",
					},
				},
			},
			security: [{ bearerAuth: [] }],
		},
	});

	void server.register(import("@fastify/swagger-ui"), {
		routePrefix: "/docs",
		uiConfig: {
			docExpansion: "list",
			deepLinking: true,
		},
	});

	const corsOrigins = (process.env.CORS_ORIGIN ?? "")
		.split(",")
		.map((s) => s.trim())
		.filter((s) => s && s !== "*");
	server.register(cors, { origin: corsOrigins });
	// 全局 rate limit: 100 req/min；关键端点再通过 per-route config 加严
	server.register(rateLimit, { max: 100, timeWindow: "1 minute" });

	// CSP headers — 纵深防御,防止 XSS 在意外内容类型中执行
	server.addHook("onSend", async (_request, reply, payload) => {
		reply.header(
			"Content-Security-Policy",
			"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'",
		);
		return payload;
	});

	// ---- 路由注册 ----
	registerHealthzRoutes(server);
	registerAuthRoutes(server);
	server.addHook("preHandler", async (request, reply) => {
		const url = request.url.split("?")[0];
		if (PUBLIC_ROUTES.has(url)) return;
		return requireAuth(request, reply);
	});
	registerConfigRoutes(server);
	registerPreflightRoutes(server);
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

	return server;
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
