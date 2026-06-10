import { useEffect, useRef, useState } from 'react';
import type { ContentDraft, FieldFillResult } from '@51publisher/shared';
import { clearCurrentDraft, getCurrentDraft, getSettings, saveCurrentDraft } from '../../lib/storage';
import { buildPrompt, requestFill, requestGenerate } from '../../lib/messaging';
import { isAuthenticated } from '../../lib/auth-client';
import { ErrorBoundary } from './ErrorBoundary';
import { Loading } from './Loading';
import { DraftPreview } from './DraftPreview';
import { FillResultPanel } from './FillResultPanel';
import { Settings } from './Settings';
import { BatchView } from './BatchView';
import { AuthView } from './AuthView';
import { PendingTopicsView } from './PendingTopicsView';

type Mode = 'empty' | 'generating' | 'draft' | 'filling' | 'filled' | 'partial';

const btn: React.CSSProperties = {};
const primaryBtn: React.CSSProperties = {};
const plainBtn: React.CSSProperties = {};

export function App() {
  const [view, setView] = useState<'main' | 'settings' | 'batch' | 'pending' | 'auth'>('main');
  const [mode, setMode] = useState<Mode>('empty');
  const [topic, setTopic] = useState('');
  const [draft, setDraft] = useState<ContentDraft | null>(null);
  const [results, setResults] = useState<FieldFillResult[]>([]);
  const [error, setError] = useState('');
  const [confirmNext, setConfirmNext] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [authChecking, setAuthChecking] = useState(true);
  const promptTemplateRef = useRef('');
  const genTokenRef = useRef(0); // 取消用:递增后旧请求结果作废

  // 挂载:载入 prompt 模板 + 恢复上一条未完成草稿(崩溃恢复) + 检查登录状态。
  useEffect(() => {
    void (async () => {
      const [s, saved] = await Promise.all([getSettings(), getCurrentDraft()]);
      promptTemplateRef.current = s.promptTemplate;
      if (saved) {
        setDraft(saved);
        setMode('draft');
      }
      const authed = await isAuthenticated();
      setAuthenticated(authed);
      setView(authed ? 'main' : 'auth');
      setAuthChecking(false);
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

  if (authChecking) {
    return <Loading />;
  }

  if (view === 'auth') {
    return (
      <Wrap>
        <AuthView
          onLogin={() => {
            setAuthenticated(true);
            setView('main');
          }}
        />
      </Wrap>
    );
  }

  if (view === 'settings')
    return (
      <Wrap>
        <Settings onClose={() => setView('main')} />
      </Wrap>
    );
  if (view === 'batch') return <BatchView onBack={() => setView('main')} />;
  if (view === 'pending')
    return (
      <PendingTopicsView
        onBack={() => setView('main')}
        onBatchStarted={() => setView('batch')}
        onError={(msg) => setError(msg)}
      />
    );

  const busy = mode === 'generating' || mode === 'filling';

  return (
    <Wrap>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <h1 style={{ fontSize: 16, margin: 0 }}>51publisher 填充助手</h1>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span
            onClick={() => {
              if (!authenticated) setView('auth');
            }}
            style={{
              fontSize: 11,
              color: authenticated ? '#389e0d' : '#cf1322',
              cursor: authenticated ? 'default' : 'pointer',
              userSelect: 'none',
            }}
          >
            {authenticated ? '已登录' : '未登录'}
          </span>
          <button onClick={() => setView('pending')} className="btn btn-plain" aria-label="待审核">
            ◎ 待审
          </button>
          <button onClick={() => setView('batch')} className="btn btn-plain" aria-label="批量">
            ≣ 批量
          </button>
          <button onClick={() => setView('settings')} className="btn btn-plain" aria-label="设置">
            ⚙ 设置
          </button>
        </div>
      </div>

      <div
        role="note"
        style={{
          background: '#fff7e6',
          border: '1px solid #ffd591',
          borderRadius: 6,
          padding: '8px 10px',
          fontSize: 13,
          marginBottom: 12,
        }}
      >
        ⚠️ 插件不会自动发布,请人工审核后手动发布。
      </div>

      {error && (
        <p
          role="alert"
          style={{
            color: '#cf1322',
            fontSize: 13,
            background: '#fff1f0',
            border: '1px solid #ffa39e',
            borderRadius: 4,
            padding: '6px 8px',
          }}
        >
          {error}
        </p>
      )}

      {(mode === 'empty' || mode === 'generating' || (mode === 'draft' && !draft)) && (
        <div style={{ marginBottom: 12 }}>
          <textarea
            style={{
              width: '100%',
              boxSizing: 'border-box',
              minHeight: 60,
              padding: 6,
              fontSize: 13,
              border: '1px solid #d9d9d9',
              borderRadius: 4,
            }}
            placeholder="输入选题/主题,例如:介绍某部新番的看点"
            value={topic}
            disabled={busy}
            onChange={(e) => setTopic(e.target.value)}
          />
        </div>
      )}

      {mode === 'generating' && (
        <div aria-live="polite" style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 8 }}>
          正在生成草稿…{' '}
          <button onClick={cancelGenerate} className="btn btn-plain" style={{ padding: '2px 8px', marginLeft: 6 }}>
            取消
          </button>
        </div>
      )}

      {draft && mode !== 'generating' && <DraftPreview draft={draft} onChange={updateDraft} />}

      {mode === 'filling' && (
        <div aria-live="polite" style={{ fontSize: 13, color: '#555' }}>
          正在填充到当前页…
        </div>
      )}

      {(mode === 'filled' || mode === 'partial') && <FillResultPanel results={results} />}

      {mode === 'partial' && (
        <div style={{ marginTop: 8, fontSize: 12 }}>
          <button onClick={copyBody} className="btn btn-plain">
            复制正文
          </button>
          <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>正文可能需手动粘贴到编辑器。</span>
        </div>
      )}

      {confirmNext && (
        <div role="alert" style={{ marginTop: 8, fontSize: 12, color: '#cf1322' }}>
          正文尚未确认填入,确定进入下一条?
          <button onClick={handleNext} className="btn btn-plain" style={{ padding: '2px 8px', marginLeft: 6 }}>
            确定
          </button>
          <button
            onClick={() => setConfirmNext(false)}
            className="btn btn-plain"
            style={{ padding: '2px 8px', marginLeft: 4 }}
          >
            取消
          </button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        {(mode === 'empty' || mode === 'generating' || mode === 'draft') && (
          <button onClick={handleGenerate} disabled={busy} className="btn btn-primary">
            生成草稿
          </button>
        )}
        {draft && (mode === 'draft' || mode === 'filled' || mode === 'partial') && (
          <button onClick={handleFill} disabled={busy} className="btn btn-primary">
            填充到当前页
          </button>
        )}
        {draft && (
          <button onClick={handleNext} disabled={busy} className="btn btn-plain">
            下一条
          </button>
        )}
      </div>
    </Wrap>
  );
}

function Wrap({ children }: { children: React.ReactNode }) {
  return (
    <main className="glass-panel" style={{ padding: 16, margin: '12px auto', maxWidth: 480 }}>
      {children}
    </main>
  );
}
