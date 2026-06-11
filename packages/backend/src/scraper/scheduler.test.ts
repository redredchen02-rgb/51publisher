import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import cron from 'node-cron';
import { startScheduler } from './scheduler.js';
import { scraperConfig } from './scraper-config.js';
import { extractFacts } from './fact-extractor.js';
import { savePendingTopic, type PendingTopic } from './pending-store.js';
import type { SiteAdapter, RawContent } from './site-adapter.js';

// ---- mocks ----

// mock node-cron：捕获 schedule 注册的任务回调，测试中手动 await 触发
vi.mock('node-cron', () => ({
  default: {
    validate: vi.fn(() => true),
    schedule: vi.fn(() => ({ stop: vi.fn() })),
  },
}));

vi.mock('./fact-extractor.js', () => ({
  extractFacts: vi.fn(),
}));

vi.mock('./pending-store.js', () => ({
  savePendingTopic: vi.fn(async () => undefined),
}));

// ---- helpers ----

const MOCK_RAW: RawContent = {
  title: '测试文章',
  body: '正文内容',
  url: 'https://test-site.example.com/article/1',
};

function makeMockAdapter(name: string): SiteAdapter {
  return {
    name,
    fetchContent: vi.fn(async (_url: string): Promise<RawContent> => MOCK_RAW),
  };
}

const DEPS = {
  llmEndpoint: 'https://llm.example.com/v1/chat/completions',
  llmApiKey: 'test-key',
  llmModel: 'test-model',
};

// scraperConfig 与 scheduler 的 jobs Map 均为模块单例：
// 每个用例用自增唯一 siteName 防跨用例污染（旧站点因 jobs.has 被跳过，不重复 schedule）
let testId = 0;
let currentSite: string;
let currentUrl: string;

/** 注册唯一站点并启动 scheduler，返回本用例注册的 cron 任务回调。 */
function startAndGetJob(): () => Promise<void> {
  scraperConfig.registerAdapter(makeMockAdapter(`sched-adapter-${testId}`));
  scraperConfig.addSiteConfig({
    siteName: currentSite,
    adapterName: `sched-adapter-${testId}`,
    url: currentUrl,
    cron: '0 * * * *',
    enabled: true,
  });
  startScheduler(DEPS);
  // beforeEach 已清空 mock 调用记录，旧站点被 jobs.has 跳过，本用例只产生一次 schedule 调用
  const calls = vi.mocked(cron.schedule).mock.calls;
  expect(calls).toHaveLength(1);
  return calls[0][1] as () => Promise<void>;
}

function savedTopic(): PendingTopic {
  const calls = vi.mocked(savePendingTopic).mock.calls;
  expect(calls).toHaveLength(1);
  return calls[0][0];
}

beforeEach(() => {
  vi.clearAllMocks();
  testId++;
  currentSite = `sched-site-${testId}`;
  currentUrl = `https://test-site.example.com/list/${testId}`;
});

afterEach(() => {
  vi.clearAllMocks();
});

// ================================================================
// coverImageUrl 透传（与手动 trigger 路径行为一致）
// ================================================================

describe('startScheduler — cron 任务的 coverImageUrl 透传', () => {
  it('extractFacts 返回 coverImageUrl → savePendingTopic 收到同值 coverImageUrl', async () => {
    vi.mocked(extractFacts).mockResolvedValue({
      facts: { 作品名: '测试作品' },
      confidence: 0.85,
      coverImageUrl: 'https://cdn.example.com/cover.jpg',
      extractionMode: 'strict',
    });

    const job = startAndGetJob();
    await job();

    expect(savedTopic().coverImageUrl).toBe('https://cdn.example.com/cover.jpg');
  });

  it('extractFacts 无 coverImageUrl → topic 不含该字段（条件展开不产生键）', async () => {
    vi.mocked(extractFacts).mockResolvedValue({
      facts: { 作品名: '测试作品' },
      confidence: 0.85,
      coverImageUrl: undefined,
      extractionMode: 'strict',
    });

    const job = startAndGetJob();
    await job();

    expect(savedTopic()).not.toHaveProperty('coverImageUrl');
  });

  it('topic 其余字段正确（sourceUrl、siteName、title、facts、confidence、status）', async () => {
    vi.mocked(extractFacts).mockResolvedValue({
      facts: { 作品名: '测试作品' },
      confidence: 0.85,
      coverImageUrl: undefined,
      extractionMode: 'strict',
    });

    const job = startAndGetJob();
    await job();

    const topic = savedTopic();
    expect(topic).toMatchObject({
      sourceUrl: currentUrl,
      siteName: currentSite,
      title: MOCK_RAW.title,
      facts: { 作品名: '测试作品' },
      confidence: 0.85,
      status: 'pending',
    });
  });

  it('extractFacts reject → 不调用 savePendingTopic，错误被吞不外抛', async () => {
    vi.mocked(extractFacts).mockRejectedValue(new Error('LLM down'));

    const job = startAndGetJob();
    await expect(job()).resolves.toBeUndefined();

    expect(savePendingTopic).not.toHaveBeenCalled();
  });

  it('url 为空的启用站点被跳过，不注册 cron 任务（纵深防御）', () => {
    scraperConfig.registerAdapter(makeMockAdapter(`sched-adapter-${testId}`));
    scraperConfig.addSiteConfig({
      siteName: currentSite,
      adapterName: `sched-adapter-${testId}`,
      url: '',
      cron: '0 * * * *',
      enabled: true,
    });
    startScheduler(DEPS);

    expect(vi.mocked(cron.schedule).mock.calls).toHaveLength(0);
  });
});
