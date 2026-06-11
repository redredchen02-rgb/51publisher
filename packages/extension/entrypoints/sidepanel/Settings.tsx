import { useEffect, useState, useCallback } from 'react';
import { DEFAULT_SETTINGS, getSettings, saveSettings } from '../../lib/storage';
import type { FieldMapping, FieldType } from '@51publisher/shared';
import { fetchPrompts, createPrompt, type PromptTemplate } from '../../lib/prompt-client';

const FIELD_TYPES: FieldType[] = [
  'text',
  'textarea',
  'quill',
  'native-select',
  'checkbox-multi',
  'date',
  'custom-dropdown',
  'tag-input',
];
const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '4px 6px',
  fontSize: 13,
  border: '1px solid #d9d9d9',
  borderRadius: 4,
};
const labelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: '#555',
  display: 'block',
  margin: '8px 0 2px',
};

/** 将多行/逗号分隔标签文本解析为去重去空字符串数组。 */
export function parseTagsText(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

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
  const [promptTemplate, setPromptTemplate] = useState('');
  const [fewShotExamples, setFewShotExamples] = useState('');
  const [tagsText, setTagsText] = useState('');
  const [mappingText, setMappingText] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [prompts, setPrompts] = useState<PromptTemplate[]>([]);
  const [selectedPromptId, setSelectedPromptId] = useState('');
  const [promptStatus, setPromptStatus] = useState('');

  useEffect(() => {
    void (async () => {
      const s = await getSettings();
      setPromptTemplate(s.promptTemplate);
      setFewShotExamples(s.fewShotExamples ?? '');
      setTagsText((s.recommendedTags ?? []).join('\n'));
      setMappingText(JSON.stringify(s.fieldMapping, null, 2));
    })();
  }, []);

  const handleLoadPrompts = useCallback(async () => {
    setPromptStatus('加载中...');
    const result = await fetchPrompts();
    if (result.ok && result.prompts) {
      setPrompts(result.prompts);
      setPromptStatus(`已加载 ${result.prompts.length} 个模板`);
    } else {
      setPromptStatus(`加载失败: ${result.error ?? '后端不可达'}`);
    }
  }, []);

  const handleSelectPrompt = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const id = e.target.value;
      setSelectedPromptId(id);
      if (!id) return;
      const t = prompts.find((p) => p.id === id);
      if (t) {
        setPromptTemplate(t.template);
        setFewShotExamples(t.fewShotExamples);
      }
    },
    [prompts],
  );

  const handleSaveToBackend = useCallback(async () => {
    const name = window.prompt('命名此模板:');
    if (!name) return;
    setPromptStatus('保存中...');
    const result = await createPrompt({
      name,
      template: promptTemplate,
      fewShotExamples,
    });
    if (result.ok) {
      setPromptStatus(`模板 "${name}" 已保存到后端`);
      void handleLoadPrompts();
    } else {
      setPromptStatus(`保存失败: ${result.error ?? '后端不可达'}`);
    }
  }, [promptTemplate, fewShotExamples, handleLoadPrompts]);

  async function handleSave() {
    setSaved(false);
    const mapErr = validateMapping(mappingText);
    if (mapErr) {
      setError(mapErr);
      return;
    }
    setError('');
    const existing = await getSettings();
    await saveSettings({
      ...existing,
      promptTemplate,
      fewShotExamples,
      recommendedTags: parseTagsText(tagsText),
      fieldMapping: JSON.parse(mappingText) as FieldMapping,
    });
    setSaved(true);
  }

  return (
    <div>
      <button onClick={onClose} style={{ fontSize: 13, marginBottom: 8 }}>
        ← 返回
      </button>
      <h2 style={{ fontSize: 15, margin: '0 0 4px' }}>设置</h2>

      <p style={{ fontSize: 11, color: '#888', marginBottom: 8 }}>
        ⚙️ 大模型 endpoint 与 API Key 已在后端服务 .env 中配置，扩展不直接管理。
      </p>

      <label style={labelStyle}>
        Prompt 模板(占位符:{'{{topic}}'} 选题 / {'{{facts}}'} 事实块 / {'{{fewshot}}'} 范例)
        <button
          style={{ marginLeft: 8, fontSize: 11 }}
          onClick={() => setPromptTemplate(DEFAULT_SETTINGS.promptTemplate)}
        >
          恢复默认
        </button>
      </label>
      <textarea
        style={{ ...inputStyle, minHeight: 120 }}
        value={promptTemplate}
        onChange={(e) => setPromptTemplate(e.target.value)}
      />
      <p style={{ color: '#888', fontSize: 11, margin: '2px 0 0' }}>
        源接地:AI 只用 {'{{facts}}'} 里给的事实润色,缺的标【待补】,连结只用给定 URL——防止编造作品事实/连结。
      </p>

      <label style={labelStyle}>
        Few-shot 范例(51娘 口吻/结构示例,与 prompt 分开调)
        <button
          style={{ marginLeft: 8, fontSize: 11 }}
          onClick={() => setFewShotExamples(DEFAULT_SETTINGS.fewShotExamples ?? '')}
        >
          恢复默认
        </button>
      </label>
      <textarea
        style={{ ...inputStyle, minHeight: 100 }}
        value={fewShotExamples}
        onChange={(e) => setFewShotExamples(e.target.value)}
      />
      <p style={{ color: '#888', fontSize: 11, margin: '2px 0 0' }}>
        ⚠️ 范例里别写真实連結(会随每次请求发往后端);用占位即可。
      </p>

      <label style={labelStyle}>推荐标签清单 (每行一个或逗号分隔)</label>
      <textarea
        style={{ ...inputStyle, minHeight: 80 }}
        placeholder={'漢化\n無修正\n校園日常\n…（约 20–50 条为宜）'}
        value={tagsText}
        onChange={(e) => setTagsText(e.target.value)}
      />
      <p style={{ color: '#888', fontSize: 11, margin: '2px 0 0' }}>
        AI 生成时只从此列表选择标签；留空则仅约束分类不约束标签。
      </p>

      <hr style={{ margin: '14px 0 6px', border: 'none', borderTop: '1px solid #e8e8e8' }} />

      <label style={labelStyle}>
        Prompt 管理
        <button style={{ marginLeft: 8, fontSize: 11 }} onClick={handleLoadPrompts}>
          从后端加载
        </button>
      </label>
      {prompts.length > 0 && (
        <select style={{ ...inputStyle, marginBottom: 4 }} value={selectedPromptId} onChange={handleSelectPrompt}>
          <option value="">-- 选择模板 --</option>
          {prompts.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      )}
      <button style={{ fontSize: 11, marginTop: 2 }} onClick={handleSaveToBackend}>
        保存到后端
      </button>
      {promptStatus && <p style={{ color: '#888', fontSize: 11, margin: '2px 0 0' }}>{promptStatus}</p>}

      <label style={labelStyle}>
        字段映射(JSON)
        <button
          style={{ marginLeft: 8, fontSize: 11 }}
          onClick={() => setMappingText(JSON.stringify(DEFAULT_SETTINGS.fieldMapping, null, 2))}
        >
          恢复默认
        </button>
      </label>
      <textarea
        style={{ ...inputStyle, minHeight: 140, fontFamily: 'monospace', fontSize: 11 }}
        value={mappingText}
        onChange={(e) => setMappingText(e.target.value)}
      />

      {error && (
        <p role="alert" style={{ color: '#cf1322', fontSize: 12 }}>
          {error}
        </p>
      )}
      {saved && <p style={{ color: '#389e0d', fontSize: 12 }}>已保存。</p>}

      <button
        onClick={handleSave}
        style={{
          marginTop: 10,
          padding: '6px 14px',
          fontSize: 13,
          background: '#1677ff',
          color: '#fff',
          border: 'none',
          borderRadius: 4,
          cursor: 'pointer',
        }}
      >
        保存
      </button>
    </div>
  );
}
