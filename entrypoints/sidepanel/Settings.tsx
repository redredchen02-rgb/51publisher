import { useEffect, useState } from 'react';
import { DEFAULT_SETTINGS, getApiKey, getBackendToken, getSettings, saveApiKey, saveBackendToken, saveSettings } from '../../lib/storage';
import type { FieldMapping, FieldType, FewShotPair } from '../../lib/types';
import { FewShotPairEditor } from './components/FewShotPairEditor';

const MAX_PAIRS = 8;

/** 从 fewShotPairs 派生 fewShotExamples 字符串(每条 input\n---\noutput，条间 \n\n 分隔)。 */
export function deriveFewShotExamples(pairs: FewShotPair[]): string {
  return pairs.map((p) => `${p.input}\n---\n${p.output}`).join('\n\n');
}

const FIELD_TYPES: FieldType[] = ['text', 'textarea', 'quill', 'native-select', 'checkbox-multi', 'date', 'custom-dropdown', 'tag-input'];
const inputStyle: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '4px 6px', fontSize: 13, border: '1px solid #d9d9d9', borderRadius: 4 };
const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: '#555', display: 'block', margin: '8px 0 2px' };

/** 校验字段映射 JSON:必须是对象,每条含 selector 字符串与合法 fieldType。返回错误信息或 null。 */
export function validateMapping(text: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return `JSON 格式错误:${(e as Error).message}`;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return '字段映射必须是一个对象。';
  for (const [key, def] of Object.entries(parsed as Record<string, unknown>)) {
    if (!def || typeof def !== 'object') return `字段 ${key} 必须是对象。`;
    const d = def as Record<string, unknown>;
    if (typeof d.selector !== 'string' || !d.selector) return `字段 ${key} 缺少有效的 selector。`;
    if (typeof d.fieldType !== 'string' || !FIELD_TYPES.includes(d.fieldType as FieldType)) {
      return `字段 ${key} 的 fieldType 非法(应为:${FIELD_TYPES.join(' / ')})。`;
    }
  }
  return null;
}

export function Settings({ onClose }: { onClose: () => void }) {
  const [endpoint, setEndpoint] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [promptTemplate, setPromptTemplate] = useState('');
  const [mappingText, setMappingText] = useState('');
  const [fallbackEndpoint, setFallbackEndpoint] = useState('');
  const [fallbackModel, setFallbackModel] = useState('');
  const [fallbackOpen, setFallbackOpen] = useState(false);
  const [backendUrl, setBackendUrl] = useState('');
  const [backendToken, setBackendToken] = useState('');
  const [fewShotPairs, setFewShotPairs] = useState<FewShotPair[]>([]);
  const [importBanner, setImportBanner] = useState('');
  const [importTruncated, setImportTruncated] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void (async () => {
      const [s, key, bToken] = await Promise.all([getSettings(), getApiKey(), getBackendToken()]);
      setEndpoint(s.endpoint);
      setModel(s.model);
      setPromptTemplate(s.promptTemplate);
      setMappingText(JSON.stringify(s.fieldMapping, null, 2));
      setApiKey(key);
      setBackendUrl(s.backendUrl ?? '');
      setBackendToken(bToken);
      if (s.fallbackModel) {
        setFallbackEndpoint(s.fallbackModel.endpoint);
        setFallbackModel(s.fallbackModel.model ?? '');
        setFallbackOpen(true);
      }
      const pairs = s.fewShotPairs ?? [];
      setFewShotPairs(pairs);
      if (s.fewShotExamples && pairs.length === 0) {
        setImportBanner('检测到旧格式范例，点击导入→结构化编辑器');
      }
    })();
  }, []);

  async function handleImport() {
    const s = await getSettings();
    const raw = s.fewShotExamples ?? '';
    const blocks = raw.split(/\n\n+/).filter(Boolean);
    const truncated = blocks.length > MAX_PAIRS;
    const taken = blocks.slice(0, MAX_PAIRS).map((b) => ({ input: '', output: b }));
    setFewShotPairs(taken);
    setImportBanner('');
    if (truncated) setImportTruncated(`检测到 ${blocks.length} 块，已截取前 ${MAX_PAIRS} 条，请检查并补全 input 字段`);
    else setImportTruncated('');
  }

  async function handleSave() {
    setSaved(false);
    if (endpoint && !/^https:\/\//i.test(endpoint)) {
      setError('endpoint 必须是 https:// 地址(API key 会发往此处)。');
      return;
    }
    if (fallbackEndpoint && !/^https:\/\//i.test(fallbackEndpoint)) {
      setError('备用 endpoint 必须是 https:// 地址。');
      return;
    }
    const mapErr = validateMapping(mappingText);
    if (mapErr) {
      setError(mapErr);
      return;
    }
    if (backendUrl && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(backendUrl)) {
      setError('后端 URL 必须是 localhost 或 127.0.0.1 地址（例：http://localhost:3001）。');
      return;
    }
    setError('');
    const fbModel = fallbackEndpoint
      ? { endpoint: fallbackEndpoint, ...(fallbackModel ? { model: fallbackModel } : {}) }
      : undefined;
    const fewShotExamples = fewShotPairs.length > 0 ? deriveFewShotExamples(fewShotPairs) : undefined;
    await saveSettings({
      endpoint, model, promptTemplate,
      fieldMapping: JSON.parse(mappingText) as FieldMapping,
      fallbackModel: fbModel,
      fewShotPairs,
      fewShotExamples,
      backendUrl: backendUrl || undefined,
    });
    await saveApiKey(apiKey);
    await saveBackendToken(backendToken);
    setSaved(true);
  }

  return (
    <div>
      <button onClick={onClose} style={{ fontSize: 13, marginBottom: 8 }}>← 返回</button>
      <h2 style={{ fontSize: 15, margin: '0 0 4px' }}>设置</h2>

      <label style={labelStyle}>大模型 endpoint(仅支持 OpenAI 兼容 chat/completions)</label>
      <input style={inputStyle} value={endpoint} placeholder="https://api.openai.com/v1/chat/completions" onChange={(e) => setEndpoint(e.target.value)} />

      <label style={labelStyle}>模型</label>
      <input style={inputStyle} value={model} onChange={(e) => setModel(e.target.value)} />

      <label style={labelStyle}>API key</label>
      <input style={inputStyle} type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
      <p style={{ color: '#cf1322', fontSize: 11, margin: '2px 0 0' }}>
        ⚠️ key 以明文存储于本地浏览器(chrome.storage.local),并会随请求发往上面配置的 endpoint。请只配置可信地址,建议使用权限受限的专用 key。
      </p>

      {/* 备用 LLM 端点(可折叠) */}
      <div style={{ marginTop: 10, border: '1px solid #e8e8e8', borderRadius: 4, padding: '6px 8px' }}>
        <button
          type="button"
          aria-expanded={fallbackOpen}
          onClick={() => setFallbackOpen((v) => !v)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: '#555', padding: 0, width: '100%', textAlign: 'left' }}
        >
          {fallbackOpen ? '▼' : '▶'} 备用 LLM 端点{fallbackEndpoint ? ' (已配置)' : ' (可选)'}
        </button>
        {fallbackOpen && (
          <div style={{ marginTop: 6 }}>
            <p style={{ fontSize: 11, color: '#888', margin: '0 0 6px' }}>主端点失败时自动回退。留空即不启用。</p>
            <label style={labelStyle}>备用 endpoint</label>
            <input style={inputStyle} value={fallbackEndpoint} placeholder="https://…" onChange={(e) => setFallbackEndpoint(e.target.value)} />
            <label style={labelStyle}>备用模型名(可选)</label>
            <input style={inputStyle} value={fallbackModel} onChange={(e) => setFallbackModel(e.target.value)} />
          </div>
        )}
      </div>

      {/* 后端连接（可选，用于 published_posts 注册表双写） */}
      <label style={labelStyle}>后端 URL（可选，http://localhost:3001）</label>
      <input style={inputStyle} value={backendUrl} placeholder="http://localhost:3001" onChange={(e) => setBackendUrl(e.target.value)} />
      <label style={labelStyle}>后端 JWT Token（可选）</label>
      <input style={inputStyle} type="password" value={backendToken} onChange={(e) => setBackendToken(e.target.value)} />

      {/* Few-shot 范例编辑器 */}
      <div style={{ marginTop: 10 }}>
        <div style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 6 }}>
          Few-shot 范例
          <span style={{ fontSize: 11, fontWeight: 400, color: '#888' }}>({fewShotPairs.length}/{MAX_PAIRS})</span>
        </div>
        {importTruncated && (
          <p role="alert" style={{ fontSize: 11, color: '#fa8c16', margin: '0 0 4px' }}>{importTruncated}</p>
        )}
        <FewShotPairEditor
          pairs={fewShotPairs}
          onChange={setFewShotPairs}
          importBanner={importBanner || undefined}
          onImport={() => void handleImport()}
        />
      </div>

      <label style={labelStyle}>Prompt 模板(用 {'{{topic}}'} 注入主题)</label>
      <textarea style={{ ...inputStyle, minHeight: 80 }} value={promptTemplate} onChange={(e) => setPromptTemplate(e.target.value)} />

      <label style={labelStyle}>
        字段映射(JSON)
        <button
          style={{ marginLeft: 8, fontSize: 11 }}
          onClick={() => setMappingText(JSON.stringify(DEFAULT_SETTINGS.fieldMapping, null, 2))}
        >
          恢复默认
        </button>
      </label>
      <textarea style={{ ...inputStyle, minHeight: 140, fontFamily: 'monospace', fontSize: 11 }} value={mappingText} onChange={(e) => setMappingText(e.target.value)} />

      {error && <p role="alert" style={{ color: '#cf1322', fontSize: 12 }}>{error}</p>}
      {saved && <p style={{ color: '#389e0d', fontSize: 12 }}>已保存。</p>}

      <button onClick={handleSave} style={{ marginTop: 10, padding: '6px 14px', fontSize: 13, background: '#1677ff', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
        保存
      </button>
    </div>
  );
}
