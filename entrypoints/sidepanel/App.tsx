import { useEffect, useRef, useState } from 'react';
import type { ContentDraft, FieldFillResult } from '../../lib/types';
import { clearCurrentDraft, getCurrentDraft, getSettings, saveCurrentDraft } from '../../lib/storage';
import { buildPrompt, requestFill, requestGenerate } from '../../lib/messaging';
import { DraftPreview } from './DraftPreview';
import { FillResultPanel } from './FillResultPanel';
import { Settings } from './Settings';

type Mode = 'empty' | 'generating' | 'draft' | 'filling' | 'filled' | 'partial';

const btn: React.CSSProperties = { padding: '6px 14px', fontSize: 13, border: 'none', borderRadius: 4, cursor: 'pointer' };
const primaryBtn: React.CSSProperties = { ...btn, background: '#1677ff', color: '#fff' };
const plainBtn: React.CSSProperties = { ...btn, background: '#f0f0f0', color: '#333' };

export function App() {
  const [view, setView] = useState<'main' | 'settings'>('main');
  const [mode, setMode] = useState<Mode>('empty');
  const [topic, setTopic] = useState('');
  const [draft, setDraft] = useState<ContentDraft | null>(null);
  const [results, setResults] = useState<FieldFillResult[]>([]);
  const [error, setError] = useState('');
  const [confirmNext, setConfirmNext] = useState(false);
  const promptTemplateRef = useRef('');
  const genTokenRef = useRef(0); // 取消用:递增后旧请求结果作废

  // 挂载:载入 prompt 模板 + 恢复上一条未完成草稿(崩溃恢复)。
  useEffect(() => {
    void (async () => {
      const [s, saved] = await Promise.all([getSettings(), getCurrentDraft()]);
      promptTemplateRef.current = s.promptTemplate;
      if (saved) {
        setDraft(saved);
        setMode('draft');
      }
    })();
  }, []);

  function updateDraft(next: ContentDraft) {
    setDraft(next);
    void saveCurrentDraft(next);
  }

  async function handleGenerate() {
    if (!topic.trim()) {
      setError('请先输入主题。');
      return;
    }
    setError('');
    setResults([]);
    setMode('generating');
    const token = ++genTokenRef.current;
    const res = await requestGenerate(buildPrompt(promptTemplateRef.current, topic));
    if (token !== genTokenRef.current) return; // 已取消
    if (res.ok) {
      updateDraft(res.draft);
      setMode('draft');
    } else {
      setError(res.kind === 'no-key' ? `${res.error}(点右上角设置)` : res.error);
      setMode(draft ? 'draft' : 'empty');
    }
  }

  function cancelGenerate() {
    genTokenRef.current++;
    setMode(draft ? 'draft' : 'empty');
  }

  async function handleFill() {
    if (!draft) return;
    setError('');
    setMode('filling');
    const res = await requestFill(draft);
    if (res.ok) {
      setResults(res.results);
      const anyProblem = res.results.some((r) => r.status !== 'filled');
      setMode(anyProblem ? 'partial' : 'filled');
    } else {
      setError(res.error);
      setMode('draft');
    }
  }

  function handleNext() {
    if (mode === 'partial' && !confirmNext) {
      setConfirmNext(true);
      return;
    }
    setConfirmNext(false);
    void clearCurrentDraft();
    setDraft(null);
    setResults([]);
    setTopic('');
    setError('');
    setMode('empty');
  }

  function copyBody() {
    if (draft) void navigator.clipboard?.writeText(draft.body);
  }

  if (view === 'settings') return <Wrap><Settings onClose={() => setView('main')} /></Wrap>;

  const busy = mode === 'generating' || mode === 'filling';

  return (
    <Wrap>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <h1 style={{ fontSize: 16, margin: 0 }}>51publisher 填充助手</h1>
        <button onClick={() => setView('settings')} style={{ ...plainBtn, padding: '4px 10px' }} aria-label="设置">⚙ 设置</button>
      </div>

      <div role="note" style={{ background: '#fff7e6', border: '1px solid #ffd591', borderRadius: 6, padding: '8px 10px', fontSize: 13, marginBottom: 12 }}>
        ⚠️ 插件不会自动发布,请人工审核后手动发布。
      </div>

      {error && <p role="alert" style={{ color: '#cf1322', fontSize: 13, background: '#fff1f0', border: '1px solid #ffa39e', borderRadius: 4, padding: '6px 8px' }}>{error}</p>}

      {(mode === 'empty' || mode === 'generating' || (mode === 'draft' && !draft)) && (
        <div style={{ marginBottom: 12 }}>
          <textarea
            style={{ width: '100%', boxSizing: 'border-box', minHeight: 60, padding: 6, fontSize: 13, border: '1px solid #d9d9d9', borderRadius: 4 }}
            placeholder="输入选题/主题,例如:介绍某部新番的看点"
            value={topic}
            disabled={busy}
            onChange={(e) => setTopic(e.target.value)}
          />
        </div>
      )}

      {mode === 'generating' && (
        <div aria-live="polite" style={{ fontSize: 13, color: '#555', marginBottom: 8 }}>
          正在生成草稿… <button onClick={cancelGenerate} style={{ ...plainBtn, padding: '2px 8px', marginLeft: 6 }}>取消</button>
        </div>
      )}

      {draft && mode !== 'generating' && <DraftPreview draft={draft} onChange={updateDraft} />}

      {mode === 'filling' && <div aria-live="polite" style={{ fontSize: 13, color: '#555' }}>正在填充到当前页…</div>}

      {(mode === 'filled' || mode === 'partial') && <FillResultPanel results={results} />}

      {mode === 'partial' && (
        <div style={{ marginTop: 8, fontSize: 12 }}>
          <button onClick={copyBody} style={{ ...plainBtn, padding: '4px 10px' }}>复制正文</button>
          <span style={{ color: '#888', marginLeft: 8 }}>正文可能需手动粘贴到编辑器。</span>
        </div>
      )}

      {confirmNext && (
        <div role="alert" style={{ marginTop: 8, fontSize: 12, color: '#cf1322' }}>
          正文尚未确认填入,确定进入下一条?
          <button onClick={handleNext} style={{ ...plainBtn, padding: '2px 8px', marginLeft: 6 }}>确定</button>
          <button onClick={() => setConfirmNext(false)} style={{ ...plainBtn, padding: '2px 8px', marginLeft: 4 }}>取消</button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        {(mode === 'empty' || mode === 'generating' || mode === 'draft') && (
          <button onClick={handleGenerate} disabled={busy} style={primaryBtn}>生成草稿</button>
        )}
        {draft && (mode === 'draft' || mode === 'filled' || mode === 'partial') && (
          <button onClick={handleFill} disabled={busy} style={primaryBtn}>填充到当前页</button>
        )}
        {draft && (
          <button onClick={handleNext} disabled={busy} style={plainBtn}>下一条</button>
        )}
      </div>
    </Wrap>
  );
}

function Wrap({ children }: { children: React.ReactNode }) {
  return <main style={{ fontFamily: 'system-ui, sans-serif', padding: 12, fontSize: 14 }}>{children}</main>;
}
