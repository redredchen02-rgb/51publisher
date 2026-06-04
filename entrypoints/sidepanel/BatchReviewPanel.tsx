import { useState } from 'react';
import type { SafetyMode, FieldFillResult, ContentDraft } from '../../lib/types';
import { type Batch, type BatchItem, batchSummary, batchPhase } from '../../lib/batch';
import type { DriftReport } from '../../lib/selectors';
import type { TrajectoryRecord } from '../../lib/trajectory';
import { DraftPreview } from './DraftPreview';

/**
 * 字段填充三态状态表。
 * - 无数据(空数组 / undefined): 不渲染任何内容。
 * - 全部已填且无降级/跳过: 显示内联绿色打勾。
 * - 有跳过/降级: 显示可展开的三列计数 + 明细。
 */
function FillStatusTable({ results }: { results: FieldFillResult[] | undefined }) {
  const [open, setOpen] = useState(false);
  if (!results || results.length === 0) return null;

  const filled = results.filter((r) => r.status === 'filled');
  const skipped = results.filter((r) => r.status === 'skipped');
  const degraded = results.filter((r) => r.status === 'degraded');
  const allFilled = skipped.length === 0 && degraded.length === 0;

  if (allFilled) {
    return <div style={{ marginTop: 4, fontSize: 11, color: '#389e0d' }}>✓ 全部字段已填</div>;
  }

  return (
    <div style={{ marginTop: 4 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{ background: '#fafafa', border: '1px solid #d9d9d9', borderRadius: 3, padding: '2px 6px', fontSize: 11, cursor: 'pointer', color: '#555' }}
        aria-expanded={open}
        aria-label="字段填充状态"
      >
        <span style={{ color: '#389e0d' }}>✓{filled.length}</span>
        {' '}
        <span style={{ color: '#d46b08' }}>↷{skipped.length}</span>
        {' '}
        <span style={{ color: '#cf1322' }}>⚠{degraded.length}</span>
        {' '}{open ? '▲' : '▼'}
      </button>
      {open && (
        <ul style={{ margin: '4px 0 0', padding: '0 0 0 12px', fontSize: 11 }}>
          {skipped.map((r) => (
            <li key={r.field} style={{ color: '#d46b08' }}>
              <strong>{r.field}</strong> 已跳过{r.note ? `：${r.note}` : ''}
            </li>
          ))}
          {degraded.map((r) => (
            <li key={r.field} style={{ color: '#cf1322' }}>
              <strong>{r.field}</strong> 降级{r.note ? `：${r.note}` : '（innerHTML 兜底,格式可能丢失）'}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** 隔离释放时展示轨迹上下文:三态(有 URL / 无 URL / 无记录)。 */
function QuarantineContext({ record }: { record: TrajectoryRecord | undefined }) {
  const s: React.CSSProperties = { fontSize: 11, marginTop: 2 };
  if (!record) {
    return <div style={{ ...s, color: '#888' }}>无发布记录 — 可安全重试</div>;
  }
  if (record.publishUrl) {
    return <div style={{ ...s, color: '#874d00' }}>可能已发布(未核实) — 请先点「查看帖子」确认后再撤出隔离</div>;
  }
  return <div style={{ ...s, color: '#874d00' }}>未收到发布确认 — 帖子可能未成功发布</div>;
}

// 批量审核面板:专为"在窄面板里高效审 N 条"设计(评审 design-lens)。
// 纯展示 + 受控:批次/档位/tab 健康由 props 传入,动作经回调上抛给 App(它接 messaging)。

interface Props {
  batch: Batch;
  safetyMode: SafetyMode;
  /** 批次创建时记录的授权 host(字面展示供核对)。 */
  authorizedHost: string;
  /** 钉住的 tab 是否仍停在授权 host(false → 阻断式暂停)。 */
  tabHealthy: boolean;
  busy?: boolean;
  driftResult?: DriftReport | null;
  /** 轨迹上下文(item.id → TrajectoryRecord),用于隔离释放时展示发布结果。 */
  trajectoryContext?: Map<string, TrajectoryRecord>;
  /** 人工编辑覆盖(itemId → 编辑后草稿);awaiting-approval 条目显示可编辑字段。 */
  draftOverrides?: Map<string, ContentDraft>;
  /** 用户编辑某条草稿时回调(item id + 完整新草稿)。 */
  onDraftChange?: (itemId: string, draft: ContentDraft) => void;
  /** 标准批准(含漂移自检前置门)。 */
  onApprove: () => void;
  /** 跳过漂移自检直接批准(仅在自检失败后提供)。 */
  onApproveBypass: () => void;
  onKill: () => void;
  onRelease: (itemId: string) => void;
  onDriftCheck: () => void;
  onResume: () => void;
}

const box: React.CSSProperties = { borderRadius: 6, padding: '8px 10px', fontSize: 13, marginBottom: 10 };
const btn: React.CSSProperties = { padding: '6px 12px', fontSize: 13, border: 'none', borderRadius: 4, cursor: 'pointer' };

// 档位视觉:authorized 必须一眼区别于 dry-run(评审 design-lens 安全关键)。
const MODE_STYLE: Record<SafetyMode, { bg: string; border: string; color: string; label: string; icon: string }> = {
  off: { bg: '#f5f5f5', border: '#d9d9d9', color: '#555', label: '关闭(只填充,不发布)', icon: '⏻' },
  'dry-run': { bg: '#e6f4ff', border: '#91caff', color: '#0958d9', label: '预演(走流程不真发)', icon: '🧪' },
  authorized: { bg: '#fff1f0', border: '#ffa39e', color: '#cf1322', label: '已授权·会真发布', icon: '🔴' },
};

const STATUS_LABEL: Record<BatchItem['status'], string> = {
  queued: '排队',
  generating: '生成中',
  filled: '待审',
  'awaiting-approval': '待审',
  'publish-dispatched': '发布中',
  'publish-confirmed': '已发布',
  'needs-human-verification': '待人工核',
  aborted: '已停',
  error: '失败',
};

export function BatchReviewPanel(props: Props) {
  const { batch, safetyMode, authorizedHost, tabHealthy, busy, driftResult, trajectoryContext, draftOverrides, onDraftChange } = props;
  const summary = batchSummary(batch);
  const phase = batchPhase(batch);
  const modeStyle = MODE_STYLE[safetyMode];
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const quarantined = batch.items.filter((it) => it.status === 'needs-human-verification');
  const canApprove =
    phase === 'awaiting-approval' && tabHealthy && (safetyMode === 'authorized' || safetyMode === 'dry-run') && !busy;
  // authorized 才要求打字手势;dry-run 预演只需点确认。
  const gestureOk = safetyMode !== 'authorized' || typed.trim().toLowerCase() === 'publish';

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function confirmApprove() {
    setConfirming(false);
    setTyped('');
    props.onApprove();
  }

  return (
    <div>
      {/* 档位 + host + tab 状态带(常驻) */}
      <div style={{ ...box, background: modeStyle.bg, border: `1px solid ${modeStyle.border}`, color: modeStyle.color }}>
        <div style={{ fontWeight: 600 }} aria-label={`发布档位 ${safetyMode}`}>
          {modeStyle.icon} 档位:{modeStyle.label}
        </div>
        <div style={{ marginTop: 2 }}>
          授权站点:<code>{authorizedHost || '(未记录)'}</code>
        </div>
        <div style={{ marginTop: 2 }}>{tabHealthy ? '✅ 目标标签页正常' : '⚠️ 目标标签页已离开授权站点'}</div>
      </div>

      {/* tab 漂移 → 阻断式暂停(非一行 toast) */}
      {!tabHealthy && (
        <div role="alert" style={{ ...box, background: '#fff7e6', border: '1px solid #ffd591', color: '#874d00' }}>
          批次已暂停:请切回授权 admin 标签页(<code>{authorizedHost}</code>)。在途条目不受影响。
          <div style={{ marginTop: 6 }}>
            <button onClick={props.onResume} style={{ ...btn, background: '#fa8c16', color: '#fff' }}>
              我已切回,继续
            </button>
          </div>
        </div>
      )}

      {/* 摘要带 */}
      <div style={{ ...box, background: '#fafafa', border: '1px solid #eee', color: '#333' }}>
        共 {summary.total} 条 · 待审 {summary.awaitingApproval} · 已发 {summary.confirmed} · 失败 {summary.errored}
        {summary.quarantined > 0 && <strong style={{ color: '#cf1322' }}> · 待人工核 {summary.quarantined}</strong>}
        {summary.aborted > 0 && <span> · 已停 {summary.aborted}</span>}
      </div>

      {/* 隔离态:醒目独立表示(安全关键) */}
      {quarantined.length > 0 && (
        <div role="alert" style={{ ...box, background: '#fff1f0', border: '2px solid #cf1322', color: '#cf1322' }}>
          <div style={{ fontWeight: 700 }}>⚠ {quarantined.length} 条需人工核对</div>
          <div style={{ fontSize: 12, margin: '4px 0' }}>这些条目发布中断且无回执,可能已发也可能没发——请去后台核对后再处置,系统绝不自动重发。</div>
          {quarantined.map((it) => {
            const traj = trajectoryContext?.get(it.id);
            return (
              <div key={it.id} style={{ marginTop: 8, paddingTop: 6, borderTop: '1px solid #ffa39e' }}>
                <div style={{ fontWeight: 600 }}>「{it.topic}」</div>
                <QuarantineContext record={traj} />
                <div style={{ marginTop: 4, display: 'flex', gap: 6 }}>
                  {traj?.publishUrl && (
                    <a href={traj.publishUrl} target="_blank" rel="noopener noreferrer"
                      style={{ ...btn, background: '#fff', border: '1px solid #ffa39e', color: '#cf1322', padding: '2px 8px', fontSize: 12, textDecoration: 'none' }}>
                      查看帖子
                    </a>
                  )}
                  <button onClick={() => props.onRelease(it.id)} style={{ ...btn, background: '#cf1322', color: '#fff', padding: '2px 8px', fontSize: 12 }}>
                    我已核对,撤出隔离
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 条目列表(默认折叠) */}
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {batch.items.map((it) => (
          <li key={it.id} style={{ border: '1px solid #f0f0f0', borderRadius: 4, marginBottom: 4 }}>
            <button
              onClick={() => toggle(it.id)}
              aria-expanded={expanded.has(it.id)}
              style={{ ...btn, width: '100%', textAlign: 'left', background: '#fff', display: 'flex', justifyContent: 'space-between' }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.topic}</span>
              <span aria-label={`状态 ${it.status}`} style={{ marginLeft: 8, fontSize: 12, color: '#888' }}>
                [{STATUS_LABEL[it.status]}]
              </span>
            </button>
            {expanded.has(it.id) && (
              <div style={{ padding: '6px 10px', fontSize: 12, borderTop: '1px solid #f5f5f5' }}>
                {it.status === 'awaiting-approval' && it.draft && onDraftChange ? (
                  // 待审状态:显示可编辑字段(title/tags/category/description;body 唯读)。
                  <DraftPreview
                    draft={draftOverrides?.get(it.id) ?? it.draft}
                    onChange={(d) => onDraftChange(it.id, d)}
                  />
                ) : it.draft ? (
                  <>
                    <div><strong>{it.draft.title || '(无标题)'}</strong></div>
                    <div style={{ color: '#666', maxHeight: 120, overflow: 'auto' }}>{it.draft.description || it.draft.body.replace(/<[^>]+>/g, ' ').slice(0, 200)}</div>
                  </>
                ) : (
                  <span style={{ color: '#999' }}>无草稿内容{it.error ? `(${it.error})` : ''}</span>
                )}
                <FillStatusTable results={it.fillResults} />
              </div>
            )}
          </li>
        ))}
      </ul>

      {/* 漂移自检结果 */}
      {driftResult && (
        <div style={{ ...box, marginTop: 8, background: driftResult.ok ? '#f6ffed' : '#fff7e6', border: `1px solid ${driftResult.ok ? '#b7eb8f' : '#ffd591'}` }}>
          {driftResult.ok ? (
            '✅ 选择器自检通过'
          ) : (
            <>
              <div>⚠️ 缺失:{driftResult.missing.join('、')}</div>
              <div style={{ fontSize: 12, color: '#874d00', marginTop: 2 }}>
                请在目标页确认表单已载入,或刷新页面后操作。
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                <button onClick={props.onDriftCheck} disabled={busy} style={{ ...btn, padding: '3px 8px', fontSize: 12, background: '#fa8c16', color: '#fff' }}>
                  重新自检
                </button>
                <button onClick={props.onApproveBypass} disabled={busy} style={{ ...btn, padding: '3px 8px', fontSize: 12, background: '#f0f0f0', color: '#333' }}>
                  跳过检查继续批准
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* 动作区 */}
      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        {canApprove && !confirming && (
          <button onClick={() => setConfirming(true)} style={{ ...btn, background: safetyMode === 'authorized' ? '#cf1322' : '#1677ff', color: '#fff' }}>
            {safetyMode === 'authorized' ? `批准发布 ${summary.awaitingApproval} 条` : `预演 ${summary.awaitingApproval} 条`}
          </button>
        )}
        <button onClick={props.onDriftCheck} disabled={busy} style={{ ...btn, background: '#f0f0f0', color: '#333' }}>
          漂移自检
        </button>
        {phase !== 'done' && (
          <button onClick={props.onKill} disabled={busy} style={{ ...btn, background: '#fff1f0', color: '#cf1322', border: '1px solid #ffa39e' }}>
            急停
          </button>
        )}
      </div>

      {/* 二次确认:插值 count + host + 主动手势(authorized) */}
      {confirming && (
        <div role="alertdialog" aria-label="发布确认" style={{ ...box, marginTop: 10, background: '#fff', border: '2px solid #cf1322' }}>
          <div style={{ fontWeight: 600, color: '#cf1322' }}>
            {safetyMode === 'authorized'
              ? `确定发布 ${summary.awaitingApproval} 条到 ${authorizedHost}?`
              : `预演发布 ${summary.awaitingApproval} 条(不会真发)?`}
          </div>
          {safetyMode === 'authorized' && (
            <div style={{ marginTop: 6 }}>
              <div style={{ fontSize: 12, color: '#888' }}>防误触:请输入 <code>publish</code> 确认</div>
              <input
                aria-label="输入 publish 确认"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                style={{ width: '100%', boxSizing: 'border-box', padding: 5, marginTop: 4, border: '1px solid #d9d9d9', borderRadius: 4 }}
              />
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button onClick={confirmApprove} disabled={!gestureOk} style={{ ...btn, background: gestureOk ? '#cf1322' : '#f5f5f5', color: gestureOk ? '#fff' : '#bbb' }}>
              确认
            </button>
            <button onClick={() => { setConfirming(false); setTyped(''); }} style={{ ...btn, background: '#f0f0f0', color: '#333' }}>
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
