import type { ContentDraft, FieldDefinition, FieldFillResult, FieldMapping } from './types';

// 已填字段的高亮标记(双通道反馈:页面高亮 + side panel 结果面板)。
export const HIGHLIGHT_CLASS = 'pfa-filled';

function highlight(el: HTMLElement): void {
  el.classList.add(HIGHLIGHT_CLASS);
  el.style.outline = '2px solid #52c41a';
  el.style.outlineOffset = '1px';
}

/** 只派发 input/change —— 绝不派发 keydown/Enter(避免触发 <form> 原生提交,P0)。 */
function fireValueEvents(el: Element): void {
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

const ok = (field: string): FieldFillResult => ({ field, status: 'filled' });
const skip = (field: string, note: string): FieldFillResult => ({ field, status: 'skipped', note });
const degrade = (field: string, note: string): FieldFillResult => ({ field, status: 'degraded', note });

function fillTextLike(field: string, def: FieldDefinition, value: string, doc: Document): FieldFillResult {
  const el = doc.querySelector<HTMLInputElement | HTMLTextAreaElement>(def.selector);
  if (!el) return skip(field, `未找到元素:${def.selector}`);
  el.value = value;
  fireValueEvents(el);
  highlight(el);
  return ok(field);
}

function fillNativeSelect(field: string, def: FieldDefinition, value: string, doc: Document): FieldFillResult {
  const sel = doc.querySelector<HTMLSelectElement>(def.selector);
  if (!sel) return skip(field, `未找到下拉:${def.selector}`);
  const options = Array.from(sel.options);
  const matched = options.find((o) => o.value === value) ?? options.find((o) => o.text.trim() === value.trim());
  if (!matched) return degrade(field, `无匹配选项:${value}`);
  sel.value = matched.value;
  fireValueEvents(sel);
  highlight(sel);
  return ok(field);
}

/** 取 checkbox 的关联标签文本(labels / 相邻 label / 父 label)。 */
function labelTextFor(box: HTMLInputElement, doc: Document): string {
  const viaLabels = box.labels && box.labels[0]?.textContent;
  if (viaLabels) return viaLabels.trim();
  if (box.id) {
    const forLabel = doc.querySelector(`label[for="${box.id}"]`);
    if (forLabel?.textContent) return forLabel.textContent.trim();
  }
  const next = box.nextElementSibling;
  if (next && next.tagName === 'LABEL' && next.textContent) return next.textContent.trim();
  const parentLabel = box.closest('label');
  if (parentLabel?.textContent) return parentLabel.textContent.trim();
  return '';
}

function fillCheckboxMulti(field: string, def: FieldDefinition, values: string[], doc: Document): FieldFillResult {
  const boxes = Array.from(doc.querySelectorAll<HTMLInputElement>(def.selector));
  if (boxes.length === 0) return skip(field, `未找到 checkbox 组:${def.selector}`);
  const byLabel = new Map<string, HTMLInputElement>();
  for (const b of boxes) byLabel.set(labelTextFor(b, doc), b);
  const missing: string[] = [];
  let checked = 0;
  // exact → substring (case-insensitive) → skip
  const substringMap = new Map<string, HTMLInputElement>();
  for (const [label, b] of byLabel) substringMap.set(label.toLowerCase(), b);
  for (const tag of values) {
    const trimmed = tag.trim();
    const box =
      byLabel.get(trimmed) ??
      substringMap.get(trimmed.toLowerCase()) ??
      (() => {
        const lc = trimmed.toLowerCase();
        for (const [k, b] of substringMap) if (k.includes(lc) || lc.includes(k)) return b;
        return undefined;
      })();
    if (box) {
      if (!box.checked) {
        box.checked = true;
        box.dispatchEvent(new Event('change', { bubbles: true }));
      }
      highlight(box.closest('label') ?? box);
      checked += 1;
    } else {
      missing.push(tag);
    }
  }
  if (checked === 0 && values.length > 0) return degrade(field, `无匹配标签:${values.join('、')}`);
  if (missing.length > 0) return degrade(field, `部分标签未匹配:${missing.join('、')}`);
  return ok(field);
}

/** 草稿字段键 → ContentDraft 取值(body 由主世界单独处理,不在此)。 */
function valueFor(field: keyof FieldMapping, draft: ContentDraft): string | string[] {
  switch (field) {
    case 'title':
      return draft.title;
    case 'subtitle':
      return draft.subtitle;
    case 'category':
      return draft.category;
    case 'description':
      return draft.description;
    case 'postStatus':
      return draft.postStatus;
    case 'publishedAt':
      return draft.publishedAt;
    case 'mediaId':
      return draft.mediaId;
    case 'tags':
      return draft.tags;
    case 'body':
      return draft.body;
    case 'coverUrl':
      return draft.coverImageUrl;
  }
}

/** 单字段按类型分派。body(quill)返回 null —— 调用方转交主世界桥。 */
export function fillField(
  field: keyof FieldMapping,
  def: FieldDefinition,
  draft: ContentDraft,
  doc: Document,
): FieldFillResult | null {
  if (def.fieldType === 'quill') return null;
  const value = valueFor(field, draft);
  switch (def.fieldType) {
    case 'text':
    case 'textarea':
    case 'date':
      return fillTextLike(field, def, typeof value === 'string' ? value : '', doc);
    case 'native-select':
    case 'custom-dropdown':
      return fillNativeSelect(field, def, typeof value === 'string' ? value : '', doc);
    case 'checkbox-multi':
    case 'tag-input':
      return fillCheckboxMulti(field, def, Array.isArray(value) ? value : [], doc);
    default:
      return skip(field, `未知字段类型:${def.fieldType}`);
  }
}

/**
 * 填充除正文外的所有映射字段。绝不提交:只 set value + input/change + checkbox 勾选。
 * 返回逐字段结果(供 side panel 结果面板)。
 */
export function fillDraft(draft: ContentDraft, mapping: FieldMapping, doc: Document = document): FieldFillResult[] {
  const results: FieldFillResult[] = [];
  for (const key of Object.keys(mapping) as Array<keyof FieldMapping>) {
    const def = mapping[key];
    if (!def) continue;
    const res = fillField(key, def, draft, doc);
    if (res) results.push(res);
  }
  return results;
}
