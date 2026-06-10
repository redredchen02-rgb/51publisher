// 安全档位插桩(由 zero-submit.ts 演化)。
// 旧约束"提交恒 0"反转为**授权矩阵**:仅 (host∈名单, authorized, 已准许) 才允许提交>0。
//
// U0 实测本后台保存 = `POST /admin/webarticle/save`(XHR/fetch),**form.submit 不触发**,
// 故必须加**第 4 通道**:patch fetch / XMLHttpRequest,数"到 save 端点的 POST"。
// 否则只盯 form.submit/button.click 会对真实提交路径"假绿"。

export interface FetchSubmitSpy {
  /** 到 save 端点的 POST 次数(fetch + XHR 合计)。 */
  submitCount(): number;
  restore(): void;
}

interface FetchTarget {
  fetch: typeof fetch;
  XMLHttpRequest: typeof XMLHttpRequest;
}

const SAVE_FRAGMENT = '/webarticle/save';

function okJsonResponse(): Response {
  return new Response(JSON.stringify({ code: 0, msg: 'ok' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * patch target 上的 fetch 与 XMLHttpRequest,统计"到 save 端点的 POST"。
 * 不真正发请求(返回成功响应 / 静默吞 XHR),避免 jsdom 网络噪声。
 */
export function installFetchSubmitSpy(
  target: FetchTarget = globalThis as unknown as FetchTarget,
  saveFragment: string = SAVE_FRAGMENT,
): FetchSubmitSpy {
  let count = 0;
  const origFetch = target.fetch;
  const OrigXHR = target.XMLHttpRequest;

  target.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : String((input as Request).url ?? input);
    const method = (init?.method ?? 'GET').toUpperCase();
    if (method === 'POST' && url.includes(saveFragment)) count += 1;
    return okJsonResponse();
  }) as typeof fetch;

  // 极简 XHR 替身:只关心 open(method,url)+send 是否打到 save 端点。
  // 纵深防御(非死代码):当前 executePublish 走 fetch,但若日后误引入 XHR 提交路径,
  // 此通道会立即把它计入 submitCount → 安全档位矩阵会抓到回归。
  class SpyXHR {
    private method = 'GET';
    private url = '';
    open(method: string, url: string) {
      this.method = method.toUpperCase();
      this.url = url;
    }
    setRequestHeader() {}
    send() {
      if (this.method === 'POST' && this.url.includes(saveFragment)) count += 1;
    }
    abort() {}
    addEventListener() {}
    removeEventListener() {}
  }
  target.XMLHttpRequest = SpyXHR as unknown as typeof XMLHttpRequest;

  return {
    submitCount: () => count,
    restore() {
      target.fetch = origFetch;
      target.XMLHttpRequest = OrigXHR;
    },
  };
}
