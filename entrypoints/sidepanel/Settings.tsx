import { useEffect, useState } from 'react';
import { DEFAULT_SETTINGS, getApiKey, getSettings, saveApiKey, saveSettings } from '../../lib/storage';
import { listModels } from '../../lib/llm';
import type { FieldMapping, FieldType } from '../../lib/types';

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
  const [fewShotExamples, setFewShotExamples] = useState('');
  const [mappingText, setMappingText] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelsMsg, setModelsMsg] = useState('');

  async function handleFetchModels() {
    setModelsMsg('');
    setModels([]);
    if (!endpoint || !apiKey) {
      setModelsMsg('请先填 endpoint(base URL 即可)与 API key。');
      return;
    }
    setLoadingModels(true);
    try {
      const r = await listModels(endpoint, apiKey);
      if (r.ok) {
        setModels(r.models);
        if (!r.models.includes(model)) setModel(r.models[0] ?? model);
        setModelsMsg(`拉到 ${r.models.length} 个模型,请在下拉里选择。`);
      } else {
        setModelsMsg(r.error);
      }
    } catch {
      setModelsMsg('拉取失败,请重试。');
    } finally {
      setLoadingModels(false);
    }
  }

  useEffect(() => {
    void (async () => {
      const [s, key] = await Promise.all([getSettings(), getApiKey()]);
      setEndpoint(s.endpoint);
      setModel(s.model);
      setPromptTemplate(s.promptTemplate);
      setFewShotExamples(s.fewShotExamples ?? '');
      setMappingText(JSON.stringify(s.fieldMapping, null, 2));
      setApiKey(key);
    })();
  }, []);

  async function handleSave() {
    setSaved(false);
    if (endpoint && !/^https:\/\//i.test(endpoint)) {
      setError('endpoint 必须是 https:// 地址(API key 会发往此处)。');
      return;
    }
    const mapErr = validateMapping(mappingText);
    if (mapErr) {
      setError(mapErr);
      return;
    }
    setError('');
    await saveSettings({ endpoint, model, promptTemplate, fewShotExamples, fieldMapping: JSON.parse(mappingText) as FieldMapping });
    await saveApiKey(apiKey);
    setSaved(true);
  }

  return (
    <div>
      <button onClick={onClose} style={{ fontSize: 13, marginBottom: 8 }}>← 返回</button>
      <h2 style={{ fontSize: 15, margin: '0 0 4px' }}>设置</h2>

      <label style={labelStyle}>大模型 endpoint(OpenAI 兼容;填 base URL 或完整地址均可)</label>
      <input style={inputStyle} value={endpoint} placeholder="https://la-sealion.inaiai.com/v1" onChange={(e) => setEndpoint(e.target.value)} />
      <p style={{ color: '#888', fontSize: 11, margin: '2px 0 0' }}>
        只填到 <code>/v1</code> 即可,会自动补 <code>/chat/completions</code> 与 <code>/models</code>。
      </p>

      <label style={labelStyle}>API key</label>
      <input style={inputStyle} type="password" value={apiKey} placeholder="sk-..." onChange={(e) => setApiKey(e.target.value)} />
      <p style={{ color: '#cf1322', fontSize: 11, margin: '2px 0 0' }}>
        ⚠️ key 以明文存储于本地浏览器(chrome.storage.local),并会随请求发往上面配置的 endpoint。请只配置可信地址,建议使用权限受限的专用 key。
      </p>

      <label style={labelStyle}>
        模型
        <button
          style={{ marginLeft: 8, fontSize: 11 }}
          onClick={() => void handleFetchModels()}
          disabled={loadingModels}
        >
          {loadingModels ? '拉取中…' : '↻ 拉取模型列表'}
        </button>
      </label>
      {models.length > 0 ? (
        <select style={inputStyle} value={model} onChange={(e) => setModel(e.target.value)} aria-label="选择模型">
          {!models.includes(model) && model && <option value={model}>{model}(手填)</option>}
          {models.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      ) : (
        <input style={inputStyle} value={model} placeholder="拉取列表选择,或手填模型名" onChange={(e) => setModel(e.target.value)} />
      )}
      {modelsMsg && <p style={{ color: models.length > 0 ? '#389e0d' : '#cf1322', fontSize: 11, margin: '2px 0 0' }}>{modelsMsg}</p>}

      <label style={labelStyle}>
        Prompt 模板(占位符:{'{{topic}}'} 选题 / {'{{facts}}'} 事实块 / {'{{fewshot}}'} 范例)
        <button style={{ marginLeft: 8, fontSize: 11 }} onClick={() => setPromptTemplate(DEFAULT_SETTINGS.promptTemplate)}>
          恢复默认
        </button>
      </label>
      <textarea style={{ ...inputStyle, minHeight: 120 }} value={promptTemplate} onChange={(e) => setPromptTemplate(e.target.value)} />
      <p style={{ color: '#888', fontSize: 11, margin: '2px 0 0' }}>
        源接地:AI 只用 {'{{facts}}'} 里给的事实润色,缺的标【待补】,连结只用给定 URL——防止编造作品事实/连结。
      </p>

      <label style={labelStyle}>
        Few-shot 范例(51娘 口吻/结构示例,与 prompt 分开调)
        <button style={{ marginLeft: 8, fontSize: 11 }} onClick={() => setFewShotExamples(DEFAULT_SETTINGS.fewShotExamples ?? '')}>
          恢复默认
        </button>
      </label>
      <textarea style={{ ...inputStyle, minHeight: 100 }} value={fewShotExamples} onChange={(e) => setFewShotExamples(e.target.value)} />
      <p style={{ color: '#888', fontSize: 11, margin: '2px 0 0' }}>
        ⚠️ 范例里别写真实漢化/無修连结(会随每次请求发往 endpoint);用占位即可。
      </p>

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
