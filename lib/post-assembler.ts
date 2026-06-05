// 正文组装器(程序化结构化生成,防幻觉核心)。
// 模型只产「叙事槽位」(纯文本口吻);事实骨架(作品名/集数/制作/连结)由程式从 FactsBlock
// **原样注入**,模型物理上打不出这些值;缺的程式插「【待补】」。
//
// 不变量(由测试守护):
//   1. body 里出现的任何 <a href> 必定来自 facts 的 URL —— verifyLinks(body, factUrls(facts)) 恒无 unsourced。
//   2. 模型散文先剥成纯文本(去标签、去裸 URL)再 HTML 转义 —— 散文里零连结、零 HTML 注入。
//   3. 缺失的事实位一律【待补】,绝不由模型补。
//
// 纯函数、无副作用、不碰 chrome/DOM(正则实现,SW/jsdom/node 皆可跑)。参照 lib/facts.ts 风格。

import type { FactsBlock } from './facts';

export const PLACEHOLDER = '【待补】';

/** 模型只产出的叙事槽位:纯文本口吻,**不含** body/HTML/URL/具体事实值。 */
export interface DraftSlots {
  /** 标题套话后缀,如「成人動畫介紹」;作品名由程式前置。 */
  titleSuffix?: string;
  /** 副标题(一句俏皮吸睛话)。 */
  subtitle?: string;
  /** 引子散文(51娘 口吻开场)。 */
  intro: string;
  /** 看点散文。 */
  highlights: string;
  /** 结尾招呼(可选)。 */
  outro?: string;
}

/** 组装产物:供 toDraft 填入 ContentDraft 的纯文本/HTML 字段。 */
export interface AssembledDraft {
  /** 纯文本(填入 text input,不转义)。 */
  title: string;
  /** 纯文本。 */
  subtitle: string;
  /** 正文 HTML(事实 verbatim 注入 + 散文转义)。 */
  body: string;
  /** 纯文本摘要(填入 textarea,不转义)。 */
  description: string;
}

/** facts.漢化/無修 等字段里抽第一个 URL(与 lib/facts.factUrls 同规则,保证比对一致)。 */
function firstUrl(s: string): string | null {
  const m = s.match(/https?:\/\/[^\s|]+/i);
  return m ? m[0] : null;
}

/**
 * 把模型散文剥成安全纯文本:
 *  - 去 HTML 标签(防注入);
 *  - 裸 URL → 【待补】(模型试图自造连结的信号,真连结只走程式注入);
 *  - 折叠空白。
 */
export function sanitizeToPlainText(s: string | undefined): string {
  if (!s) return '';
  let t = s.replace(/<[^>]*>/g, ' ');
  t = t.replace(/https?:\/\/[^\s]+/gi, PLACEHOLDER).replace(/\bwww\.[^\s]+/gi, PLACEHOLDER);
  return t.replace(/\s+/g, ' ').trim();
}

/** HTML 文本转义(仅用于写进 body 的文本片段)。 */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 渲染一条连结块的值:有 URL → verbatim <a>;有文本无 URL → 原样转义(不成链);空 → 【待补】。 */
function renderLink(field: string | undefined): string {
  const v = field?.trim();
  if (!v) return PLACEHOLDER;
  const url = firstUrl(v);
  if (!url) return esc(v);
  const safe = esc(url);
  return `<a href="${safe}">${safe}</a>`;
}

/** 一个事实文本位:有值 → verbatim 转义;空 → 【待补】。 */
function fact(v: string | undefined): string {
  const t = v?.trim();
  return t ? esc(t) : PLACEHOLDER;
}

/**
 * 组装草稿:模型槽位 + facts → title/subtitle/body/description。
 * body 结构(固定骨架):
 *   抬头块(作品名/集数/制作,facts verbatim)
 *   引子散文(模型,消毒+转义)
 *   看点散文(模型,消毒+转义)
 *   连结块(漢化/無修,facts URL verbatim)
 *   结尾(模型,可选)
 */
export function assembleDraft(slots: DraftSlots, facts: FactsBlock): AssembledDraft {
  const name = facts.作品名?.trim();
  const title = name ? `${name}${(slots.titleSuffix ?? '').trim()}` : PLACEHOLDER;
  const subtitle = sanitizeToPlainText(slots.subtitle);
  const description = facts.简介?.trim() || sanitizeToPlainText(slots.subtitle || slots.intro).slice(0, 120);

  const parts: string[] = [];

  // 抬头块(事实 verbatim)
  parts.push(
    `<p>作品名:${fact(facts.作品名)}<br>集数:${fact(facts.集数)}<br>制作:${fact(facts.制作)}</p>`,
  );

  // 散文(模型,消毒+转义)
  const intro = sanitizeToPlainText(slots.intro);
  if (intro) parts.push(`<p>${esc(intro)}</p>`);
  const highlights = sanitizeToPlainText(slots.highlights);
  if (highlights) parts.push(`<p>${esc(highlights)}</p>`);

  // 连结块(facts URL verbatim;模型碰不到)
  parts.push(`<p>漢化連結:${renderLink(facts.漢化)}<br>無修連結:${renderLink(facts.無修)}</p>`);

  // 结尾(可选)
  const outro = sanitizeToPlainText(slots.outro);
  if (outro) parts.push(`<p>${esc(outro)}</p>`);

  return { title, subtitle, body: parts.join('\n'), description };
}
