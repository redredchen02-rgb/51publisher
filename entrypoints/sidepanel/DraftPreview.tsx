import type { ContentDraft } from '../../lib/types';

const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: '#555', display: 'block', marginBottom: 2 };
const inputStyle: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '4px 6px', fontSize: 13, border: '1px solid #d9d9d9', borderRadius: 4 };
const rowStyle: React.CSSProperties = { marginBottom: 8 };

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={rowStyle}>
      <label style={labelStyle}>{label}</label>
      {children}
    </div>
  );
}

// 草稿预览 + 人工编辑(R3)。AI 字段可改;postStatus/publishedAt/mediaId 为非 AI 字段,人工填。
export function DraftPreview({ draft, onChange }: { draft: ContentDraft; onChange: (d: ContentDraft) => void }) {
  const set = (patch: Partial<ContentDraft>) => onChange({ ...draft, ...patch });
  return (
    <div>
      <Field label="标题">
        <input style={inputStyle} value={draft.title} onChange={(e) => set({ title: e.target.value })} />
      </Field>
      <Field label="副标题">
        <input style={inputStyle} value={draft.subtitle} onChange={(e) => set({ subtitle: e.target.value })} />
      </Field>
      <Field label="分类(type 值,如 2=漫畫文章 / 4=動漫文章)">
        <input style={inputStyle} value={draft.category} onChange={(e) => set({ category: e.target.value })} />
      </Field>
      <Field label="标签(逗号分隔)">
        <input
          style={inputStyle}
          value={draft.tags.join(', ')}
          onChange={(e) => set({ tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) })}
        />
      </Field>
      <Field label="描述">
        <textarea style={{ ...inputStyle, minHeight: 44 }} value={draft.description} onChange={(e) => set({ description: e.target.value })} />
      </Field>
      <Field label="正文(HTML,填充前自动消毒)">
        <textarea style={{ ...inputStyle, minHeight: 120, fontFamily: 'monospace' }} value={draft.body} onChange={(e) => set({ body: e.target.value })} />
      </Field>
      <details style={{ marginBottom: 8 }}>
        <summary style={{ fontSize: 12, color: '#888', cursor: 'pointer' }}>非 AI 字段(人工设定)</summary>
        <div style={{ marginTop: 6 }}>
          <Field label="状态(0=隐藏 / 1=显示)">
            <input style={inputStyle} value={draft.postStatus} onChange={(e) => set({ postStatus: e.target.value })} />
          </Field>
          <Field label="发布时间(yyyy-MM-dd)">
            <input style={inputStyle} value={draft.publishedAt} onChange={(e) => set({ publishedAt: e.target.value })} />
          </Field>
          <Field label="作品 id">
            <input style={inputStyle} value={draft.mediaId} onChange={(e) => set({ mediaId: e.target.value })} />
          </Field>
          <Field label="封面图 URL(仅预览,MVP 不自动填,请人工上传)">
            <input style={inputStyle} value={draft.coverImageUrl} onChange={(e) => set({ coverImageUrl: e.target.value })} />
          </Field>
          {draft.coverImageUrl && (
            <img src={draft.coverImageUrl} alt="封面预览" style={{ maxWidth: '100%', maxHeight: 120, borderRadius: 4, marginTop: 4 }} />
          )}
        </div>
      </details>
    </div>
  );
}
