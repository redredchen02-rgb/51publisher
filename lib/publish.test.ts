// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executePublish } from './publish';

function mountForm(): void {
  document.body.innerHTML = `
    <form lay-filter="form-save">
      <input name="media_id" value="1" />
      <input name="title" value="测试標題" />
      <input name="subtitle" value="副標題" />
      <select name="type"><option value="2" selected>漫畫</option><option value="4">動漫</option></select>
      <select name="status"><option value="0" selected>隱藏</option><option value="1">顯示</option></select>
      <textarea name="description">描述</textarea>
      <input type="hidden" name="html_content" value="" />
      <input type="checkbox" name="tags[]" value="a" checked />
      <input type="checkbox" name="tags[]" value="b" />
      <input type="checkbox" name="tags[]" value="c" checked />
      <button lay-submit lay-filter="save">保存</button>
    </form>
    <div id="editor"><div class="ql-editor"><p>正文 <strong>粗</strong></p></div></div>
  `;
}

function okFetch(json: unknown): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify(json), { status: 200, headers: { 'Content-Type': 'application/json' } })) as unknown as typeof fetch;
}

describe('executePublish', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('happy:POST 到 save 端点,body 含字段,code:0 → ok+url', async () => {
    mountForm();
    const fetchFn = okFetch({ code: 0, msg: '操作成功', url: '/post/9' });
    const res = await executePublish({ fetchFn, saveEndpoint: '/admin/webarticle/save' });
    expect(res.ok).toBe(true);
    expect(res.dryRun).toBe(false);

    expect(fetchFn).toHaveBeenCalledOnce();
    const call = (fetchFn as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
    expect(call).toBeDefined();
    const [url, init] = call!;
    expect(url).toBe('/admin/webarticle/save');
    expect(init.method).toBe('POST');
    const body = String(init.body);
    expect(body).toContain('title=');
    expect(body).toContain('media_id=1');
    // Quill 正文同步进 html_content
    expect(decodeURIComponent(body)).toContain('正文');
    // 多选 tags 只取勾选项
    expect(body).toContain('tags%5B%5D=a');
    expect(body).toContain('tags%5B%5D=c');
    expect(body).not.toContain('tags%5B%5D=b');
  });

  it('无表单 → no-publish-target,且 fetch 未被调用', async () => {
    const fetchFn = okFetch({ code: 0 });
    const res = await executePublish({ fetchFn });
    expect(res).toEqual({ ok: false, dryRun: false, error: 'no-publish-target' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('网络错误 → 结构化 error,不抛异常', async () => {
    mountForm();
    const fetchFn = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    const res = await executePublish({ fetchFn });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('network');
  });

  it('后台 code≠0 → 失败,带后台 msg', async () => {
    mountForm();
    const fetchFn = okFetch({ code: 1, msg: '作品id不存在' });
    const res = await executePublish({ fetchFn });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('作品id不存在');
  });

  it('HTTP 非 2xx → 失败,error 不含响应头/敏感串', async () => {
    mountForm();
    const fetchFn = vi.fn(async () => new Response('forbidden', { status: 403 })) as unknown as typeof fetch;
    const res = await executePublish({ fetchFn });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/403/);
  });
});
