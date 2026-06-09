import type { FastifyInstance } from 'fastify';
import { scraperConfig } from './scraper-config.js';
import { extractFacts } from './fact-extractor.js';
import { savePendingTopic, type PendingTopic } from './pending-store.js';

interface TriggerBody {
  siteName: string;
  url?: string;
}

export async function registerScraperRoutes(app: FastifyInstance): Promise<void> {
  // 手动触发单个站点的抓取
  app.post<{ Body: TriggerBody }>('/api/v1/scraper/trigger', async (request, reply) => {
    const { siteName, url } = request.body;

    if (!siteName) {
      return reply.status(400).send({ ok: false, error: 'Missing required field: siteName' });
    }

    const config = scraperConfig.getSiteConfig(siteName);
    if (!config || !config.enabled) {
      return reply.status(404).send({ ok: false, error: `Site config not found or disabled: ${siteName}` });
    }

    const adapter = scraperConfig.getAdapter(config.adapterName);
    if (!adapter) {
      return reply.status(500).send({ ok: false, error: `Adapter not registered: ${config.adapterName}` });
    }

    const targetUrl = url || config.url;
    if (!targetUrl) {
      return reply.status(400).send({ ok: false, error: 'No URL provided and no default URL in config' });
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
        return reply.status(400).send({ ok: false, error: 'Invalid URL format' });
      }
      if (parsed.username || parsed.password) {
        return reply.status(400).send({ ok: false, error: 'URL credentials not allowed' });
      }
      if (parsed.hostname !== configParsed.hostname) {
        return reply
          .status(400)
          .send({ ok: false, error: `URL hostname not allowed for site ${siteName}: ${parsed.hostname}` });
      }
      if (parsed.protocol !== configParsed.protocol) {
        return reply
          .status(400)
          .send({ ok: false, error: `URL protocol not allowed for site ${siteName}: ${parsed.protocol}` });
      }
    }

    const llmEndpoint = process.env.LLM_ENDPOINT;
    const llmApiKey = process.env.LLM_API_KEY;

    if (!llmEndpoint || !llmApiKey) {
      return reply.status(500).send({ ok: false, error: 'LLM_ENDPOINT and LLM_API_KEY must be set in .env' });
    }

    try {
      // Step 1: Fetch raw content via adapter
      request.log.info(`Fetching content from ${targetUrl} via adapter ${adapter.name}`);
      const rawContent = await adapter.fetchContent(targetUrl);

      // Step 2: Extract facts via LLM
      request.log.info('Extracting facts via LLM');
      const { facts, confidence, coverImageUrl } = await extractFacts(rawContent, {
        endpoint: llmEndpoint,
        apiKey: llmApiKey,
        model: process.env.LLM_MODEL || 'gpt-4o-mini',
      });

      // Step 3: Save as pending topic
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
        status: 'pending',
        createdAt: now,
        updatedAt: now,
      };

      await savePendingTopic(pendingTopic);

      return { ok: true, pendingTopic };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      request.log.error(err, `Scrape failed for ${siteName}`);
      return reply.status(500).send({ ok: false, error: `Scrape failed: ${msg}` });
    }
  });

  // 列出已注册的适配器
  app.get('/api/v1/scraper/adapters', async () => {
    const adapters = scraperConfig.listAdapters().map((a) => ({
      name: a.name,
    }));
    return { ok: true, adapters };
  });

  // 列出已配置的站点
  app.get('/api/v1/scraper/sites', async () => {
    const sites = scraperConfig.listSiteConfigs();
    return { ok: true, sites };
  });
}
