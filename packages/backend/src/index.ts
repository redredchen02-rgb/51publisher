import type { FactsBlock, Settings } from '@51publisher/shared';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import dotenv from 'dotenv';
import Fastify from 'fastify';
import { PUBLIC_ROUTES, requireAuth } from './auth-middleware.js';
import { registerAuthRoutes } from './auth-routes.js';
import { registerBatchRoutes } from './batch-routes.js';
import { registerConfigRoutes } from './config-routes.js';
import { validateEnv } from './env-check.js';
import { err } from './error-response.js';
import { generateDraft, listModels, reviewDraftLlm, rewriteDraftLlm } from './llm.js';
import { registerPublishedPostsRoutes } from './published-posts-routes.js';
import { startRevisitJob } from './revisit-job.js';
import { GenerateDraftBody as GenerateDraftBodySchema, GenerateDraftResponse } from './schemas.js';
import { acgs51Adapter } from './scraper/adapters/acgs51-adapter.js';
import { demoAdapter } from './scraper/adapters/demo-adapter.js';
import { initPendingDb } from './scraper/pending-db.js';
import { registerPendingRoutes } from './scraper/pending-routes.js';
import { registerPromptRoutes } from './scraper/prompt-routes.js';
import { startScheduler } from './scraper/scheduler.js';
import { scraperConfig } from './scraper/scraper-config.js';
import { registerScraperRoutes } from './scraper/scraper-routes.js';

dotenv.config();

// 初始化 pending/config 的 SQLite 持久层（batch/prompt 使用 JSON 文件存储）
initPendingDb();

const server = Fastify({ logger: true });

// Fail-closed CORS: env-check in start() refuses '*' or unset CORS_ORIGIN.
// At module init, parse what we have; '*' and empty are filtered out so
// the origin list is either valid entries or [] (deny-all — safe default).
const corsOrigins = (process.env.CORS_ORIGIN ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter((s) => s && s !== '*');
await server.register(cors, { origin: corsOrigins });

// Apply rate limiting: 100 requests per minute per IP
await server.register(rateLimit, {
  max: 100,
  timeWindow: '1 minute',
});

server.get('/api/v1/healthz', async () => ({ ok: true }));

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
await registerPublishedPostsRoutes(server);

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
  // 必须是具体待抓取的作品详情页 URL;无默认值,启用时由 env-check 兜底校验。
  url: process.env.ACGS51_START_URL ?? '',
  listUrl: process.env.ACGS51_LIST_URL || undefined,
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
    return err(reply, 500, 'Backend is not fully configured (missing LLM_API_KEY or LLM_ENDPOINT in env).');
  }

  try {
    const result = await listModels(endpoint, apiKey);
    return result;
  } catch (e) {
    request.log.error(e, 'Failed to fetch models list');
    return err(reply, 500, 'Failed to fetch models from the LLM service.');
  }
});

server.post<{ Body: GenerateDraftBody }>(
  '/api/v1/drafts/generate',
  {
    schema: {
      body: GenerateDraftBodySchema,
      response: {
        200: GenerateDraftResponse,
      },
    },
  },
  async (request, reply) => {
    const { prompt, settings, facts } = request.body;

    // Use API key from server environment (never expose or store on client)
    const apiKey = process.env.LLM_API_KEY || '';
    if (!apiKey) {
      return err(reply, 500, 'Backend is not configured with an LLM_API_KEY. Please check .env file.', 'no-key');
    }

    // Pin the LLM endpoint to server config. The client-supplied settings.endpoint
    // is intentionally ignored: honoring it would let any authenticated caller
    // exfiltrate LLM_API_KEY to an arbitrary host.
    const backendEndpoint = process.env.LLM_ENDPOINT || '';
    if (!backendEndpoint) {
      // No 'no-key' kind here: this is a server .env issue the operator can't
      // fix from the extension settings panel, so don't steer them there.
      return err(reply, 500, 'Backend is not configured with an LLM_ENDPOINT. Please check .env file.');
    }
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
      if (!result.ok) {
        return err(reply, 422, result.error, result.kind);
      }
      return result;
    } catch (e) {
      request.log.error(e, 'Failed to generate draft via LLM');
      return err(reply, 500, 'Internal server error during draft generation.', 'network');
    }
  },
);

server.post('/api/v1/drafts/review', async (request, reply) => {
  const { draft, criteriaPrompt, settings } = request.body as {
    draft: import('@51publisher/shared').ContentDraft;
    criteriaPrompt?: string;
    settings: import('@51publisher/shared').Settings;
  };
  const apiKey = process.env.LLM_API_KEY || '';
  const backendEndpoint = process.env.LLM_ENDPOINT || '';
  if (!apiKey || !backendEndpoint) return err(reply, 500, 'Backend not configured (LLM_API_KEY/LLM_ENDPOINT missing).');
  const resolvedSettings = {
    ...settings,
    endpoint: backendEndpoint,
    model: process.env.LLM_MODEL || settings.model,
  };
  const result = await reviewDraftLlm(draft, criteriaPrompt, {
    settings: resolvedSettings,
    apiKey,
  });
  if (!result.ok) return err(reply, 422, result.error);
  return result;
});

server.post('/api/v1/drafts/rewrite', async (request, reply) => {
  const { draft, failedDims, settings } = request.body as {
    draft: import('@51publisher/shared').ContentDraft;
    failedDims: string[];
    settings: import('@51publisher/shared').Settings;
  };
  const apiKey = process.env.LLM_API_KEY || '';
  const backendEndpoint = process.env.LLM_ENDPOINT || '';
  if (!apiKey || !backendEndpoint) return err(reply, 500, 'Backend not configured (LLM_API_KEY/LLM_ENDPOINT missing).');
  if (!Array.isArray(failedDims) || failedDims.length === 0)
    return err(reply, 400, 'failedDims must be a non-empty array.');
  const resolvedSettings = {
    ...settings,
    endpoint: backendEndpoint,
    model: process.env.LLM_MODEL || settings.model,
  };
  const result = await rewriteDraftLlm(draft, failedDims, {
    settings: resolvedSettings,
    apiKey,
  });
  if (!result.ok) return err(reply, 422, result.error);
  return result;
});

const start = async () => {
  try {
    // Fail-closed: refuse to start on weak/placeholder security env.
    validateEnv();

    const port = Number(process.env.PORT) || 3001;
    const host = process.env.HOST || '127.0.0.1';
    await server.listen({ port, host });
    server.log.info(`Server listening on http://${host}:${port}`);

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
      server.log.info('[scheduler] Cron scheduler started');
    } else {
      server.log.info('[scheduler] Skipped (LLM_ENDPOINT/LLM_API_KEY not set)');
    }

    startRevisitJob({ logger: server.log });
    server.log.info('[revisit] Revisit job started');
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

start();
