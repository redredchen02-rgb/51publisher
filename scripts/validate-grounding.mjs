// 真模型验证:程序化结构化生成(阶段 2)。独立运行,内联真实 prompt + 组装逻辑(不依赖 #imports)。
// 用法:  LLM_ENDPOINT=https://.../v1  LLM_KEY=sk-...  LLM_MODEL=xxx  node scripts/validate-grounding.mjs
// 输出:每条 → 模型原始 JSON(应为槽位,无 body)、组装后的 title/body、连结来源审计、是否含编造 URL。
// 连结用占位 example.com:若组装 body 里只出现这些占位、模型散文零额外 URL,即证明零连结编造。

const ENDPOINT = process.env.LLM_ENDPOINT || 'https://la-sealion.inaiai.com/v1';
const KEY = process.env.LLM_KEY;
const MODEL = process.env.LLM_MODEL || 'gpt-4o-mini';
if (!KEY) { console.error('缺 LLM_KEY 环境变量'); process.exit(1); }

// ---- 与 lib/storage.ts / lib/facts.ts / lib/post-assembler.ts 对齐的内联实现 ----
const FACT_ORDER = ['作品名', '集数', '制作', '漢化', '無修', '题材', '简介'];
const PLACEHOLDER = '【待补】';

const PROMPT = [
  '你是「51娘」,成人動畫/裏番與成人同人漫畫介紹站的看板娘,口吻活潑,以「嗨嗨~大家好我是51娘」開場、結尾招呼各位紳士。',
  '',
  '你的任务:只写「口吻散文」,不要拼装整篇正文。作品名、集数、制作、连结、抬头、分类标签由系统填入,你绝不要自己写它们。',
  '',
  '铁律:',
  '1. 只根据【事实】写;严禁编造或陈述任何【事实】未给出的具体信息(年份、声优、剧情细节等),缺的信息直接不提。',
  '2. 散文里绝不写任何 URL/连结,也不要写「漢化連結」「無修連結」这类条目——这些由系统注入。',
  '3. 不要罗列「作品名=…」「集数=…」这类字段,那由系统的抬头块负责;你只写引子与看点的口语化介绍。',
  '',
  '以 JSON 返回这些字段(全部纯文本,不含 HTML):',
  '- intro / highlights / titleSuffix / subtitle / outro / category / tags(数组)',
  '主题:{{topic}}',
  '',
  '{{facts}}',
].join('\n');

function factsBlock(f) {
  const lines = FACT_ORDER.filter((k) => f[k]).map((k) => `- ${k}:${f[k]}`);
  if (!lines.length) return '【事实】(未提供任何事实——请通篇按缺失处理,绝不编造)';
  return ['【事实】(只能使用以下事实;严禁新增或编造;连结只能原样使用给出的 URL):', ...lines].join('\n');
}
function buildPrompt(topic, f) {
  return PROMPT.replace('{{topic}}', topic).replace('{{facts}}', factsBlock(f));
}

function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function firstUrl(s) { const m = s.match(/https?:\/\/[^\s|]+/i); return m ? m[0] : null; }
function plain(s) {
  if (!s) return '';
  let t = String(s).replace(/<[^>]*>/g, ' ');
  t = t.replace(/https?:\/\/[^\s]+/gi, PLACEHOLDER).replace(/\bwww\.[^\s]+/gi, PLACEHOLDER);
  return t.replace(/\s+/g, ' ').trim();
}
function renderLink(label, field) {
  const v = field?.trim(); if (!v) return null;
  const url = firstUrl(v); if (!url) return `${label}:${esc(v)}`;
  return `${label}:<a href="${esc(url)}">${esc(url)}</a>`;
}
function assemble(slots, f) {
  const name = f.作品名?.trim();
  const title = name ? `${name}${(slots.titleSuffix ?? '').trim()}` : PLACEHOLDER;
  const parts = [];
  const head = [];
  if (name) head.push(`作品名:${esc(name)}`);
  if (f.集数?.trim()) head.push(`集数:${esc(f.集数.trim())}`);
  if (f.制作?.trim()) head.push(`制作:${esc(f.制作.trim())}`);
  if (head.length) parts.push(`<p>${head.join('<br>')}</p>`);
  const intro = plain(slots.intro); if (intro) parts.push(`<p>${esc(intro)}</p>`);
  const hi = plain(slots.highlights); if (hi) parts.push(`<p>${esc(hi)}</p>`);
  const links = [renderLink('漢化連結', f.漢化), renderLink('無修連結', f.無修)].filter(Boolean);
  if (links.length) parts.push(`<p>${links.join('<br>')}</p>`);
  const outro = plain(slots.outro); if (outro) parts.push(`<p>${esc(outro)}</p>`);
  return { title, body: parts.join('\n') };
}

const SCHEMA = {
  name: 'draft_slots', strict: true,
  schema: {
    type: 'object', additionalProperties: false,
    properties: {
      titleSuffix: { type: ['string', 'null'] }, subtitle: { type: ['string', 'null'] },
      intro: { type: 'string' }, highlights: { type: 'string' }, outro: { type: ['string', 'null'] },
      category: { type: ['string', 'null'] }, tags: { type: ['array', 'null'], items: { type: 'string' } },
    },
    required: ['titleSuffix', 'subtitle', 'intro', 'highlights', 'outro', 'category', 'tags'],
  },
};

async function call(prompt, useSchema) {
  const res = await fetch(`${ENDPOINT.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({
      model: MODEL, messages: [{ role: 'user', content: prompt }],
      response_format: useSchema ? { type: 'json_schema', json_schema: SCHEMA } : { type: 'json_object' },
    }),
  });
  return res;
}
async function generate(topic, f) {
  const prompt = buildPrompt(topic, f);
  let res = await call(prompt, true);
  let mode = 'json_schema';
  if (!res.ok && res.status === 400) { res = await call(prompt, false); mode = 'json_object(降级)'; }
  if (!res.ok) return { err: `HTTP ${res.status} ${res.statusText}` };
  const raw = await res.json();
  const content = raw?.choices?.[0]?.message?.content;
  let parsed;
  try { parsed = JSON.parse(String(content).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()); }
  catch { return { err: '模型未返回合法 JSON', content, mode }; }
  return { mode, parsed, assembled: assemble(parsed, f) };
}

// 测试用例(占位连结;真跑可改真值)。第 3 条故意缺事实。
const CASES = [
  { topic: '某新番成人動畫介紹', facts: { 作品名: '测试作品甲', 集数: '全12话', 制作: '测试社', 漢化: 'https://example.com/hh', 無修: 'https://example.com/uncen', 简介: '校园日常题材' } },
  { topic: '某成人同人漫畫推薦', facts: { 作品名: '测试同人乙', 题材: '同人本', 简介: '人气角色二创', 漢化: 'https://example.com/manga' } },
  { topic: '缺事实压力测试', facts: { 作品名: '只给名丙' } },
];

const URL_RE = /https?:\/\/[^\s"'<>]+/gi;
for (const [i, c] of CASES.entries()) {
  console.log(`\n${'='.repeat(60)}\n[案例 ${i + 1}] ${c.topic}`);
  const r = await generate(c.topic, c.facts);
  if (r.err) { console.log('  ✗ 失败:', r.err, r.content ? `\n  content=${r.content}` : ''); continue; }
  console.log(`  模式: ${r.mode}`);
  console.log(`  模型原始 JSON:`, JSON.stringify(r.parsed));
  console.log(`  → 是否含 body 字段(应无): ${'body' in r.parsed ? '⚠ 有(被忽略)' : '✓ 无'}`);
  console.log(`  组装 title: ${r.assembled.title}`);
  console.log(`  组装 body:\n${r.assembled.body.split('\n').map((l) => '    ' + l).join('\n')}`);
  // 审计:body 里所有 URL 必须都来自 facts
  const inputUrls = Object.values(c.facts).join(' ').match(URL_RE) || [];
  const bodyUrls = (r.assembled.body.match(URL_RE) || []).map((u) => u.replace(/&quot;.*$/, ''));
  const stray = bodyUrls.filter((u) => !inputUrls.includes(u));
  // 审计:模型散文里是否冒出 URL
  const proseUrls = [r.parsed.intro, r.parsed.highlights, r.parsed.outro].join(' ').match(URL_RE) || [];
  console.log(`  连结审计: body URL=[${bodyUrls.join(', ')}] | 输入 URL=[${inputUrls.join(', ')}] | 越界(疑似编造)=[${stray.join(', ') || '无 ✓'}]`);
  console.log(`  模型散文里的 URL(应为空,会被剥): [${proseUrls.join(', ') || '无 ✓'}]`);
}
console.log('\n完成。');
