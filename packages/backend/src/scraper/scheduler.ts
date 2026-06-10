import cron from 'node-cron';
import type { FastifyBaseLogger } from 'fastify';
import { scraperConfig } from './scraper-config.js';
import { extractFacts } from './fact-extractor.js';
import { savePendingTopic, type PendingTopic } from './pending-store.js';

interface SchedulerDeps {
  logger?: FastifyBaseLogger;
  llmEndpoint: string;
  llmApiKey: string;
  llmModel?: string;
}

const jobs = new Map<string, cron.ScheduledTask>();

const BASE_DELAY_MS = 1_000;
const MAX_ATTEMPTS = 3;

/** 指数退避延迟，带随机抖动。 */
async function sleep(attempt: number): Promise<void> {
  const delay = BASE_DELAY_MS * 2 ** (attempt - 1) + Math.random() * BASE_DELAY_MS;
  await new Promise((resolve) => setTimeout(resolve, delay));
}

export function startScheduler(deps: SchedulerDeps): void {
  const sites = scraperConfig.listSiteConfigs().filter((s) => s.enabled && s.cron);

  for (const site of sites) {
    if (jobs.has(site.siteName)) {
      deps.logger?.warn(`Scheduler already running for ${site.siteName}`);
      continue;
    }

    if (!cron.validate(site.cron!)) {
      deps.logger?.error(`Invalid cron expression for ${site.siteName}: ${site.cron}`);
      continue;
    }

    const job = cron.schedule(site.cron!, async () => {
      const runStart = Date.now();
      const adapter = scraperConfig.getAdapter(site.adapterName);
      if (!adapter) {
        deps.logger?.error(`Adapter ${site.adapterName} not found for ${site.siteName}`);
        return;
      }

      deps.logger?.info(`[scheduler] Triggering ${site.siteName}: ${site.url}`);

      // Fetch with exponential backoff retry (fetch only; extract+save are not retried)
      let rawContent: Awaited<ReturnType<typeof adapter.fetchContent>> | null = null;
      let fetchError: Error | null = null;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          rawContent = await adapter.fetchContent(site.url);
          fetchError = null;
          break;
        } catch (err) {
          fetchError = err instanceof Error ? err : new Error(String(err));
          deps.logger?.warn(
            `[scheduler] Fetch attempt ${attempt}/${MAX_ATTEMPTS} failed for ${site.siteName}: ${fetchError.message}`,
          );
          if (attempt < MAX_ATTEMPTS) await sleep(attempt);
        }
      }

      if (!rawContent) {
        deps.logger?.error(
          { siteName: site.siteName, error: fetchError?.message, attempts: MAX_ATTEMPTS },
          `[scheduler] All fetch attempts failed for ${site.siteName}`,
        );
        // R16 structured run log
        deps.logger?.info({
          event: 'scraper_run',
          siteName: site.siteName,
          success: 0,
          failed: 1,
          durationMs: Date.now() - runStart,
        });
        return;
      }

      try {
        const { facts, confidence, extractionMode, coverImageUrl } = await extractFacts(rawContent, {
          endpoint: deps.llmEndpoint,
          apiKey: deps.llmApiKey,
          model: deps.llmModel || 'gpt-4o-mini',
        });

        const now = new Date().toISOString();
        const topic: PendingTopic = {
          id: `scheduled_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          sourceUrl: site.url,
          siteName: site.siteName,
          title: rawContent.title,
          rawContent,
          facts,
          confidence,
          ...(coverImageUrl ? { coverImageUrl } : {}),
          status: 'pending',
          createdAt: now,
          updatedAt: now,
        };

        await savePendingTopic(topic);

        // R16 structured run log
        deps.logger?.info({
          event: 'scraper_run',
          siteName: site.siteName,
          success: 1,
          failed: 0,
          durationMs: Date.now() - runStart,
          confidence,
          extractionMode,
        });
        deps.logger?.info(`[scheduler] Saved pending topic from ${site.siteName}: ${rawContent.title}`);
      } catch (err) {
        deps.logger?.error(err, `[scheduler] Extract/save failed for ${site.siteName}`);
        deps.logger?.info({
          event: 'scraper_run',
          siteName: site.siteName,
          success: 0,
          failed: 1,
          durationMs: Date.now() - runStart,
        });
      }
    });

    jobs.set(site.siteName, job);
    deps.logger?.info(`[scheduler] Started cron for ${site.siteName}: ${site.cron}`);
  }
}

export function stopScheduler(): void {
  for (const [name, job] of jobs) {
    job.stop();
    jobs.delete(name);
  }
}

export function isSchedulerRunning(name: string): boolean {
  return jobs.has(name);
}
