import Fastify from 'fastify';
import cors from '@fastify/cors';
import dotenv from 'dotenv';
import { generateDraft, listModels } from './llm.js';
import type { Settings } from './shared/types.js';
import type { FactsBlock } from './shared/facts.js';
import { registerConfigRoutes } from './config-routes.js';
import { registerBatchRoutes } from './batch-routes.js';
import { registerScraperRoutes } from './scraper/scraper-routes.js';
import { registerPendingRoutes } from './scraper/pending-routes.js';
import { registerPromptRoutes } from './scraper/prompt-routes.js';
import { registerAuthRoutes } from './auth-routes.js';
import { PUBLIC_ROUTES, requireAuth } from './auth-middleware.js';
import { scraperConfig } from './scraper/scraper-config.js';
import { demoAdapter } from './scraper/adapters/demo-adapter.js';
import { acgs51Adapter } from './scraper/adapters/acgs51-adapter.js';
import { startScheduler } from './scraper/scheduler.js';
import { initPendingDb } from './scraper/pending-db.js';

dotenv.config();

// 初始化 SQLite 待审池（必须在路由注册前完成）
initPendingDb();

const server = Fastify({ logger: true });

// Enable CORS for Chrome Extension origins
await server.register(cors, {
  origin: '*', // In production, restrict this to chrome-extension://<id> if known, or keep wildcard for extension clients
});

await registerAuthRoutes(server);

server.addHook('preHandler', async (request, reply) => {
  const url = request.url.split('?')[0];
  if (PUBLIC_ROUTES.has(url)) return;
  return requireAuth(request, reply);
});

// 注册动态配置路由(选择器映射热下发)
await registerConfigRoutes(server);
// 注册 Batch 状态管理路由(编排状态持久化)
await registerBatchRoutes(server);
// 注册 Scraper 路由(内容抓取)
await registerScraperRoutes(server);
// 注册 Pending Topics 路由(待审核选题池)
await registerPendingRoutes(server);
await registerPromptRoutes(server);

// 初始化 Scraper:注册适配器与站点配置
scraperConfig.registerAdapter(demoAdapter);
scraperConfig.addSiteConfig({
  siteName: 'demo',
  adapterName: 'demo',
  url: 'https://example.com',
  enabled: false, // 演示站点默认禁用
});

scraperConfig.registerAdapter(acgs51Adapter);
scraperConfig.addSiteConfig({
  siteName: 'acgs51',
  adapterName: 'acgs51',
  // 将此 URL 替换为具体待抓取的作品详情页 URL。
  url: process.env.ACGS51_START_URL || 'https://51acgs.com',
  cron: process.env.ACGS51_CRON || '0 */6 * * *', // 默认每 6 小时
  enabled: process.env.ACGS51_ENABLED === 'true',
});

interface GenerateDraftBody {
  prompt: string;
  settings: Settings;
  facts?: FactsBlock;
}

server.get('/api/v1/models', async (request, reply) => {
  const apiKey = process.env.LLM_API_KEY || '';
  const endpoint = process.env.LLM_ENDPOINT || '';

  if (!apiKey || !endpoint) {
    return reply.status(500).send({
      ok: false,
      error: 'Backend is not fully configured (missing LLM_API_KEY or LLM_ENDPOINT in env).',
    });
  }

  try {
    const result = await listModels(endpoint, apiKey);
    return result;
  } catch (err) {
    request.log.error(err, 'Failed to fetch models list');
    return reply.status(500).send({
      ok: false,
      error: 'Failed to fetch models from the LLM service.',
    });
  }
});

server.post<{ Body: GenerateDraftBody }>('/api/v1/drafts/generate', async (request, reply) => {
  const { prompt, settings, facts } = request.body;

  // Use API key from server environment (never expose or store on client)
  const apiKey = process.env.LLM_API_KEY || '';
  if (!apiKey) {
    return reply.status(500).send({
      ok: false,
      kind: 'no-key',
      error: 'Backend is not configured with an LLM_API_KEY. Please check .env file.',
    });
  }

  // Override or fallback settings endpoint/model if configured on backend
  const backendEndpoint = process.env.LLM_ENDPOINT || settings.endpoint;
  const backendModel = process.env.LLM_MODEL || settings.model;

  const resolvedSettings = {
    ...settings,
    endpoint: backendEndpoint,
    model: backendModel,
  };

  try {
    const result = await generateDraft(prompt, {
      settings: resolvedSettings,
      apiKey,
      facts,
    });
    return result;
  } catch (err) {
    request.log.error(err, 'Failed to generate draft via LLM');
    return reply.status(500).send({
      ok: false,
      kind: 'network',
      error: 'Internal server error during draft generation.',
    });
  }
});

const start = async () => {
  try {
    const port = Number(process.env.PORT) || 3001;
    const host = process.env.HOST || '127.0.0.1';
    await server.listen({ port, host });
    console.log(`Server listening on http://${host}:${port}`);

    // 启动定时抓取调度器（需要 LLM 配置）
    const llmEndpoint = process.env.LLM_ENDPOINT;
    const llmApiKey = process.env.LLM_API_KEY;
    if (llmEndpoint && llmApiKey) {
      startScheduler({
        logger: server.log,
        llmEndpoint,
        llmApiKey,
        llmModel: process.env.LLM_MODEL,
      });
      console.log('[scheduler] Cron scheduler started');
    } else {
      console.log('[scheduler] Skipped (LLM_ENDPOINT/LLM_API_KEY not set)');
    }
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

start();
