import type { PublishResult } from './types';

// content 侧发布触发。**仅在收到 background 一次性"准许"后**由 content.ts 调用,
// content 自身绝不自我授权(见 entrypoints/content.ts)。
//
// 按 U0 实测:本后台保存 = `POST /admin/webarticle/save`(urlencoded,X-Requested-With),
// **靠 session cookie 鉴权、无 CSRF token**;naive `button.click()` 会掉回原生 GET 不保存,
// 故此处直接序列化表单 + POST(复刻 layui 提交),而非点按钮。
// 真实序列化正确性 jsdom 证不了 → authorized 首发必须人工 admin 冒烟兜底(见计划)。

export interface PublishDeps {
  doc?: Document;
  fetchFn?: typeof fetch;
  /** 保存端点(默认本后台 `/admin/webarticle/save`)。 */
  saveEndpoint?: string;
  /** 表单选择器。 */
  formSelector?: string;
  /** Quill 编辑器内容容器选择器(其 innerHTML 同步进 html_content)。 */
  editorSelector?: string;
}

const DEFAULT_SAVE_ENDPOINT = '/admin/webarticle/save';

/** 把 Quill 渲染内容同步进隐藏的 html_content(layui 提交前由站点脚本做,直 POST 须自己做)。 */
function syncQuillBody(form: HTMLFormElement, doc: Document, editorSelector: string): void {
  const editor = doc.querySelector(`${editorSelector} .ql-editor`) ?? doc.querySelector(editorSelector);
  const hidden = form.querySelector<HTMLInputElement>('[name="html_content"]');
  if (editor && hidden) hidden.value = editor.innerHTML;
}

/** 序列化表单为 urlencoded:checkbox/radio 仅取选中项,禁用项跳过。 */
function serializeForm(form: HTMLFormElement): URLSearchParams {
  const params = new URLSearchParams();
  for (const el of Array.from(form.elements)) {
    const field = el as HTMLInputElement & { name?: string; disabled?: boolean; type?: string };
    if (!field.name || field.disabled) continue;
    if ((field.type === 'checkbox' || field.type === 'radio') && !field.checked) continue;
    if (typeof field.value !== 'string') continue;
    params.append(field.name, field.value);
  }
  return params;
}

function extractUrl(data: Record<string, unknown>): string | undefined {
  if (typeof data.url === 'string') return data.url;
  const inner = data.data;
  if (inner && typeof inner === 'object' && typeof (inner as { url?: unknown }).url === 'string') {
    return (inner as { url: string }).url;
  }
  return undefined;
}

/** 执行发布。所有失败结构化返回,绝不抛裸异常,绝不带 cookie/key/CSRF。 */
export async function executePublish(deps: PublishDeps = {}): Promise<PublishResult> {
  const doc = deps.doc ?? document;
  const fetchFn = deps.fetchFn ?? fetch;
  const saveEndpoint = deps.saveEndpoint ?? DEFAULT_SAVE_ENDPOINT;
  const editorSelector = deps.editorSelector ?? '#editor';

  const form = doc.querySelector<HTMLFormElement>(deps.formSelector ?? 'form[lay-filter], form');
  if (!form) return { ok: false, dryRun: false, error: 'no-publish-target' };

  syncQuillBody(form, doc, editorSelector);
  const body = serializeForm(form).toString();

  let res: Response;
  try {
    res = await fetchFn(saveEndpoint, {
      method: 'POST',
      credentials: 'include', // 同源 session cookie;无 CSRF token(U0 确认)。
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body,
    });
  } catch {
    return { ok: false, dryRun: false, error: 'network' };
  }

  if (!res.ok) {
    return { ok: false, dryRun: false, error: `http-${res.status}` };
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return { ok: false, dryRun: false, error: 'bad-response' };
  }

  const obj = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  if (obj.code === 0) {
    return { ok: true, dryRun: false, url: extractUrl(obj) };
  }
  const msg = typeof obj.msg === 'string' ? obj.msg : 'save-failed';
  return { ok: false, dryRun: false, error: msg };
}
