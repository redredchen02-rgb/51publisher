import { useEffect, useState } from 'react';
import type { DryRunReport as DryRunReportType } from '../../lib/types';
import { getDryRunReport, clearDryRunReport } from '../../lib/storage';

const btn: React.CSSProperties = {
  padding: '4px 10px', fontSize: 12, border: '1px solid #91caff',
  borderRadius: 4, cursor: 'pointer', background: '#e6f4ff', color: '#0958d9',
};

export function DryRunReport() {
  const [report, setReport] = useState<DryRunReportType | null>(null);

  useEffect(() => {
    getDryRunReport().then(setReport);
  }, []);

  if (!report) return null;

  async function handleClear() {
    await clearDryRunReport();
    setReport(null);
  }

  return (
    <section style={{ marginTop: 14, borderTop: '1px solid #91caff', paddingTop: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <h2 style={{ fontSize: 14, margin: 0, color: '#0958d9' }}>🧪 预演填充报告（{report.items.length} 条）</h2>
        <button onClick={() => void handleClear()} style={btn}>清除报告</button>
      </div>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: 12 }}>
        {report.items.map((item) => {
          const filled = item.fillResults.filter((r) => r.status === 'filled').length;
          const skipped = item.fillResults.filter((r) => r.status === 'skipped').length;
          const degraded = item.fillResults.filter((r) => r.status === 'degraded').length;
          return (
            <li key={item.itemId} style={{ marginBottom: 6, padding: '5px 8px', background: '#f0f7ff', borderRadius: 4 }}>
              <div style={{ fontWeight: 600, marginBottom: 2 }}>「{item.topic}」</div>
              {item.draftTitle && (
                <div style={{ color: '#444', marginBottom: 2 }}>标题: {item.draftTitle}</div>
              )}
              <div>
                <span style={{ color: '#389e0d', marginRight: 6 }}>✓已填 {filled}</span>
                <span style={{ color: '#d46b08', marginRight: 6 }}>↷跳过 {skipped}</span>
                <span style={{ color: '#cf1322' }}>⚠降级 {degraded}</span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
