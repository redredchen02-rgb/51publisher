import { accessSync, constants } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { getDb } from "../scraper/pending-db.js";
import { jobs } from "../scraper/scheduler.js";
import { getMetrics } from "../services/metrics.js";
import { HealthzResponse } from "../utils/schemas.js";

export function registerHealthzRoutes(server: FastifyInstance): void {
	server.get<{
		Reply: import("@sinclair/typebox").Static<typeof HealthzResponse>;
	}>(
		"/api/v1/healthz",
		{ schema: { response: { 200: HealthzResponse } } },
		async () => {
			const schedulerRunning = jobs.size > 0;
			const dbHealthy = (() => {
				try {
					getDb().prepare("SELECT 1").get();
					return true;
				} catch {
					return false;
				}
			})();

			// LLM 是否已配置
			const llmConfigured = Boolean(process.env.LLM_ENDPOINT);

			// 存储目录可写性检查
			const storageWritable = (() => {
				try {
					const __dirname = dirname(fileURLToPath(import.meta.url));
					const dataDir =
						process.env.PUBLISHER_DATA_DIR ??
						join(__dirname, "..", "..", "data");
					accessSync(dataDir, constants.W_OK);
					return true;
				} catch {
					return false;
				}
			})();

			// 发布失败率告警:最近 10 批次终态条目，失败率 > 30% 时告警
			let publishFailAlert = false;
			try {
				const rows = getDb()
					.prepare(
						"SELECT items FROM batches ORDER BY created_at DESC LIMIT 10",
					)
					.all() as { items: string }[];
				const allItems = rows.flatMap(
					(r) => JSON.parse(r.items) as Array<{ status: string }>,
				);
				const terminal = allItems.filter((i) =>
					["publish-confirmed", "error", "aborted"].includes(i.status),
				);
				if (terminal.length >= 5) {
					const failed = terminal.filter(
						(i) => i.status !== "publish-confirmed",
					).length;
					publishFailAlert = failed / terminal.length > 0.3;
				}
			} catch {
				// 失败率统计不可用不影响健康检查
			}

			// 质量统计
			let quality = { avgScore: 0, passRate: 0, totalGenerations: 0 };
			try {
				const { getQualityStats } = await import(
					"../services/quality-metrics.js"
				);
				quality = await getQualityStats();
			} catch {
				// 质量统计不可用不影响健康检查
			}

			return {
				ok: true,
				uptime: Math.round(process.uptime()),
				scheduler: { running: schedulerRunning, jobCount: jobs.size },
				database: { healthy: dbHealthy },
				llm: { configured: llmConfigured },
				storage: { writable: storageWritable },
				memory: {
					heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
				},
				quality,
				publishFailAlert,
			} as import("@sinclair/typebox").Static<typeof HealthzResponse>;
		},
	);

	server.get("/api/v1/metrics", async (_request, reply) => {
		reply.header("Content-Type", "text/plain; version=0.0.4");
		return getMetrics();
	});

	// Standard Prometheus scraping endpoint (without API prefix)
	server.get("/metrics", async (_request, reply) => {
		reply.header("Content-Type", "text/plain; version=0.0.4");
		return getMetrics();
	});
}
