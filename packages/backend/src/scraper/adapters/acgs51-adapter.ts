// 51acgs.com 内容详情页适配器。
// 每次 cron 触发抓取配置中指定的单条详情页 URL。
// 选择器基于 51acgs.com 常见页面结构——运营者可在 scraper-config 中调整目标 URL。
import type { SiteAdapter, RawContent } from '../site-adapter.js';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

/** 从 <title> 提取标题，去掉 " - 站名" 后缀。 */
function extractTitle(html: string): string {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!m) return '';
  return m[1]
    .replace(/\s*[-|–]\s*.*?(?:acg|51|acgs).*$/i, '')
    .replace(/&amp;/g, '&')
    .trim();
}

/** 提取 <h1> 文本(作为备用标题来源)。 */
function extractH1(html: string): string {
  const m = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (!m) return '';
  return m[1].replace(/<[^>]*>/g, '').trim();
}

/** 提取 meta description。 */
function extractMetaDescription(html: string): string {
  const m =
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i) ??
    html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i);
  return m ? m[1].trim() : '';
}

/** 提取 og:image URL。 */
function extractOgImage(html: string): string {
  const m =
    html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']*)["']/i) ??
    html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+property=["']og:image["']/i);
  return m ? m[1].trim() : '';
}

/** 按顺序尝试多个 CSS 选择器模式(regex 近似),返回第一个命中的内部文本。 */
function extractByPatterns(html: string, patterns: RegExp[]): string {
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) {
      return m[1]
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }
  }
  return '';
}

/** 从页面 HTML 提取结构化元数据字段(制作/漢化/集数等)。 */
function extractMetadata(html: string): Record<string, string> {
  const meta: Record<string, string> = {};

  // 常见模式: <li><span class="label">制作组:</span> VALUE</li>
  // 或 <td class="key">制作组</td><td>VALUE</td>
  const labelPatterns: Array<[string, RegExp]> = [
    ['制作', /<(?:li|td|span|div)[^>]*>[^<]*制作[组社]?[^<]*<\/(?:span|td|div)>[\s\S]{0,50}?>([\w\s\-()（）]+)/i],
    ['漢化', /<(?:li|td|span|div)[^>]*>[^<]*[汉漢]化[^<]*<\/(?:span|td|div)>[\s\S]{0,50}?>([\w\s\-()（）]+)/i],
    ['集数', /<(?:li|td|span|div)[^>]*>[^<]*集数[^<]*<\/(?:span|td|div)>[\s\S]{0,50}?>(\d+[^<]*)/i],
    ['无修', /<(?:li|td|span|div)[^>]*>[^<]*[无無]修[^<]*<\/(?:span|td|div)>[\s\S]{0,50}?>([^<]{1,20})/i],
  ];

  for (const [key, re] of labelPatterns) {
    const m = html.match(re);
    if (m?.[1]) meta[key] = m[1].replace(/<[^>]*>/g, '').trim();
  }

  return meta;
}

/** 提取主要内容正文。 */
function extractBody(html: string): string {
  // 尝试常见的内容容器选择器(按精确度降序)
  const body = extractByPatterns(html, [
    /<(?:div|article|section)[^>]+(?:class|id)=["'][^"']*(?:post-content|article-content|entry-content|content-detail|main-content)[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|article|section)>/i,
    /<(?:div|article)[^>]+(?:class|id)=["'][^"']*(?:content|article|post)[^"']*["'][^>]*>([\s\S]{100,}?)<\/(?:div|article)>/i,
  ]);
  if (body && body.length >= 50) return body;

  // 回退到 meta description
  return extractMetaDescription(html);
}

export const acgs51Adapter: SiteAdapter = {
  name: 'acgs51',

  async fetchContent(url: string): Promise<RawContent> {
    const res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'zh-TW,zh;q=0.9,ja;q=0.8',
      },
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: Failed to fetch ${url}`);
    }

    const html = await res.text();
    const title = extractH1(html) || extractTitle(html);

    if (!title) {
      throw new Error(`Could not extract title from ${url}`);
    }

    const body = extractBody(html);
    const ogImage = extractOgImage(html);
    const structuredMeta = extractMetadata(html);

    const metadata: Record<string, string> = { ...structuredMeta };
    if (ogImage) metadata.cover_url = ogImage;

    return { title, body, url, metadata };
  },
};
