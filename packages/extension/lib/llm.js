const PROMPT_TEMPLATE = `你是一位成人 ACG 漫画推荐编辑。基于以下漫画数据，生成一篇推荐文章。

漫画数据：
- 标题: {title}
- 作者: {author}
- 标签: {tags}
- 分类: {categories}
- 状态: {status}
- 收藏数: {bookmark_count}
- 观看数: {view_count}

请生成 JSON 格式（不要包含 markdown 代码块标记）：
{
  "title": "吸引眼球的文章标题（含 emoji，15字以内）",
  "summary": "150-200字的文章摘要，包含推荐理由和亮点",
  "body": "完整的推荐文章正文，分3-5个段落，包含漫画介绍、亮点分析、推荐理由，语气轻松有趣"
}`;

const GENERATE_CACHE = {};
const CACHE_MAX = 200;

function cachePut(key, value) {
  const keys = Object.keys(GENERATE_CACHE);
  if (keys.length >= CACHE_MAX) {
    delete GENERATE_CACHE[keys[0]];
  }
  GENERATE_CACHE[key] = value;
}

async function getSettings() {
  return new Promise(resolve => {
    chrome.storage.local.get(['apiUrl', 'apiKey', 'model'], resolve);
  });
}

async function testConnection() {
  const s = await getSettings();
  if (!s.apiKey || !s.apiUrl) throw new Error('请先配置 API 设置');
  const resp = await fetch(s.apiUrl, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${s.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: s.model || 'gpt-4o-mini', messages: [{ role: 'user', content: '说 OK' }], max_tokens: 10 })
  });
  if (!resp.ok) { const e = await resp.text(); throw new Error(`API 错误 ${resp.status}: ${e.slice(0, 100)}`); }
  return true;
}

function fillTemplate(comic) {
  return PROMPT_TEMPLATE
    .replace('{title}', comic.title || '')
    .replace('{author}', comic.author || '未知')
    .replace('{tags}', comic.tags || '')
    .replace('{categories}', comic.categories || '')
    .replace('{status}', comic.status || '')
    .replace('{bookmark_count}', comic.bookmark_count || 0)
    .replace('{view_count}', comic.view_count || 0);
}

async function generateArticle(comic) {
  if (GENERATE_CACHE[comic.source_id]) {
    return GENERATE_CACHE[comic.source_id];
  }

  const s = await getSettings();
  if (!s.apiKey || !s.apiUrl) throw new Error('请先配置 API 设置');

  const prompt = fillTemplate(comic);
  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const resp = await fetch(s.apiUrl, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${s.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: s.model || 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.7,
          max_tokens: 1500,
        })
      });
      if (!resp.ok) { const e = await resp.text(); throw new Error(`API 错误 ${resp.status}: ${e.slice(0, 100)}`); }
      const data = await resp.json();
      if (!data.choices || !data.choices[0] || !data.choices[0].message) {
        throw new Error('API 返回格式异常');
      }
      let content = data.choices[0].message.content;
      content = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const result = JSON.parse(content);
      cachePut(comic.source_id, result);
      return result;
    } catch (e) {
      lastError = e;
      if (attempt === 0) await new Promise(r => setTimeout(r, 1000));
    }
  }
  throw lastError;
}

const LLM = { getSettings, testConnection, generateArticle };

if (typeof window !== 'undefined') {
  window.LLM = LLM;
} else if (typeof self !== 'undefined') {
  self.LLM = LLM;
}
