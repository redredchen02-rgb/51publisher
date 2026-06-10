import { describe, it, expect } from 'vitest';

const API_KEY = process.env.API_KEY || process.env.LLM_KEY;
const BASE_URL = (process.env.BASE_URL || process.env.LLM_ENDPOINT || 'https://la-sealion.inaiai.com/v1').replace(
  /\/+$/,
  '',
);
const MODEL = process.env.MODEL || process.env.LLM_MODEL || 'gpt-4o-mini';

const FEWSHOT = [
  '范例(仅参考口吻与结构,事实用占位):',
  '標題:◯◯◯成人動畫介紹',
  '副標題:一句俏皮吸睛的话~',
  '正文:嗨嗨~大家好我是51娘ヾ(≧▽≦*)o 今天為各位紳士介紹《◯◯◯》,原作是【待补】,動畫共【待补】,聚焦【待补】。漢化連結:【待补】 無修正:【待补】。各位紳士準備好衛生紙和飛機杯,讓我們開始吧!(*/ω＼*)',
  '',
].join('\n');

const TEMPLATE = [
  '{{fewshot}}你是「51娘」,成人動畫/裏番與成人同人漫畫介紹站的看板娘,口吻活潑,以「嗨嗨~大家好我是51娘」開場、結尾招呼各位紳士。根據主題與【事实】生成一篇帖子草稿。',
  '',
  '铁律:',
  '1. 只能使用【事实】里给出的内容;严禁新增或编造任何作品名、集数、原作/制作、连结。',
  '2. 任何【事实】未提供的具体信息,在文中原样写「【待补】」,绝不猜测或编造。',
  '3. 正文里的连结只能原样使用【事实】给出的 URL,绝不自造或改写 URL。',
  '',
  '以 JSON 返回,字段:title, subtitle, category, body(HTML), tags(数组), description。',
  '主题:{{topic}}',
  '',
  '{{facts}}',
].join('\n');

const topic = '住在拔作島上的我該如何是好成人動畫介紹';
const facts = {
  作品名: '住在拔作島上的我該如何是好',
  集数: '2期',
  简介: '能在電視台放送的色情動畫,畫面全黑只剩聲音',
};
const factsText = [
  '【事实】(只能使用以下事实;严禁新增或编造作品名/集数/原作/连结;缺的在文中写「【待补】」;连结只能原样使用下方给出的 URL):',
  ...Object.entries(facts).map(([k, v]) => `- ${k}:${v}`),
].join('\n');

const prompt = TEMPLATE.replaceAll('{{fewshot}}', FEWSHOT)
  .replaceAll('{{topic}}', topic)
  .replaceAll('{{facts}}', factsText)
  .trim();

const allowedUrls = Object.values(facts).flatMap((v) => v.match(/https?:\/\/\S+/g) || []);

const norm = (u: string) => {
  try {
    const x = new URL(u);
    return x.host.toLowerCase().replace(/^www\./, '') + x.pathname.replace(/\/+$/, '') + x.search;
  } catch {
    return u.toLowerCase().replace(/\/+$/, '');
  }
};

describe.skipIf(!API_KEY)('probe-grounding', () => {
  it('should not fabricate links when none are provided', async () => {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
      }),
    });

    expect(res.ok).toBe(true);

    const raw: any = await res.json();
    const content = raw?.choices?.[0]?.message?.content;
    expect(typeof content).toBe('string');

    let draft: any;
    try {
      draft = JSON.parse(
        content
          .replace(/^```(?:json)?\s*/i, '')
          .replace(/\s*```$/i, '')
          .trim(),
      );
    } catch {
      expect.fail('Invalid JSON from model');
    }

    const body = String(draft.body || '');
    const bodyLinks = [...body.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1] ?? '');
    const allowed = new Set(allowedUrls.map(norm));
    const unsourced = [...new Set(bodyLinks)].filter((u) => !allowed.has(norm(u)));

    expect(unsourced.length).toBe(0);
  });
});
