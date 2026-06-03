// Side Panel 根组件。U1:占位骨架 + 常驻"不会自动发布"提示;完整 UI 在 U6。
export function App() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 12 }}>
      <div
        style={{
          background: '#fff7e6',
          border: '1px solid #ffd591',
          borderRadius: 6,
          padding: '8px 10px',
          fontSize: 13,
          marginBottom: 12,
        }}
        role="note"
      >
        ⚠️ 插件不会自动发布,请人工审核后手动发布。
      </div>
      <h1 style={{ fontSize: 16, margin: 0 }}>51publisher 填充助手</h1>
      <p style={{ color: '#888', fontSize: 13 }}>脚手架就绪(U1)。生成/填充功能开发中。</p>
    </main>
  );
}
