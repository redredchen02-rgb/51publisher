import { useEffect, useState, useCallback, useRef } from 'react';
import { browser } from '#imports';
import type { SafetyMode } from '../../lib/types';
import type { Batch } from '../../lib/batch';
import { batchPhase } from '../../lib/batch';
import type { DriftReport } from '../../lib/selectors';
import type { TrajectoryRecord } from '../../lib/trajectory';
import { verifyTrajectory, rollbackTargets } from '../../lib/trajectory';
import { getSafetyMode, getTrajectory } from '../../lib/storage';
import {
  getBatchState,
  runBatch,
  approveBatch,
  killBatch,
  releaseQuarantine,
  markItemEdited,
  checkSelectors,
} from '../../lib/messaging';
import { addFewShotPair, removeLastFewShotPair } from '../../lib/storage';
import { BatchReviewPanel } from './BatchReviewPanel';

const btn: React.CSSProperties = { padding: '6px 12px', fontSize: 13, border: 'none', borderRadius: 4, cursor: 'pointer' };

// 容器:持有批次状态 + 接 messaging;展示交给 BatchReviewPanel(已单测)。
export function BatchView({ onBack }: { onBack: () => void }) {
  const [batch, setBatch] = useState<Batch | null>(null);
  const [safetyMode, setSafetyMode] = useState<SafetyMode>('off');
  const [tabHealthy, setTabHealthy] = useState(true);
  const [topics, setTopics] = useState('');
  const [busy, setBusy] = useState(false);
  const [drift, setDrift] = useState<DriftReport | null>(null);
  const [trajectory, setTrajectory] = useState<TrajectoryRecord[]>([]);
  const [error, setError] = useState('');
  const [toast, setToast] = useState<{ message: string; undoable: boolean } | null>(null);
  const savingItems = useRef(new Set<string>());

  const refresh = useCallback(async () => {
    const [b, mode, traj] = await Promise.all([getBatchState(), getSafetyMode(), getTrajectory()]);
    setSafetyMode(mode);
    setBatch(b);
    setTrajectory(traj);
    if (b) {
      // tab 健康:钉住的 tab 是否仍停在记录的授权 host。
      try {
        const tab = await browser.tabs.get(b.tabId);
        const host = tab?.url ? new URL(tab.url).hostname : '';
        setTabHealthy(host === b.authorizedHost);
      } catch {
        setTabHealthy(false);
      }
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function withBusy(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch {
      setError('操作失败,请重试。');
    } finally {
      setBusy(false);
    }
  }

  function showToast(message: string, undoable: boolean) {
    setToast({ message, undoable });
    window.setTimeout(() => setToast(null), 5000);
  }

  async function handleSaveAsFewShot(itemId: string) {
    if (savingItems.current.has(itemId)) return;
    const b = batch;
    if (!b) return;
    const item = b.items.find((it) => it.id === itemId);
    if (!item?.draft) return;
    savingItems.current.add(itemId);
    try {
      const result = await addFewShotPair({ input: item.topic, output: item.draft.body });
      if (!result.ok) {
        showToast('范例已满（8/8），请先在设置中删除旧条目', false);
        return;
      }
      showToast('已保存为范例', true);
    } finally {
      savingItems.current.delete(itemId);
    }
  }

  async function handleUndoFewShot() {
    await removeLastFewShotPair();
    setToast(null);
  }

  async function handleStart() {
    const list = topics.split('\n').map((t) => t.trim()).filter(Boolean);
    if (list.length === 0) {
      setError('请先输入选题(每行一条)。');
      return;
    }
    await withBusy(async () => {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) {
        setError('未找到当前标签页——请停在 admin 发帖页。');
        return;
      }
      await runBatch(list, tab.id);
      setTopics('');
      await refresh();
    });
  }

  const showStarter = !batch || batchPhase(batch) === 'done' || batchPhase(batch) === 'empty';

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 12, fontSize: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <h1 style={{ fontSize: 16, margin: 0 }}>批量发布</h1>
        <button onClick={onBack} style={{ ...btn, background: '#f0f0f0', color: '#333', padding: '4px 10px' }}>← 单条</button>
      </div>

      {error && <p role="alert" style={{ color: '#cf1322', fontSize: 13 }}>{error}</p>}

      {toast && (
        <div role="status" aria-live="polite" style={{ background: toast.undoable ? '#f6ffed' : '#fff7e6', border: `1px solid ${toast.undoable ? '#b7eb8f' : '#ffd591'}`, borderRadius: 4, padding: '6px 10px', fontSize: 12, marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{toast.message}</span>
          {toast.undoable && (
            <button type="button" onClick={() => void handleUndoFewShot()} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 12, color: '#1677ff', padding: '0 4px' }}>撤销</button>
          )}
        </div>
      )}

      {batch && batchPhase(batch) !== 'empty' && (
        <BatchReviewPanel
          batch={batch}
          safetyMode={safetyMode}
          authorizedHost={batch.authorizedHost}
          tabHealthy={tabHealthy}
          busy={busy}
          driftResult={drift}
          onApprove={() => void withBusy(async () => { await approveBatch(batch.tabId); await refresh(); })}
          onKill={() => void withBusy(async () => { await killBatch(); await refresh(); })}
          onRelease={(itemId) => void withBusy(async () => { await releaseQuarantine(itemId); await refresh(); })}
          onDriftCheck={() => void withBusy(async () => { setDrift(await checkSelectors(batch.tabId)); })}
          onResume={() => void refresh()}
          onItemEdited={(itemId) => { void (async () => { await markItemEdited(itemId); await refresh(); })(); }}
          onSaveAsFewShot={(itemId) => { void handleSaveAsFewShot(itemId); }}
        />
      )}

      {trajectory.length > 0 && <TrajectorySection records={trajectory} />}

      {showStarter && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 13, color: '#555', marginBottom: 4 }}>选题(每行一条):</div>
          <textarea
            style={{ width: '100%', boxSizing: 'border-box', minHeight: 80, padding: 6, fontSize: 13, border: '1px solid #d9d9d9', borderRadius: 4 }}
            placeholder={'某新番看点\n某里番作品介绍\n…'}
            value={topics}
            disabled={busy}
            onChange={(e) => setTopics(e.target.value)}
          />
          <button onClick={() => void handleStart()} disabled={busy} style={{ ...btn, background: '#1677ff', color: '#fff', marginTop: 8 }}>
            {busy ? '生成中…' : '开始批量(生成+填充)'}
          </button>
        </div>
      )}
    </main>
  );
}

// 轨迹 + 回滚:展示可审计记录 + 链完整性 + 撤下指引(R5/R10)。
function TrajectorySection({ records }: { records: TrajectoryRecord[] }) {
  const intact = verifyTrajectory(records);
  const targets = rollbackTargets(records);
  return (
    <section style={{ marginTop: 14, borderTop: '1px solid #eee', paddingTop: 10 }}>
      <h2 style={{ fontSize: 14, margin: '0 0 6px' }}>
        发布轨迹（{records.length}）{' '}
        <span style={{ fontSize: 12, color: intact ? '#389e0d' : '#cf1322' }}>
          {intact ? '✓ 链完整' : '✗ 链异常(疑被篡改)'}
        </span>
      </h2>
      {targets.length === 0 ? (
        <p style={{ fontSize: 12, color: '#888', margin: 0 }}>暂无可撤下的已发布记录。</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: 12 }}>
          {targets.map((r) => (
            <li key={r.id} style={{ marginBottom: 4 }}>
              <span>「{r.topic}」</span>{' '}
              <a href={r.publishUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#1677ff' }}>查看</a>{' '}
              <span style={{ color: '#888' }}>
                {r.publishedAsDraft ? '(隐藏态)' : '(显示态)'} · 撤下:后台把状态改回「隐藏」
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
