import type { FewShotPair } from '../../../lib/types';

const MAX_PAIRS = 8;

const taStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '4px 6px',
  fontSize: 12, border: '1px solid #d9d9d9', borderRadius: 3,
  resize: 'vertical', minHeight: 48,
};
const btnSm: React.CSSProperties = {
  padding: '2px 7px', fontSize: 11, border: '1px solid #d9d9d9',
  borderRadius: 3, cursor: 'pointer', background: '#fafafa',
};

interface Props {
  pairs: FewShotPair[];
  onChange: (pairs: FewShotPair[]) => void;
  /** 显示导入提示 banner（旧格式 fewShotExamples 非空且 pairs 空时）。 */
  importBanner?: string;
  onImport?: () => void;
}

export function FewShotPairEditor({ pairs, onChange, importBanner, onImport }: Props) {
  function updatePair(index: number, field: 'input' | 'output', value: string) {
    const next = pairs.map((p, i) => (i === index ? { ...p, [field]: value } : p));
    onChange(next);
  }

  function deletePair(index: number) {
    onChange(pairs.filter((_, i) => i !== index));
  }

  function movePair(index: number, dir: -1 | 1) {
    const next = [...pairs];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    onChange(next);
  }

  function addPair() {
    if (pairs.length >= MAX_PAIRS) return;
    onChange([...pairs, { input: '', output: '' }]);
  }

  return (
    <div>
      {importBanner && onImport && (
        <div style={{ background: '#fffbe6', border: '1px solid #ffe58f', borderRadius: 4, padding: '6px 10px', marginBottom: 8, fontSize: 12 }}>
          {importBanner}
          <button type="button" onClick={onImport} style={{ ...btnSm, marginLeft: 8, background: '#fa8c16', color: '#fff', border: 'none' }}>
            导入
          </button>
        </div>
      )}

      {pairs.map((pair, i) => (
        <div key={i} style={{ border: '1px solid #e8e8e8', borderRadius: 4, padding: '6px 8px', marginBottom: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <span style={{ fontSize: 11, color: '#888' }}>范例 {i + 1}</span>
            <div style={{ display: 'flex', gap: 4 }}>
              <button type="button" disabled={i === 0} onClick={() => movePair(i, -1)} style={btnSm} aria-label="上移">↑</button>
              <button type="button" disabled={i === pairs.length - 1} onClick={() => movePair(i, 1)} style={btnSm} aria-label="下移">↓</button>
              <button type="button" onClick={() => deletePair(i)} style={{ ...btnSm, color: '#cf1322', borderColor: '#ffa39e' }} aria-label="删除">✕</button>
            </div>
          </div>
          <label style={{ fontSize: 11, color: '#555', display: 'block', marginBottom: 2 }}>输入上下文</label>
          <textarea style={taStyle} value={pair.input} placeholder="topic + facts…" onChange={(e) => updatePair(i, 'input', e.target.value)} />
          <label style={{ fontSize: 11, color: '#555', display: 'block', margin: '4px 0 2px' }}>范例输出</label>
          <textarea style={taStyle} value={pair.output} placeholder="期望的 AI 输出正文…" onChange={(e) => updatePair(i, 'output', e.target.value)} />
        </div>
      ))}

      <button
        type="button"
        onClick={addPair}
        disabled={pairs.length >= MAX_PAIRS}
        style={{ ...btnSm, width: '100%', marginTop: 4, color: pairs.length >= MAX_PAIRS ? '#bbb' : '#1677ff', borderColor: pairs.length >= MAX_PAIRS ? '#e8e8e8' : '#91caff' }}
      >
        {pairs.length >= MAX_PAIRS ? `已达上限（${MAX_PAIRS}/${MAX_PAIRS}），请先删除旧条目` : '+ 添加范例'}
      </button>
    </div>
  );
}
