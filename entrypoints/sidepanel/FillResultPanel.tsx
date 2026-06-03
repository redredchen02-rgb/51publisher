import type { FieldFillResult } from '../../lib/types';

const FIELD_LABELS: Record<string, string> = {
  title: '标题', subtitle: '副标题', category: '分类', body: '正文',
  tags: '标签', description: '描述', postStatus: '状态', publishedAt: '发布时间', mediaId: '作品 id',
};

const STATUS_STYLE = {
  filled: { color: '#389e0d', bg: '#f6ffed', border: '#b7eb8f', text: '已填' },
  skipped: { color: '#d48806', bg: '#fffbe6', border: '#ffe58f', text: '跳过' },
  degraded: { color: '#cf1322', bg: '#fff1f0', border: '#ffa39e', text: '需手动' },
} as const;

// 填充结果摘要:让操作员一眼看清"填了什么/哪些没填/哪些降级",
// 把"人工审核"从口号变成可操作动作(R19)。
export function FillResultPanel({ results }: { results: FieldFillResult[] }) {
  if (results.length === 0) return null;
  const problems = results.filter((r) => r.status !== 'filled');
  return (
    <section aria-live="polite" style={{ marginTop: 12 }}>
      <h2 style={{ fontSize: 14, margin: '0 0 6px' }}>填充结果</h2>
      {problems.length > 0 && (
        <div
          role="alert"
          style={{ background: '#fff1f0', border: '1px solid #ffa39e', borderRadius: 6, padding: '6px 8px', fontSize: 12, marginBottom: 6 }}
        >
          ⚠️ 有 {problems.length} 个字段未完整填入,请在发帖页核对后再手动发布。
        </div>
      )}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {results.map((r) => {
          const s = STATUS_STYLE[r.status];
          return (
            <li
              key={r.field}
              style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 12, background: s.bg, border: `1px solid ${s.border}`, borderRadius: 4, padding: '3px 6px' }}
            >
              <span style={{ minWidth: 56, fontWeight: 600 }}>{FIELD_LABELS[r.field] ?? r.field}</span>
              <span style={{ color: s.color, fontWeight: 600 }}>{s.text}</span>
              {r.note && <span style={{ color: '#888' }}>{r.note}</span>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
