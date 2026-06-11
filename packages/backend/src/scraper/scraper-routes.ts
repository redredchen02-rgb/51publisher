import type { FastifyInstance } from "fastify";
import { err } from "../error-response.js";
import { extractFacts } from "./fact-extractor.js";
import { type PendingTopic, savePendingTopic } from "./pending-store.js";
import { scraperConfig } from "./scraper-config.js";
import { isHostAllowed, loadSSRFAllowlist } from "./ssrf-allowlist.js";
import { type EnrichedContext, enrichContext } from "./web-enricher.js";

interface TriggerBody {
	siteName: string;
	url?: string;
}

export async function registerScraperRoutes(
	app: FastifyInstance,
): Promise<void> {
	// 手动触发单个站点的抓取
	app.post<{ Body: TriggerBody }>(
		"/api/v1/scraper/trigger",
		async (request, reply) => {
			const { siteName, url } = request.body;

			if (!siteName) {
				return err(reply, 400, "Missing required field: siteName");
			}

			const config = scraperConfig.getSiteConfig(siteName);
			if (!config || !config.enabled) {
				return err(
					reply,
					404,
					`Site config not found or disabled: ${siteName}`,
				);
			}

			const adapter = scraperConfig.getAdapter(config.adapterName);
			if (!adapter) {
				return err(reply, 500, `Adapter not registered: ${config.adapterName}`);
			}

			// List-discovery mode: if no URL supplied and config.listUrl exists, scan the list page.
			let targetUrl: string;
			if (url) {
				targetUrl = url;
			} else if (!url && config.listUrl && adapter.fetchList) {
				request.log.info(`List-discovery mode: scanning ${config.listUrl}`);
				let discovered: string[];
				try {
					discovered = await adapter.fetchList(config.listUrl);
				} catch (e) {
					const msg = e instanceof Error ? e.message : String(e);
					return err(reply, 500, `fetchList failed: ${msg}`);
				}
				if (discovered.length === 0) {
					return err(
						reply,
						404,
						`No articles found at list URL: ${config.listUrl}`,
					);
				}
				// Pick a random article from the discovered list.
				targetUrl = discovered[Math.floor(Math.random() * discovered.length)]!;
				request.log.info(
					`Discovered ${discovered.length} URLs, selected: ${targetUrl}`,
				);
			} else {
				targetUrl = config.url;
			}

			if (!targetUrl) {
				return err(reply, 400, "No URL provided and no default URL in config");
			}

			// SSRF allowlist: caller-supplied url must share hostname and protocol with the registered site config.
			// Also reject URLs with credentials (userinfo) to prevent bypass via http://evil@allowed.com/.
			if (url) {
				let parsed: URL;
				let configParsed: URL;
				try {
					parsed = new URL(url);
					configParsed = new URL(config.url);
				} catch {
					return err(reply, 400, "Invalid URL format");
				}
				if (parsed.username || parsed.password) {
					return err(reply, 400, "URL credentials not allowed");
				}
				if (parsed.hostname !== configParsed.hostname) {
					return err(
						reply,
						400,
						`URL hostname not allowed for site ${siteName}: ${parsed.hostname}`,
					);
				}
				if (parsed.protocol !== configParsed.protocol) {
					return reply.status(400).send({
						ok: false,
						error: `URL protocol not allowed for site ${siteName}: ${parsed.protocol}`,
					});
				}

				if (!isHostAllowed(parsed, loadSSRFAllowlist())) {
					return reply.status(403).send({
						ok: false,
						error: `URL hostname blocked by SSRF allowlist: ${parsed.hostname}`,
					});
				}
			}

			const llmEndpoint = process.env.LLM_ENDPOINT;
			const llmApiKey = process.env.LLM_API_KEY;

			if (!llmEndpoint || !llmApiKey) {
				return err(
					reply,
					500,
					"LLM_ENDPOINT and LLM_API_KEY must be set in .env",
				);
			}

			try {
				// Step 1: Fetch raw content via adapter
				request.log.info(
					`Fetching content from ${targetUrl} via adapter ${adapter.name}`,
				);
				const rawContent = await adapter.fetchContent(targetUrl);

				// Step 2: Extract facts via LLM
				request.log.info("Extracting facts via LLM");
				const { facts, confidence, coverImageUrl } = await extractFacts(
					rawContent,
					{
						endpoint: llmEndpoint,
						apiKey: llmApiKey,
						model: process.env.LLM_MODEL || "gpt-4o-mini",
					},
				);

				// Step 3: Web search enrichment
				let enrichment: EnrichedContext | undefined;
				if (process.env.ENRICHMENT_ENABLED !== "false") {
					request.log.info("Enriching via web search");
					try {
						const maxQ = Math.min(
							Math.max(
								Number(process.env.ENRICHMENT_MAX_QUERIES ?? "3") || 3,
								1,
							),
							10,
						);
						enrichment = await enrichContext({ facts, maxQueries: maxQ });
						const totalResults = enrichment.queryResults.reduce(
							(sum, qr) => sum + qr.results.length,
							0,
						);
						request.log.info(`Enrichment complete: ${totalResults} results`);
					} catch (enrichErr) {
						request.log.warn(`Enrichment failed (non-fatal): ${enrichErr}`);
					}
				}

				// Step 4: Save as pending topic
				const now = new Date().toISOString();
				const id = `scrape_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
				const pendingTopic: PendingTopic = {
					id,
					sourceUrl: targetUrl,
					siteName: config.siteName,
					title: rawContent.title,
					rawContent,
					facts,
					confidence,
					...(coverImageUrl ? { coverImageUrl } : {}),
					...(enrichment ? { enrichment } : {}),
					status: "pending",
					createdAt: now,
					updatedAt: now,
				};

				await savePendingTopic(pendingTopic);

				return { ok: true, pendingTopic };
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e);
				request.log.error(err, `Scrape failed for ${siteName}`);
				return err(reply, 500, `Scrape failed: ${msg}`);
			}
		},
	);

	// 列出已注册的适配器
	app.get("/api/v1/scraper/adapters", async () => {
		const adapters = scraperConfig.listAdapters().map((a) => ({
			name: a.name,
		}));
		return { ok: true, adapters };
	});

	// 列出已配置的站点
	app.get("/api/v1/scraper/sites", async () => {
		const sites = scraperConfig.listSiteConfigs();
		return { ok: true, sites };
	});
}
